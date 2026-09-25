// src/nexus/api/autopilot-handler.ts
//
// ROADMAP-ipad-companion-autopilot-priority §D2.0 — daemon HTTP entry
// for the autopilot loop driver. iOS / PWA clients POST a mission +
// budget envelope; the response is a Server-Sent Events stream of:
//   - `event: envelope`  — every FeedbackEnvelope (agent.status etc.)
//   - `event: update`    — raw ACP SessionUpdate (text deltas, tool calls)
//   - `event: result`    — final AutopilotResult on completion
//   - `event: error`     — fatal failures before/during run
//
// Each event is followed by `\n\n` per SSE spec. Clients should set
// `Accept: text/event-stream` and parse line-by-line; iOS uses
// URLSession + bytes(for:) on the response.
//
// Lifecycle:
//   - Agent is spawned per request (one-shot) and torn down in `finally`.
//   - The stream closes after `result` / `error` — clients should treat
//     EOF as terminal.
//   - If the client disconnects mid-run, the agent is best-effort
//     cancelled via the AutopilotLoopDriver's AbortSignal wire.

import { AcpAgent, type AcpAgentOpts } from '../../acp/client.js';
import { AcpAgentManager } from '../../acp/agent-manager.js';
import {
  AutopilotLoopDriver,
  type AutopilotPlan,
  type AutopilotPlanStep,
  type TerminalAgencyConfig,
} from '../../autopilot/agent-loop.js';
import { AcpTurnRunner, type LlmTurnRunner } from '../../autopilot/runner.js';
import { MonadBuiltinTurnRunner } from '../../autopilot/monad-builtin-runner.js';
import { getAutopilotToolRegistry } from '../../autopilot/tool-registry.js';
import { composeAutopilotSystemPrompt } from '../../autopilot/system-prompt.js';
import { parseHeuristicPlan } from '../../autopilot/planner.js';

const MONAD_BUILTIN_BACKEND = 'monad-builtin';

// PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B (2026-05-20) —
// active runs registry. handleAutopilotRun registers each run on start +
// cleans up in `finally`. handleAutopilotInject posts user mid-mission
// instructions into a per-run FIFO queue · driver drains at iter-start.
//
// Lifetime: a run lives from `handleAutopilotRun` SSE stream `start` to
// `finally`. POST /v1/autopilot/<runId>/inject after the run ends → 404.
// Module-level singleton — shared across all handleAutopilotRun
// invocations within one daemon process. Multi-tenant safety: runId is
// generated server-side from the session id (random suffix on monad-
// builtin · ACP-issued for backend agents) so cross-run collisions are
// statistically impossible without an explicit attacker forge.

interface ActiveRun {
  /** Pending user instructions · drained by driver at iter-start. */
  injections: string[];
  /** Abort controller for the run — `POST /inject` does NOT cancel,
   *  but a future explicit /stop endpoint (Phase C polish) can call
   *  this. Phase B itself just exposes the registry seam. */
  abort: AbortController;
  /** Live-steer hook — when the run's backend supports it (codex
   *  `turn/steer`), `/inject` weaves the instruction into the RUNNING
   *  turn instead of queuing for the next iteration. Returns whether the
   *  live turn was steered; `false` ⇒ caller falls back to the queue.
   *  Absent / returns false for backends without steer (generic ACP). */
  steer?: (instruction: string) => Promise<boolean>;
}

const activeRuns = new Map<string, ActiveRun>();

function registerActiveRun(runId: string, abort: AbortController): ActiveRun {
  const entry: ActiveRun = { injections: [], abort };
  activeRuns.set(runId, entry);
  return entry;
}

function unregisterActiveRun(runId: string): void {
  activeRuns.delete(runId);
}

/** Drain helper bound at registration time so the driver only needs the
 *  `AutopilotInjectionQueue` surface — caller (handleAutopilotRun) wires
 *  the active-run map into the driver via closure capture. */
function makeDrainerForRun(entry: ActiveRun): () => string[] {
  return () => {
    if (entry.injections.length === 0) return [];
    const drained = entry.injections.slice();
    entry.injections.length = 0;
    return drained;
  };
}

/** Test seam — reset registry between tests (`bun test` runs share a
 *  module-level Map across cases otherwise). Caller responsibility. */
export function _resetAutopilotRunsForTest(): void {
  activeRuns.clear();
}

/** Test/diagnostic seam — peek at the current active-run set. */
export function _listActiveAutopilotRunsForTest(): string[] {
  return Array.from(activeRuns.keys());
}

/** Test seam — register a fake run without going through handleAutopilotRun.
 *  Production callers must NEVER use this; the unit test file in
 *  `autopilot-handler.test.ts` is the only consumer. Returns the
 *  ActiveRun entry so tests can read back `injections` after exercising
 *  the inject endpoint. */
export function _registerActiveRunForTest(runId: string): ActiveRun {
  return registerActiveRun(runId, new AbortController());
}

/** Test seam — drain pending injections for a registered run. Mirrors
 *  the closure produced by `makeDrainerForRun` inside
 *  `handleAutopilotRun`. The Phase G verification test uses this to
 *  confirm that the inject endpoint populates the queue + the queue
 *  drains FIFO + is empty after drain. Returns `undefined` when the
 *  run id is unknown (caller can distinguish from "empty queue"). */
export function _drainInjectionsForTest(runId: string): string[] | undefined {
  const entry = activeRuns.get(runId);
  if (!entry) return undefined;
  if (entry.injections.length === 0) return [];
  const out = entry.injections.slice();
  entry.injections.length = 0;
  return out;
}

/** Test seam — explicit unregister (mirror of the `finally` cleanup
 *  inside handleAutopilotRun). Tests use this to verify post-unregister
 *  inject calls return 404 without driving the full SSE stream. */
export function _unregisterActiveRunForTest(runId: string): void {
  unregisterActiveRun(runId);
}

interface AutopilotRunBody {
  mission?: unknown;
  backend?: unknown;
  maxIterations?: unknown;
  maxWallClockMs?: unknown;
  maxOutputChars?: unknown;
  cwd?: unknown;
  /** D1.4b — when true, mission text is parsed with heuristic planner. */
  autoPlan?: unknown;
  /** D1.4a — caller-supplied plan. Takes precedence over `autoPlan`. */
  plan?: unknown;
  /** G2/H1 — Terminal Agency target. Daemon-side forwards tool_call
   *  shell commands to the named pty instead of ACP's own subshell. */
  terminalAgency?: unknown;
}

/** Validate the `terminalAgency` body field — strict shape, no defaults. */
function coerceTerminalAgency(raw: unknown): TerminalAgencyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as {
    sessionId?: unknown;
    terminalId?: unknown;
    captureScreenshots?: unknown;
    captureDelayMs?: unknown;
    captureScale?: unknown;
    injectGuidance?: unknown;
  };
  if (typeof obj.sessionId !== 'string' || obj.sessionId.length === 0) return null;
  if (typeof obj.terminalId !== 'string' || obj.terminalId.length === 0) return null;
  const cfg: TerminalAgencyConfig = {
    sessionId: obj.sessionId,
    terminalId: obj.terminalId,
  };
  if (typeof obj.captureScreenshots === 'boolean') cfg.captureScreenshots = obj.captureScreenshots;
  if (typeof obj.captureDelayMs === 'number' && obj.captureDelayMs >= 0) cfg.captureDelayMs = obj.captureDelayMs;
  if (typeof obj.captureScale === 'number' && obj.captureScale > 0) cfg.captureScale = obj.captureScale;
  if (typeof obj.injectGuidance === 'boolean' || typeof obj.injectGuidance === 'string') {
    cfg.injectGuidance = obj.injectGuidance;
  }
  if (typeof (obj as { dryRun?: unknown }).dryRun === 'boolean') {
    cfg.dryRun = (obj as { dryRun: boolean }).dryRun;
  }
  if (typeof (obj as { strictRiskyPolicy?: unknown }).strictRiskyPolicy === 'boolean') {
    cfg.strictRiskyPolicy = (obj as { strictRiskyPolicy: boolean }).strictRiskyPolicy;
  }
  return cfg;
}

/**
 * Validate + coerce a caller-supplied plan blob into AutopilotPlan.
 * Returns `null` when shape is invalid — caller falls back to single-shot.
 */
function coercePlan(raw: unknown): AutopilotPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { ref?: unknown; steps?: unknown };
  const ref = typeof obj.ref === 'string' && obj.ref.length > 0 ? obj.ref : 'caller';
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  const steps: AutopilotPlanStep[] = [];
  for (const step of obj.steps) {
    if (!step || typeof step !== 'object') return null;
    const s = step as { id?: unknown; text?: unknown };
    if (typeof s.id !== 'string' || s.id.length === 0) return null;
    if (typeof s.text !== 'string' || s.text.length === 0) return null;
    steps.push({ id: s.id, text: s.text });
  }
  return { ref, steps };
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface AutopilotAgentAcquisitionOpts {
  createAgent?: (opts: AcpAgentOpts) => AcpAgent;
  agentManager?: Pick<AcpAgentManager, 'getAgent'>;
  createAgentManager?: () => AcpAgentManager;
}

export async function acquireAutopilotAgent(
  backend: string,
  cwd: string | undefined,
  opts: AutopilotAgentAcquisitionOpts = {},
): Promise<{ agent: AcpAgent; callerOwnsLifecycle: boolean }> {
  const agentOpts: Omit<AcpAgentOpts, 'backendId'> = { ...(cwd ? { cwd } : {}) };
  if (opts.createAgent) {
    const agent = opts.createAgent({ backendId: backend, ...agentOpts });
    try {
      await agent.start();
    } catch (error) {
      await agent.stop().catch(() => {});
      throw error;
    }
    return { agent, callerOwnsLifecycle: true };
  }
  if (!opts.agentManager) throw new Error('agentManager-required');
  return {
    agent: await opts.agentManager.getAgent(backend, agentOpts),
    callerOwnsLifecycle: false,
  };
}

export async function handleAutopilotRun(
  req: Request,
  acquisitionOpts: AutopilotAgentAcquisitionOpts = {},
): Promise<Response> {
  let raw: AutopilotRunBody;
  try {
    raw = (await req.json()) as AutopilotRunBody;
  } catch {
    return jsonError('invalid-json');
  }

  const mission = typeof raw.mission === 'string' ? raw.mission.trim() : '';
  if (!mission) return jsonError('mission-required');

  const backend = typeof raw.backend === 'string' && raw.backend.trim() ? raw.backend.trim() : 'claude';
  const maxIterations =
    typeof raw.maxIterations === 'number' && raw.maxIterations > 0
      ? Math.floor(raw.maxIterations)
      : 1;
  const maxWallClockMs =
    typeof raw.maxWallClockMs === 'number' && raw.maxWallClockMs > 0
      ? raw.maxWallClockMs
      : undefined;
  const maxOutputChars =
    typeof raw.maxOutputChars === 'number' && raw.maxOutputChars > 0
      ? raw.maxOutputChars
      : undefined;
  const cwd = typeof raw.cwd === 'string' && raw.cwd.length > 0 ? raw.cwd : undefined;
  // Plan resolution precedence: explicit `plan` > `autoPlan` heuristic > none.
  const explicitPlan = coercePlan(raw.plan);
  const autoPlan = raw.autoPlan === true;
  const plan: AutopilotPlan | null = explicitPlan
    ? explicitPlan
    : autoPlan
      ? parseHeuristicPlan(mission)
      : null;
  const terminalAgency = coerceTerminalAgency(raw.terminalAgency);

  const abortCtl = new AbortController();
  req.signal.addEventListener(
    'abort',
    () => {
      abortCtl.abort();
    },
    { once: true },
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client likely disconnected — abort the driver so the agent
          // shuts down promptly instead of running to budget exhaustion.
          abortCtl.abort();
        }
      };

      // MB-3 — backend === "monad-builtin" 시 in-process LLM rotation
      // (`runCoreTurn`) path. ACP CLI sub-process 안 spawn. tool surface
      // 는 monad 의 native registry (MB-2 helper).
      let agent: AcpAgent | null = null;
      let callerOwnsAgentLifecycle = false;
      const ownedManager = !acquisitionOpts.createAgent && !acquisitionOpts.agentManager
        ? (acquisitionOpts.createAgentManager?.() ?? new AcpAgentManager())
        : undefined;
      const agentManager = acquisitionOpts.agentManager ?? ownedManager;
      let runner: LlmTurnRunner;
      let sid: string;
      try {
        if (backend === MONAD_BUILTIN_BACKEND) {
          sid = `monad-builtin-${Date.now().toString(36)}`;
          const { tools, dispatchTool } = getAutopilotToolRegistry({
            surface: 'tui',
            sessionId: sid,
            signal: abortCtl.signal,
          });
          // MB-12 — mission-aware system prompt. classify(mission) 의 5-type
          // 별 specific guidance + terminal-agency 모드 시 추가 reminder.
          const systemPrompt = composeAutopilotSystemPrompt(mission, {
            terminalAgency: !!terminalAgency,
          });
          runner = new MonadBuiltinTurnRunner({
            sessionId: sid,
            tools,
            dispatchTool,
            systemPrompt,
          });
        } else {
          const acquired = await acquireAutopilotAgent(backend, cwd, { ...acquisitionOpts, agentManager });
          agent = acquired.agent;
          callerOwnsAgentLifecycle = acquired.callerOwnsLifecycle;
          sid = await agent.newSession();
          runner = new AcpTurnRunner(agent, sid);
        }

        // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B (2026-05-20) —
        // register active run BEFORE driver.run() so any POST /inject during
        // iter 1 can land in the queue. send('run-id', {...}) so the client
        // knows the runId to use against /v1/autopilot/<runId>/inject.
        const activeRun = registerActiveRun(sid, abortCtl);
        // Wire the live-steer hook when the backend agent supports codex
        // `turn/steer` (duck-typed). Generic ACP agents have no steer, so
        // `activeRun.steer` stays unset and `/inject` uses the FIFO queue.
        const steerable = agent as unknown as {
          steer?: (s: string, b: Array<{ type: 'text'; text: string }>) => Promise<boolean>;
        };
        if (agent && typeof steerable.steer === 'function') {
          const capturedSid = sid;
          activeRun.steer = (instruction) =>
            steerable.steer!(capturedSid, [{ type: 'text', text: instruction }]);
        }
        send('run-id', { runId: sid });

        const driver = new AutopilotLoopDriver({
          runner,
          sessionId: sid,
          mission,
          maxIterations,
          maxWallClockMs,
          maxOutputChars,
          onEnvelope: (env) => send('envelope', env),
          onUpdate: (update) => send('update', update),
          signal: abortCtl.signal,
          injectionQueue: { drain: makeDrainerForRun(activeRun) },
          ...(plan ? { plan } : {}),
          ...(terminalAgency ? { terminalAgency } : {}),
        });

        const result = await driver.run();
        send('result', result);
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B (2026-05-20) —
        // unregister the run so subsequent /inject calls return 404.
        // `sid` is set in the try block before driver init; guard for the
        // pre-registration error path where it may still be undefined.
        try {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (typeof sid! === 'string' && sid!.length > 0) {
            unregisterActiveRun(sid!);
          }
        } catch {
          // never blow up the SSE finalization on cleanup error
        }
        if (agent && callerOwnsAgentLifecycle) {
          try {
            await agent.stop();
          } catch {
            // best-effort
          }
        }
        try {
          await ownedManager?.dispose();
        } catch {
          // best-effort — preserve the SSE terminal event and closure
        }
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      }
    },
    cancel() {
      // Client tore down the connection — propagate to the driver.
      abortCtl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      // SSE proxies sometimes buffer — disable Nginx-style buffering.
      'x-accel-buffering': 'no',
    },
  });
}

// PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B (2026-05-20) —
// REST endpoint: `POST /v1/autopilot/<runId>/inject`
//
// Body: `{ instruction: string, kind?: 'append' }`
//   - instruction (required) — single non-empty string. Multi-line OK;
//     driver flattens newlines into spaces when building the marker.
//   - kind (optional, default 'append') — only 'append' supported in
//     Phase B. 'replace' (next-turn mission swap) is a Phase B.2 polish.
//
// Returns 200 `{ runId, queueDepth }` on success. 404 when runId unknown.
// 400 on missing/invalid body.
//
// Lifecycle: the driver drains the queue at the START of each iteration
// (before building the next prompt). Inject calls that arrive while an
// iteration is in flight land in the queue + are drained at the next
// iter-start. The last drain happens at the start of the FINAL iteration
// the budget allows — instructions injected after that point sit in the
// queue until `finally` unregisters the run (then are silently dropped).
// iOS UX should reflect "queued" state until the driver acks via the
// next agent.status `lastEvent=user injected N instruction(s)` envelope.

export async function handleAutopilotInject(
  req: Request,
  runId: string,
): Promise<Response> {
  if (!runId || typeof runId !== 'string') return jsonError('runId-required');
  const entry = activeRuns.get(runId);
  if (!entry) return jsonError('unknown-runId', 404);
  let body: { instruction?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as { instruction?: unknown; kind?: unknown };
  } catch {
    return jsonError('invalid-json');
  }
  const instruction =
    typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) return jsonError('instruction-required');
  const kind = typeof body.kind === 'string' ? body.kind : 'append';
  if (kind !== 'append') return jsonError('kind-not-supported');
  // Try to weave the instruction into the LIVE turn (codex turn/steer).
  // Only backends whose agent supports steer succeed; others (generic
  // ACP / monad-builtin) return false and we fall back to the queue.
  let steered = false;
  if (entry.steer) {
    try { steered = await entry.steer(instruction); }
    catch { steered = false; }
  }
  if (!steered) entry.injections.push(instruction);
  return new Response(
    JSON.stringify({ runId, steered, queueDepth: entry.injections.length }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
