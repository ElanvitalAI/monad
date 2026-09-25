// Surface-unification v2 (2026-05-11) — TriggerSource for chat trigger.
//
// Wraps `buildChatRouter` behind the generic TriggerSource interface.
// The daemon hosts the router on `/v1/workflows/chat/*` of the NEXUS
// HTTP server (see `src/nexus/api/http-server.ts`).

import { runWorkflow } from '../executor.js';
import { isChatTriggerNode } from '../schema.js';
import type { ChatTriggerNode, WorkflowDeps, WorkflowEntry } from '../types.js';
import {
  buildChatRouter,
  type ChatRegistryEntry,
  type ChatRouter,
  type ChatRouterRequest,
  type ChatRouterResponse,
  type ChatStreamFrame,
} from './chat-router.js';
import type { TriggerEmit, TriggerSource, TriggerSubscription } from './source.js';

interface ChatSourceOpts {
  /** Workflow runtime deps · only required when streaming triggers
   *  exist. The daemon supplies this when wiring chat-source so the
   *  streaming path can drive `runWorkflow` directly (the regular
   *  `onEmit` path uses `runWorkflowToCompletion` which collects every
   *  event before returning — useless for SSE). */
  workflowDeps?: WorkflowDeps;
}

interface Binding {
  entry: WorkflowEntry;
  node: ChatTriggerNode;
  chatEntry: ChatRegistryEntry;
  onEmit: TriggerEmit;
}

export interface ChatSource extends TriggerSource {
  readonly kind: 'chat';
  dispatch(req: ChatRouterRequest): Promise<ChatRouterResponse | null>;
  subscriptions(): TriggerSubscription[];
}

export function createChatSource(opts: ChatSourceOpts = {}): ChatSource {
  const bindings: Binding[] = [];
  let router: ChatRouter | null = null;

  // Surface-unification v2.1 (2026-05-11) — async-generator streaming
  // path. Runs the workflow directly (not via `onEmit` which collects
  // every frame before returning) so SSE frames go out as each node
  // finishes.
  //
  // V2.2-1 (2026-05-12) — token-by-token LLM streaming. The runWorkflow
  // generator forwards each partial chunk via `onTokenChunk(nodeId,
  // chunk)`, which arrives while the consumer is blocked on
  // `gen.next()`. We can't yield from inside an await, so the driver
  // runs in the background and pushes both token frames AND workflow
  // event frames into a shared queue; the outer generator drains the
  // queue between awaits. Chunks reach the SSE caller as
  // `event: token / data: <raw chunk>` per HANDOFF V2.2-1.
  async function* streamWorkflow(
    binding: Binding,
    message: string,
    sessionId: string | undefined,
  ): AsyncIterable<ChatStreamFrame> {
    if (!opts.workflowDeps) {
      yield { event: 'error', data: 'workflow deps not wired for streaming' };
      return;
    }
    const argumentsJson = JSON.stringify({
      trigger: { kind: 'chat', path: binding.chatEntry.trigger.path, message, sessionId },
      nodeId: binding.chatEntry.nodeId,
    });
    const runId = `wf-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    yield { event: 'start', data: JSON.stringify({ runId, workflowName: binding.chatEntry.workflowName }) };
    const lastNodeId = binding.entry.definition.nodes[binding.entry.definition.nodes.length - 1]?.id;

    // Holder object — TS narrows `let wake` to the initial-null type
    // inside closure call sites because the only enclosing reassignment
    // happens in an unreachable-from-here branch. A property bag keeps
    // the type as the declared union throughout.
    const wakeRef: { current: (() => void) | null } = { current: null };
    const queue: ChatStreamFrame[] = [];
    let driverDone = false;
    const enqueue = (frame: ChatStreamFrame): void => {
      queue.push(frame);
      const pending = wakeRef.current;
      wakeRef.current = null;
      pending?.();
    };

    let lastOutput: string | undefined;
    let doneFrame: ChatStreamFrame | null = null;
    const driver = (async () => {
      try {
        const gen = runWorkflow(
          {
            workflow: binding.entry.definition,
            arguments: argumentsJson,
            runId,
            onTokenChunk: (_nodeId, chunk) => enqueue({ event: 'token', data: chunk }),
          },
          opts.workflowDeps!,
        );
        while (true) {
          const next = await gen.next();
          if (next.done) break;
          const evt = next.value;
          if (evt.type === 'node_start' && evt.nodeId) {
            enqueue({ event: 'progress', data: JSON.stringify({ nodeId: evt.nodeId, phase: 'start' }) });
          } else if (evt.type === 'node_done' && evt.nodeId) {
            const out = evt.result.output;
            const outStr = typeof out === 'string' ? out : JSON.stringify(out);
            enqueue({ event: 'progress', data: JSON.stringify({ nodeId: evt.nodeId, phase: 'done', ok: evt.result.ok }) });
            if (evt.nodeId === lastNodeId && evt.result.ok) lastOutput = outStr;
          } else if (evt.type === 'node_skipped' && evt.nodeId) {
            enqueue({ event: 'progress', data: JSON.stringify({ nodeId: evt.nodeId, phase: 'skipped', reason: evt.reason }) });
          } else if (evt.type === 'workflow_failed') {
            enqueue({ event: 'error', data: JSON.stringify({ error: evt.error }) });
            return;
          }
        }
        doneFrame = {
          event: 'done',
          data: JSON.stringify({
            runId,
            workflowName: binding.chatEntry.workflowName,
            response: lastOutput ?? '(no response)',
          }),
        };
      } catch (err) {
        enqueue({ event: 'error', data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) });
      } finally {
        driverDone = true;
        const pending = wakeRef.current;
        wakeRef.current = null;
        pending?.();
      }
    })();

    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (driverDone) break;
      await new Promise<void>((res) => { wakeRef.current = res; });
    }
    await driver;
    // Drain any frames the driver pushed during the final tick (race
    // between the last enqueue and the finally block).
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (doneFrame) yield doneFrame;
  }

  return {
    kind: 'chat',
    subscribe(entry, onEmit) {
      // 2026-05-12 — post-start subscribe is now supported. Newly
      // pushed bindings flow into the router via `router.register`
      // so a workflow YAML dropped after `start()` is dispatchable
      // on the next request (no daemon restart required).
      for (const node of entry.definition.nodes ?? []) {
        if (!isChatTriggerNode(node)) continue;
        const chatEntry: ChatRegistryEntry = {
          workflowName: entry.definition.name,
          nodeId: node.id,
          trigger: node.chatTrigger,
        };
        if (bindings.some((b) =>
          b.chatEntry.workflowName === chatEntry.workflowName
          && b.chatEntry.nodeId === chatEntry.nodeId
        )) {
          continue;
        }
        bindings.push({ entry, node, chatEntry, onEmit });
        if (router !== null) router.register(chatEntry);
      }
    },
    async start() {
      if (router !== null) return;
      router = buildChatRouter({
        registry: bindings.map((b) => b.chatEntry),
        runStream: (chatEntry, message, sessionId) => {
          const binding = bindings.find((b) =>
            b.chatEntry.workflowName === chatEntry.workflowName
            && b.chatEntry.nodeId === chatEntry.nodeId
          );
          if (!binding) {
            return (async function* () {
              yield { event: 'error', data: 'no binding for entry' };
            })();
          }
          return streamWorkflow(binding, message, sessionId);
        },
        runWorkflow: async (chatEntry, message, sessionId) => {
          const binding = bindings.find((b) =>
            b.chatEntry.workflowName === chatEntry.workflowName
            && b.chatEntry.nodeId === chatEntry.nodeId
          );
          if (!binding) return { ok: false as const, error: 'no binding for entry' };
          const result = await binding.onEmit(
            chatEntry.workflowName,
            chatEntry.nodeId,
            { kind: 'chat', path: chatEntry.trigger.path, message, sessionId },
          );
          // Surface-unification v2.1 (2026-05-11) — return the real
          // last-node output captured by the daemon's emit closure. v1
          // placeholder ("ack: <msg>") is replaced. When the last node
          // produced nothing, fall back to a minimal ack so the caller
          // still sees a non-empty response.
          if (!result.ok || !result.runId) {
            return { ok: false as const, error: result.error ?? 'chat dispatch failed' };
          }
          return {
            ok: true as const,
            output: result.output ?? `(no response · run ${result.runId})`,
            runId: result.runId,
          };
        },
      });
    },
    async stop() {
      router = null;
      bindings.length = 0;
    },
    async dispatch(req) {
      if (!router) return null;
      return await router(req);
    },
    subscriptions: () => bindings.map((b) => ({
      kind: 'chat' as const,
      workflowName: b.chatEntry.workflowName,
      nodeId: b.chatEntry.nodeId,
      summary: `POST ${b.chatEntry.trigger.path}`,
    })),
  };
}
