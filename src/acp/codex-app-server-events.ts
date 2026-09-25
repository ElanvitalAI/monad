// H4 Phase 3.B.2b · Codex app-server v2 notification → ACP SessionUpdate
// translator.
//
// Extracted from codex-app-server-agent.ts so the translation logic is
// testable without a live client. All functions are pure given the
// (params, pending) state; the agent owns the Map<itemId, PendingItem>
// and calls into here for each inbound notification.
//
// Protocol reference:
//   ~/source/ref/codex/codex-rs/app-server-protocol/src/protocol/
//     common.rs L985-1050  (method-name → struct mapping)
//     v2.rs     L4514-4660 (ThreadItem enum variants)
//     v2.rs     L5469-5672 (notification struct shapes)
//
// The item/started + item/completed notifications carry the full
// ThreadItem shape. The delta notifications (item/.../outputDelta,
// item/agentMessage/delta, item/plan/delta, item/reasoning/...) carry
// only incremental text keyed by itemId. The translator coalesces
// both streams into a single ACP SessionUpdate sequence.

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { debug } from '../debug/log.js';

/** Symbol key used by DashboardAcpChat to distinguish reasoning / thought
 *  chunks from the primary agent message stream. Matches the key used by
 *  codex-native-agent.ts (same UX · reasoning text is rendered as subtle
 *  secondary text rather than merged into the answer). */
export const REASONING_META_KEY = '__reasoning__';

const DEFAULT_OUTPUT_BUFFER_BYTES = 64 * 1024;

/** Per-item state maintained across multiple notifications. */
export interface PendingItem {
  /** 'item.started' already emitted — subsequent notifications become
   *  tool_call_update instead of tool_call. */
  startedEmitted: boolean;
  /** Aggregated output string (commandExecution · fileChange). */
  outputBuffer: string;
  /** True when outputBuffer hit cap and earlier bytes were dropped. */
  outputTruncated: boolean;
  /** Last-seen ThreadItem.type · lets post-start deltas know what kind
   *  of tool_call to update (execute vs edit vs other). */
  itemType?: string;
}

/** Mutable state owned by the agent, threaded through all translators.
 *  Not exported from index on purpose — only the agent should construct
 *  one. */
export interface EventState {
  items: Map<string, PendingItem>;
  /** Soft cap per item's accumulated output buffer. Defaults to 64 KB;
   *  tests can inject a smaller cap to exercise truncation. */
  outputBufferBytes: number;
}

export function createEventState(
  opts: { outputBufferBytes?: number } = {},
): EventState {
  return {
    items: new Map<string, PendingItem>(),
    outputBufferBytes: opts.outputBufferBytes ?? DEFAULT_OUTPUT_BUFFER_BYTES,
  };
}

function pendingFor(state: EventState, itemId: string): PendingItem {
  let p = state.items.get(itemId);
  if (!p) {
    p = { startedEmitted: false, outputBuffer: '', outputTruncated: false };
    state.items.set(itemId, p);
  }
  return p;
}

function appendOutput(state: EventState, itemId: string, delta: string): string {
  const p = pendingFor(state, itemId);
  const next = p.outputBuffer + delta;
  if (next.length <= state.outputBufferBytes) {
    p.outputBuffer = next;
    return p.outputBuffer;
  }
  const overflow = next.length - state.outputBufferBytes;
  p.outputBuffer = next.slice(overflow);
  p.outputTruncated = true;
  return `[... ${overflow} chars truncated]\n${p.outputBuffer}`;
}

// ─── ThreadItem type narrowers ────────────────────────────────────

interface ThreadItemBase {
  type: string;
  id: string;
}

interface AgentMessageItem extends ThreadItemBase {
  type: 'agentMessage';
  text?: string;
}

interface PlanItem extends ThreadItemBase {
  type: 'plan';
  text?: string;
}

interface ReasoningItem extends ThreadItemBase {
  type: 'reasoning';
  summary?: string[];
  content?: string[];
}

interface CommandExecutionItem extends ThreadItemBase {
  type: 'commandExecution';
  command?: string;
  cwd?: string;
  status?: 'pending' | 'inProgress' | 'completed' | 'failed' | string;
  aggregatedOutput?: string;
  exitCode?: number;
  durationMs?: number;
}

interface FileChangeItem extends ThreadItemBase {
  type: 'fileChange';
  changes?: Array<{ kind?: string; path?: string }>;
  status?: string;
}

interface McpToolCallItem extends ThreadItemBase {
  type: 'mcpToolCall';
  server?: string;
  tool?: string;
  status?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  durationMs?: number;
}

interface WebSearchItem extends ThreadItemBase {
  type: 'webSearch';
  query?: string;
  action?: unknown;
}

type KnownItem =
  | AgentMessageItem
  | PlanItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem;

function asThreadItem(params: unknown): KnownItem | null {
  const p = params as { item?: { type?: unknown; id?: unknown } } | undefined;
  const item = p?.item;
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.id !== 'string') return null;
  return item as KnownItem;
}

// ─── Status mapping ───────────────────────────────────────────────

/** Codex v2 item status → ACP tool_call status. Codex uses camelCase
 *  ('inProgress'); ACP uses snake_case ('in_progress'). */
function mapStatus(
  s: string | undefined,
): 'pending' | 'in_progress' | 'completed' | 'failed' {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'pending') return 'pending';
  return 'in_progress';
}

function trimCommand(cmd: string | undefined, max = 80): string {
  if (!cmd) return '(command)';
  return cmd.length <= max ? cmd : `${cmd.slice(0, max - 1)}…`;
}

// ─── Translators · item/started, item/completed ───────────────────

/** Translate an `item/started` or `item/completed` notification into
 *  zero or more ACP SessionUpdate messages. `phase` identifies which
 *  notification we're handling; pending state flips so follow-up
 *  deltas become updates. */
export function translateItemNotification(
  phase: 'started' | 'completed',
  params: unknown,
  state: EventState,
): SessionUpdate[] {
  const item = asThreadItem(params);
  if (!item) {
    if (debug.enabled) {
      debug.log('acp.cas.events.item-notify.unparseable', phase, { params });
    }
    return [];
  }
  const pending = pendingFor(state, item.id);
  pending.itemType = item.type;

  switch (item.type) {
    case 'agentMessage':
      // Text is streamed via item/agentMessage/delta · item.completed
      // carries the final aggregated text but we've already emitted
      // deltas. Nothing extra to emit here.
      return [];

    case 'plan': {
      // Plan items carry a single line of text (the plan step). Emit
      // on completion only to avoid half-written plan entries in the UI.
      if (phase !== 'completed') return [];
      const text = item.text ?? '';
      if (!text) return [];
      return [
        {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: `[plan] ${text}` },
          _meta: { [REASONING_META_KEY]: true },
        } as unknown as SessionUpdate,
      ];
    }

    case 'reasoning': {
      if (phase !== 'completed') return [];
      const parts: string[] = [];
      if (Array.isArray(item.summary)) parts.push(...item.summary.filter((s) => s));
      if (Array.isArray(item.content)) parts.push(...item.content.filter((s) => s));
      const joined = parts.join('\n');
      if (!joined) return [];
      return [
        {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: joined },
          _meta: { [REASONING_META_KEY]: true },
        } as unknown as SessionUpdate,
      ];
    }

    case 'commandExecution': {
      if (phase === 'started') {
        pending.startedEmitted = true;
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: item.id,
            title: trimCommand(item.command),
            kind: 'execute',
            status: mapStatus(item.status),
            content: [],
            rawInput: { command: item.command, cwd: item.cwd },
          } as unknown as SessionUpdate,
        ];
      }
      // completed: update with final aggregated output + exit code.
      const finalOutput = item.aggregatedOutput ?? pending.outputBuffer;
      return [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: item.id,
          status: mapStatus(item.status),
          content: finalOutput
            ? [{ type: 'content', content: { type: 'text', text: finalOutput } }]
            : [],
          rawOutput: {
            exit_code: item.exitCode,
            duration_ms: item.durationMs,
          },
        } as unknown as SessionUpdate,
      ];
    }

    case 'fileChange': {
      // codex aggregates the whole patch · emit on completion only.
      if (phase !== 'completed') return [];
      pending.startedEmitted = true;
      const changes = item.changes ?? [];
      const pathList = changes.map((c) => `${c.kind ?? '?'} ${c.path ?? '?'}`).join(', ');
      return [
        {
          sessionUpdate: 'tool_call',
          toolCallId: item.id,
          title: `${changes.length} file change(s)`,
          kind: 'edit',
          status: mapStatus(item.status),
          content: pathList
            ? [{ type: 'content', content: { type: 'text', text: pathList } }]
            : [],
          rawInput: { changes },
        } as unknown as SessionUpdate,
      ];
    }

    case 'mcpToolCall': {
      const title = `${item.server ?? '?'}:${item.tool ?? '?'}`;
      if (phase === 'started') {
        pending.startedEmitted = true;
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: item.id,
            title,
            kind: 'other',
            status: mapStatus(item.status),
            rawInput: item.arguments,
          } as unknown as SessionUpdate,
        ];
      }
      return [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: item.id,
          status: mapStatus(item.status),
          rawOutput: item.result ?? item.error,
        } as unknown as SessionUpdate,
      ];
    }

    case 'webSearch': {
      if (phase === 'started') {
        pending.startedEmitted = true;
        const query = item.query ?? '';
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: item.id,
            title: `search: ${query.slice(0, 60)}`,
            kind: 'search',
            status: 'in_progress',
            rawInput: { query },
          } as unknown as SessionUpdate,
        ];
      }
      return [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: item.id,
          status: 'completed',
          rawOutput: item.action,
        } as unknown as SessionUpdate,
      ];
    }

    default:
      // Variants deferred to 3.B.2c (image input, collabAgentToolCall,
      // contextCompaction, review mode, etc.). Drop with a debug line
      // so the stream stays quiet in production but diagnosable.
      if (debug.enabled) {
        debug.log('acp.cas.events.item-notify.ignored', phase, {
          type: (item as ThreadItemBase).type,
          id: (item as ThreadItemBase).id,
        });
      }
      return [];
  }
}

// ─── Translators · delta notifications ────────────────────────────

export function translateAgentMessageDelta(params: unknown): SessionUpdate[] {
  const p = params as { delta?: string } | undefined;
  if (!p || typeof p.delta !== 'string' || p.delta.length === 0) return [];
  return [
    {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: p.delta },
    } as unknown as SessionUpdate,
  ];
}

export function translatePlanDelta(params: unknown): SessionUpdate[] {
  const p = params as { delta?: string } | undefined;
  if (!p || typeof p.delta !== 'string' || p.delta.length === 0) return [];
  return [
    {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: p.delta },
      _meta: { [REASONING_META_KEY]: true },
    } as unknown as SessionUpdate,
  ];
}

export function translateReasoningDelta(params: unknown): SessionUpdate[] {
  const p = params as { delta?: string } | undefined;
  if (!p || typeof p.delta !== 'string' || p.delta.length === 0) return [];
  return [
    {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: p.delta },
      _meta: { [REASONING_META_KEY]: true },
    } as unknown as SessionUpdate,
  ];
}

export function translateCommandExecutionOutputDelta(
  params: unknown,
  state: EventState,
): SessionUpdate[] {
  const p = params as { itemId?: string; delta?: string } | undefined;
  if (!p || typeof p.itemId !== 'string' || typeof p.delta !== 'string') return [];
  if (p.delta.length === 0) return [];
  const pending = pendingFor(state, p.itemId);
  const displayText = appendOutput(state, p.itemId, p.delta);
  // Emit an update only if the item/started fired first — otherwise we
  // have no tool_call to update (shouldn't happen per protocol, but
  // guard against out-of-order delivery).
  if (!pending.startedEmitted) {
    if (debug.enabled) {
      debug.log('acp.cas.events.exec-delta-before-start', p.itemId, {
        deltaLen: p.delta.length,
      });
    }
    return [];
  }
  return [
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: p.itemId,
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: displayText } }],
    } as unknown as SessionUpdate,
  ];
}

export function translateFileChangeOutputDelta(
  params: unknown,
  state: EventState,
): SessionUpdate[] {
  const p = params as { itemId?: string; delta?: string } | undefined;
  if (!p || typeof p.itemId !== 'string' || typeof p.delta !== 'string') return [];
  if (p.delta.length === 0) return [];
  const pending = pendingFor(state, p.itemId);
  const displayText = appendOutput(state, p.itemId, p.delta);
  if (!pending.startedEmitted) {
    // fileChange may legitimately have no item.started (Codex aggregates
    // and only emits item.completed). Stash the buffer; item.completed
    // will consume it.
    return [];
  }
  return [
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: p.itemId,
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: displayText } }],
    } as unknown as SessionUpdate,
  ];
}

// ─── Translators · turn-level notifications ───────────────────────

/** Translate `turn/plan/updated` to the ACP `plan` SessionUpdate shape. */
export function translateTurnPlanUpdated(params: unknown): SessionUpdate[] {
  const p = params as {
    plan?: Array<{ text?: string; status?: string }>;
  } | undefined;
  if (!p || !Array.isArray(p.plan)) return [];
  const entries = p.plan
    .filter((s) => s && typeof s.text === 'string')
    .map((s) => ({
      content: s.text ?? '',
      priority: 'medium' as const,
      status:
        s.status === 'completed'
          ? ('completed' as const)
          : s.status === 'inProgress'
            ? ('in_progress' as const)
            : ('pending' as const),
    }));
  if (entries.length === 0) return [];
  return [
    {
      sessionUpdate: 'plan',
      entries,
    } as unknown as SessionUpdate,
  ];
}

/** Turn/completed · v2 shape: `{ threadId, turn: Turn }` where
 *  `turn.status` is one of 'completed' | 'interrupted' | 'failed' |
 *  'inProgress'. Failed turns may carry `turn.error`. */
export function translateTurnCompleted(params: unknown): {
  stopReason: 'end_turn' | 'cancelled' | 'max_tokens';
  errorMessage?: string;
} {
  const p = params as {
    turn?: { status?: string; error?: { message?: string } };
  } | undefined;
  const status = p?.turn?.status;
  if (status === 'interrupted') return { stopReason: 'cancelled' };
  if (status === 'failed') {
    return {
      stopReason: 'end_turn',
      errorMessage: p?.turn?.error?.message ?? 'turn failed',
    };
  }
  return { stopReason: 'end_turn' };
}

// ─── Method-name routing ──────────────────────────────────────────

/** All v2 notification methods the agent subscribes to. Exported so
 *  the agent can build its subscription list and tests can assert the
 *  set matches protocol expectations. */
export const TRACKED_NOTIFICATION_METHODS = [
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'turn/plan/updated',
  'turn/completed',
] as const;

export type TrackedNotificationMethod = (typeof TRACKED_NOTIFICATION_METHODS)[number];
