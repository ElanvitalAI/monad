// ── Capture substrate · ReAct self-diagnosis (PLAN P1 · §7 · §2) ──
//
// The observation foundation (P0~P5) lets monad SEE its own screen. This
// module adds the JUDGE half of the ReAct loop — WITHOUT the act half, so
// it needs no input arbiter (PLAN §6c "제어는 arbiter 선결"; this slice is
// diagnosis-only and arbiter-independent).
//
// The insight (PLAN §2·§7): a bug reveals itself as a DRIFT between the two
// kinds of text monad already captures —
//   • 화면 텍스트  = what the TUI rendered   (pty-manifest frame · P1~P3)
//   • 구조화 텍스트 = what the code logged     (logs.db · debug.log/observe)
// Correlating the two per surface catches the failure modes a single lens
// misses. Live-proven this session: a click whose SCREEN said "실행됨" while
// the LOG said route:none ≠ dispatch:submit (multi-path, only some
// instrumented). monad pointing at its own bug is the whole point of this
// milestone.
//
// Same decoupled/testable shape as `frame-memory.ts`:
//   1. correlateDrift(input) — pure verdict function (no I/O · unit-tested).
//   2. createDiagnosisConsumer({record}) — dedup/rate-limit so a standing
//      drift is flagged once, not every tick.
//   3. startFrameLogDiagnosisPoller — daemon-side: per framed surface, read
//      the log window since the last frame, correlate, and on drift record a
//      HIGH-importance `drift` event into surface_events (recallable via
//      `monad self recall`) + observe via debug.log. HITL notification wiring
//      is a deps injection point, DEFAULT OFF (signal wiring = 대표 decision).
//
// Conservative by design: drift findings surface to a human, so the
// heuristics prefer false negatives (miss) over false positives (cry wolf).
//
// cf. producer `tui-self-report.ts` · frame→memory `frame-memory.ts` ·
// store `domains/self-awareness.ts` (recordSelfEvent) · logs `mss/logging/log-store.ts`.

import { debug } from '../debug/log.js';
import { listPtyManifest, type PtyManifestRow } from '../pty-shell/pty-manifest.js';
import { classifyFrameState, detectAgentFromCmd, type FrameState } from './frame-state-detect.js';
import { recordSurfaceStateTransition } from '../pty-shell/pty-event-log.js';
import type { SelfEventInput } from '../domains/self-awareness.js';

/** The drift classes. `blocked-uninstrumented` (#1 state-aware): the screen
 *  shows a human-blocking prompt but the log window is silent — a HITL gate
 *  the code never observed (제1원칙: blocked-needing-HITL must be observable).
 *  `coord-offset` (parse/offset bug) is deliberately omitted from v1 — a
 *  generic screen-vs-log coordinate check is weak without per-widget geometry. */
export type DriftVerdict = 'instrumentation-gap' | 'false-normal' | 'multipath-partial' | 'blocked-uninstrumented';

/** A single log record projected into the correlation window. A thin subset
 *  of LogStoreRow so the correlator stays store-agnostic + testable. */
export interface LogWindowRecord {
  readonly level: string; // 'error' | 'warn' | 'info' | 'debug' | 'diag'
  readonly category: string;
  readonly event: string;
  readonly data?: string; // JSON string (LogStore stores data as text)
}

export interface DiagnosisInput {
  readonly surfaceId: string;
  readonly instance: string;
  /** Current rendered frame text. */
  readonly frameText: string;
  readonly frameAt: number;
  /** Previously observed frame text for this surface (null on first sight). */
  readonly prevFrameText: string | null;
  /** Log records in the window (prevFrameAt, frameAt] for this instance. */
  readonly logs: readonly LogWindowRecord[];
  /** #1 region-rule classified screen state (idle/working/blocked/…). When
   *  provided, enables the state-aware `blocked-uninstrumented` verdict. The
   *  frontier borrow: herdr's screen lens ⊕ our log lens = drift (§4). */
  readonly frameState?: FrameState;
}

export interface DriftFinding {
  readonly verdict: DriftVerdict;
  readonly surfaceId: string;
  readonly instance: string;
  readonly frameAt: number;
  /** Human-readable one-liner for the HITL surface / recall summary. */
  readonly reason: string;
  readonly evidence: {
    readonly frameChanged: boolean;
    readonly logCount: number;
    readonly hasSuccess: boolean;
    readonly hasNoOp: boolean;
    readonly hasError: boolean;
  };
}

// ── Signal extraction (pure heuristics over the log window) ──
// Match on event/data/category so a signal fires regardless of which field
// the instrumentation put the word in.

const SUCCESS_RE = /dispatch|submit|success|complete[d]?|sent|applied|routed\b/i;
const NOOP_RE = /route:?\s*none|no[-_ ]?dispatch|no[-_ ]?op|ignored|dropped|unhandled|route:none/i;

function hay(r: LogWindowRecord): string {
  return `${r.category} ${r.event} ${r.data ?? ''}`;
}

/** A log the code considers a "we did the thing" signal (info+ level). */
function isSuccessLog(r: LogWindowRecord): boolean {
  const lvl = r.level.toLowerCase();
  if (lvl === 'debug' || lvl === 'diag') return false; // ambient trace ≠ outcome claim
  return SUCCESS_RE.test(hay(r));
}

/** A log signalling a path saw the input but did NOT act (route:none 등). */
function isNoOpLog(r: LogWindowRecord): boolean {
  return NOOP_RE.test(hay(r));
}

function isErrorLog(r: LogWindowRecord): boolean {
  return r.level.toLowerCase() === 'error';
}

/** A log that would EXPLAIN a blocked screen — the code observed the HITL /
 *  approval / input-wait. `blocked-uninstrumented` fires only when NO such log
 *  exists; an UNRELATED log (a render tick) must NOT suppress it (review must-fix:
 *  logCount===0 was a Goodhart false-negative — any noise hid the gap). */
const BLOCK_EXPLAIN_RE = /approv|permission|hitl|await|confirm|prompt|question|need.?input|user.?input|blocked|decision.?gate|interrupt/i;
function isBlockExplainingLog(r: LogWindowRecord): boolean {
  return BLOCK_EXPLAIN_RE.test(hay(r));
}

// ── Frame change detection (normalized so borders/ANSI churn ≠ change) ──

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const BOX_RE = /[│┃|┌┐└┘─━┄┅┈┉╭╮╯╰═║╔╗╚╝├┤┬┴┼╠╣╦╩╬▏▕]/g;

function normalizeFrame(text: string): string {
  return text.replace(ANSI_RE, '').replace(BOX_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the rendered content meaningfully changed (ignoring border/ANSI
 *  churn). null prev = first sight = "no prior to compare" = not-changed. */
function frameChanged(cur: string, prev: string | null): boolean {
  if (prev === null) return false;
  return normalizeFrame(cur) !== normalizeFrame(prev);
}

/**
 * ⭐PLAN §7 — pure correlation of one surface's screen against its log
 * window. Returns the single most-severe drift finding, or null when the
 * two lenses agree (the common, healthy case).
 *
 * Verdicts, checked most-specific → least (a window can trip more than one
 * signal; we report the worst):
 *   1. false-normal      — logs claim success but the screen did NOT move.
 *                          The worst class: the code thinks it worked, the
 *                          user sees nothing.
 *   2. multipath-partial — contradictory paths in the same window: one says
 *                          no-op while the screen moved (or a success + a
 *                          no-op coexist). = multiple routes, only some
 *                          instrumented. (this session's live proof)
 *   3. instrumentation-gap — the screen moved but the window logged nothing:
 *                          a blind code path (nothing to correlate against
 *                          next time either).
 */
export function correlateDrift(input: DiagnosisInput): DriftFinding | null {
  const changed = frameChanged(input.frameText, input.prevFrameText);
  const logCount = input.logs.length;
  const hasSuccess = input.logs.some(isSuccessLog);
  const hasNoOp = input.logs.some(isNoOpLog);
  const hasError = input.logs.some(isErrorLog);
  const evidence = { frameChanged: changed, logCount, hasSuccess, hasNoOp, hasError } as const;

  const finding = (verdict: DriftVerdict, reason: string): DriftFinding => ({
    verdict, surfaceId: input.surfaceId, instance: input.instance, frameAt: input.frameAt, reason, evidence,
  });

  // (0) blocked-uninstrumented (#1 state-aware · highest) — the screen shows a
  // human-blocking prompt (approval/selection) yet NO block-explaining log
  // exists (unrelated logs don't count — review must-fix: any log used to
  // suppress = Goodhart false-negative). The system waits on a human but
  // observability can't know it. Catches STANDING blocks (no frame change).
  if (input.frameState === 'blocked' && !input.logs.some(isBlockExplainingLog)) {
    return finding('blocked-uninstrumented', `화면=blocked(사람 입력 대기) 인데 HITL 관련 로그 부재 — 관문 미계측 (${input.surfaceId})`);
  }

  // (1) false-normal — a success claim with a frozen screen. Only meaningful
  // when we HAD a prior frame to prove it didn't move (prevFrameText !== null)
  // and the window isn't merely an error (an error already explains inaction).
  if (input.prevFrameText !== null && hasSuccess && !changed && !hasError) {
    return finding('false-normal', `로그는 성공(dispatch/submit)인데 화면 무변화 — 거짓 정상 (${input.surfaceId})`);
  }

  // (2) multipath-partial — contradictory signals. Either a no-op log while
  // the screen visibly acted, or success+no-op coexisting in one window.
  if ((hasNoOp && changed) || (hasNoOp && hasSuccess)) {
    return finding('multipath-partial', `경로 상반: 로그=no-op 인데 화면=행동 (다중경로 일부만 계측) (${input.surfaceId})`);
  }

  // (3) instrumentation-gap — visible change, zero logs. A blind path.
  if (changed && logCount === 0) {
    return finding('instrumentation-gap', `화면 변화 + 윈도우 로그 0 — 계측 공백 (${input.surfaceId})`);
  }

  return null;
}

// ── Consumer (dedup / rate-limit) ──

export interface DiagnosisConsumerOpts {
  /** Sink for a drift event (e.g. recordSelfEvent bound to a db). */
  readonly record: (input: SelfEventInput) => void;
  /** Optional HITL surface hook (telegram/notify). DEFAULT unset — signal
   *  wiring is a 대표 decision, never auto-armed here. */
  readonly notify?: (finding: DriftFinding) => void;
  /** Min gap (ms) between recorded findings of the SAME (surface, verdict).
   *  Rate-limits a standing drift. Default 60s. */
  readonly minGapMs?: number;
  readonly now?: () => number;
}

export interface DiagnosisConsumer {
  /** Correlate + record on drift. Returns the finding when it was recorded
   *  (novel verdict for this surface OR minGapMs elapsed), else null. */
  observe(input: DiagnosisInput): DriftFinding | null;
}

const KEY_SEP = '\u0000'; // NUL separator (escape → source stays text, not binary)
function driftKey(f: DriftFinding): string { return `${f.instance}${KEY_SEP}${f.surfaceId}${KEY_SEP}${f.verdict}`; }

/** Map a drift finding to a HIGH-importance episodic self-event. Distinct
 *  `tool: 'react-diagnosis'` + `kind: 'drift'` so recall can single these out
 *  from ambient `tui-observe` frame memory (importance 4). */
export function driftToSelfEvent(f: DriftFinding): SelfEventInput {
  return {
    tool: 'react-diagnosis',
    kind: 'drift',
    summary: `[drift:${f.verdict}] ${f.reason}`,
    importance: 7, // actionable self-diagnosis — above ambient observation
    refs: {
      verdict: f.verdict,
      surfaceId: f.surfaceId,
      instance: f.instance,
      frameAt: f.frameAt,
      evidence: f.evidence,
    },
  };
}

export function createDiagnosisConsumer(opts: DiagnosisConsumerOpts): DiagnosisConsumer {
  const minGapMs = opts.minGapMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const last = new Map<string, number>();
  return {
    observe(input: DiagnosisInput): DriftFinding | null {
      const finding = correlateDrift(input);
      if (!finding) return null;
      const key = driftKey(finding);
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < minGapMs) return null; // standing drift — already flagged
      last.set(key, t);
      opts.record(driftToSelfEvent(finding));
      if (opts.notify) { try { opts.notify(finding); } catch { /* fail-soft */ } }
      return finding;
    },
  };
}

// ── Poller (daemon-side) ──

export interface FrameLogDiagnosisDeps {
  /** recordSelfEvent bound to an open surface_events db. Required. */
  readonly record: (input: SelfEventInput) => void;
  /** Read log records in (sinceMs, ∞) for this instance. Injected so the
   *  poller stays store-agnostic (real: LogStore.query). Returns newest-window
   *  records; the poller filters to each surface's frame window. */
  readonly queryLogsSince: (sinceMs: number) => LogWindowRecord[];
  readonly notify?: (finding: DriftFinding) => void;
  readonly listManifest?: () => PtyManifestRow[];
  /** #1 screen-state classifier. Default `classifyFrameState` (pure). */
  readonly classify?: (frame: string) => { state: FrameState };
  /** #1→#5 sink — record a classified state transition into the event log
   *  (feeds `waitForSurfaceState`). DEFAULT no-op in the pure poll (avoids DB
   *  in unit tests); the daemon starter injects `recordSurfaceStateTransition`. */
  readonly recordState?: (input: { instance: string; surfaceId: string; state: FrameState; agent?: string; now: number }) => void;
  readonly intervalMs?: number;
  readonly minGapMs?: number;
  readonly now?: () => number;
  readonly setIntervalFn?: (fn: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (h: unknown) => void;
}

/** Per-surface carry-over. `blockSince` = when the CURRENT blocked episode
 *  began (frame ts), so the standing-block log window is scoped to the episode
 *  (not a sliding wall-clock window that would drop the explaining log after N
 *  seconds, nor an unbounded since-forever window). Cleared when the block ends. */
interface PrevFrame { text: string; at: number; blockSince?: number }

/** First-sight episode boundary lookback — when a block is ALREADY present at
 *  first observation (no prior frame to mark the transition), start the episode
 *  window this far before the frame ts, so a HITL/approval log written just
 *  before the first render is still captured (review must-fix: else false P1). */
const FIRST_SIGHT_EPISODE_LOOKBACK_MS = 10_000;

/** One poll pass — for each live framed surface, correlate its new frame
 *  against the log window since its previous frame. Exported for tests
 *  (drive synchronously). Returns findings recorded this pass. Mutates
 *  `prevBySurface` to carry each surface's last frame across passes. */
export function pollFrameLogDiagnosis(
  consumer: DiagnosisConsumer,
  prevBySurface: Map<string, PrevFrame>,
  deps: Pick<FrameLogDiagnosisDeps, 'listManifest' | 'queryLogsSince' | 'classify' | 'recordState' | 'now'>,
): DriftFinding[] {
  const listManifest = deps.listManifest ?? listPtyManifest;
  const classify = deps.classify ?? ((frame: string) => classifyFrameState(frame));
  const nowFn = deps.now ?? Date.now;
  let rows: PtyManifestRow[];
  try { rows = listManifest(); } catch { return []; }
  const findings: DriftFinding[] = [];
  const liveIds = new Set<string>();
  for (const row of rows) {
    if (!row.alive || !row.frame || row.frameAt <= 0) continue;
    if (row.kind !== 'tui' && row.kind !== 'pty') continue; // same allowlist as broadcaster/memory
    liveIds.add(row.id);
    const prev = prevBySurface.get(row.id) ?? null;
    const isNewFrame = prev === null || row.frameAt > prev.at;
    const hasDelta = prev !== null && row.frameAt > prev.at; // a real frame→frame change
    // #1 classify EVERY poll (pure) so standing frames still carry a state.
    const frameState = classify(row.frame).state;
    // Episode tracking: when did the CURRENT blocked run begin? Carry it so the
    // standing-block log window is scoped to the episode (review must-fix:
    // sliding window drops the explaining log; since-forever grows unbounded).
    // Episode START = the TRANSITION boundary (previous frame's time), NOT the
    // blocked frame's own ts — the approval/HITL log is typically written just
    // BEFORE the block renders, so a since-frameAt window would miss it and
    // false-flag (review must-fix). First sight has no prior frame → use a
    // lookback boundary (not frameAt) so a pre-render HITL log is still captured.
    const blockSince = frameState === 'blocked'
      ? (prev?.blockSince ?? prev?.at ?? (row.frameAt - FIRST_SIGHT_EPISODE_LOOKBACK_MS))
      : undefined;
    // #1→#5 record the state transition on any NEW frame (incl. first sight —
    // seeds the event log for waitForSurfaceState). recordState is fail-soft +
    // a no-op by default (daemon injects the real DB).
    if (isNewFrame) {
      // #4 (review must-fix): populate `agent` so agent-pinned waits can match.
      // Derive it from the manifest cmd/kind (herdr process-name matching).
      const agent = detectAgentFromCmd(row.cmd, row.kind);
      try {
        deps.recordState?.({ instance: row.instance, surfaceId: row.id, state: frameState, now: nowFn(), ...(agent ? { agent } : {}) });
      } catch { /* fail-soft */ }
    }
    // (a) change-based correlation — needs a frame delta + the log window since
    // the previous frame (false-normal / multipath / instrumentation-gap).
    if (hasDelta) {
      let logs: LogWindowRecord[] = [];
      let queryFailed = false;
      try { logs = deps.queryLogsSince(prev!.at).filter((r) => matchesInstance(r, row.instance)); } catch { queryFailed = true; }
      // Skip on log-store failure — an empty result there would fabricate an
      // instrumentation-gap from a DB error (review must-fix: false P1).
      if (!queryFailed) {
        const finding = consumer.observe({
          surfaceId: row.id, instance: row.instance,
          frameText: row.frame, frameAt: row.frameAt,
          prevFrameText: prev!.text, logs, frameState,
        });
        if (finding) findings.push(finding);
      }
    } else if (frameState === 'blocked') {
      // (b) standing-block check — runs on first sight AND unchanged frames, so
      // a block present from startup that never redraws is still diagnosed
      // (review must-fix: the delta gate alone would miss it forever). Window =
      // the block EPISODE (since blockSince), so a block-explaining log at the
      // episode's start keeps suppressing for the whole episode (no window-slide
      // misdiagnosis) yet resets when the block clears (not unbounded). RELEVANCE
      // filter: only a block-explaining log counts. On log-store failure, SKIP
      // (don't fabricate a P1 from a DB error — review must-fix).
      let sLogs: LogWindowRecord[] = [];
      let queryFailed = false;
      try { sLogs = deps.queryLogsSince(blockSince!).filter((r) => matchesInstance(r, row.instance)); } catch { queryFailed = true; }
      if (!queryFailed && !sLogs.some(isBlockExplainingLog)) {
        const finding = consumer.observe({
          surfaceId: row.id, instance: row.instance,
          frameText: row.frame, frameAt: row.frameAt,
          prevFrameText: null, logs: [], frameState: 'blocked',
        });
        if (finding) findings.push(finding);
      }
    }
    // Persist carry-over — advance the frame on a new frame, and always update
    // the block episode marker (set while blocked, cleared otherwise).
    const carriedText = isNewFrame ? row.frame : (prev?.text ?? row.frame);
    const carriedAt = isNewFrame ? row.frameAt : (prev?.at ?? row.frameAt);
    prevBySurface.set(row.id, { text: carriedText, at: carriedAt, ...(blockSince !== undefined ? { blockSince } : {}) });
  }
  // Forget surfaces that vanished (bound the map across long daemon lifetimes).
  for (const id of prevBySurface.keys()) if (!liveIds.has(id)) prevBySurface.delete(id);
  return findings;
}

/** Instance provenance filter — the injected query returns this scope's logs
 *  (state-dir scoped store), but a shared state-dir can hold multiple
 *  instances (prod + a worktree). `LogWindowRecord` carries no instance field,
 *  so we conservatively accept all records here and rely on the store scope +
 *  the surface's own instance tag on the recorded event. Kept as a seam for a
 *  future instance-tagged log projection. */
function matchesInstance(_r: LogWindowRecord, _instance: string): boolean {
  return true;
}

/** Start the daemon-side ReAct diagnosis poller. Reads the shared pty-manifest
 *  for framed surfaces (cross-process), correlates each new frame against its
 *  log window, and records HIGH-importance `drift` events into surface_events.
 *  Returns a stop thunk. No-op when disabled via `MONAD_TUI_DIAGNOSIS=0`.
 *
 *  Isolation is STRUCTURAL (same as frame-memory): the manifest, the log store
 *  the caller wires `queryLogsSince` to, and the surface_events db `record`
 *  binds to are ALL scoped to the same `MONAD_STATE_DIR`. */
export function startFrameLogDiagnosisPoller(deps: FrameLogDiagnosisDeps): () => void {
  if (process.env.MONAD_TUI_DIAGNOSIS === '0') {
    if (debug.enabled) debug.log('capture.react-diagnosis', 'disabled', { reason: 'killswitch' });
    return () => {};
  }
  const intervalMs = deps.intervalMs ?? 5_000;
  const setIntervalFn: (fn: () => void, ms: number) => unknown = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn: (h: unknown) => void =
    deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const consumerOpts: DiagnosisConsumerOpts = { record: deps.record };
  if (deps.notify) (consumerOpts as { notify?: (f: DriftFinding) => void }).notify = deps.notify;
  if (deps.minGapMs !== undefined) (consumerOpts as { minGapMs?: number }).minGapMs = deps.minGapMs;
  if (deps.now) (consumerOpts as { now?: () => number }).now = deps.now;
  const consumer = createDiagnosisConsumer(consumerOpts);
  const prevBySurface = new Map<string, PrevFrame>();
  // Wire the real #1→#5 sink by default (classified state → event log). A
  // caller override wins; fail-soft is already inside recordSurfaceStateTransition.
  const recordState = deps.recordState ?? ((i: { instance: string; surfaceId: string; state: FrameState; agent?: string; now: number }) => {
    recordSurfaceStateTransition({ instance: i.instance, surfaceId: i.surfaceId, state: i.state, now: i.now, ...(i.agent ? { agent: i.agent } : {}) });
  });
  const pollDeps: Pick<FrameLogDiagnosisDeps, 'listManifest' | 'queryLogsSince' | 'classify' | 'recordState' | 'now'> = {
    queryLogsSince: deps.queryLogsSince, recordState,
  };
  if (deps.listManifest) (pollDeps as { listManifest?: () => PtyManifestRow[] }).listManifest = deps.listManifest;
  if (deps.classify) (pollDeps as { classify?: (f: string) => { state: FrameState } }).classify = deps.classify;
  if (deps.now) (pollDeps as { now?: () => number }).now = deps.now;
  let inFlight = false;
  const handle = setIntervalFn(() => {
    if (inFlight) return;
    inFlight = true;
    try {
      const found = pollFrameLogDiagnosis(consumer, prevBySurface, pollDeps);
      if (found.length > 0 && debug.enabled) {
        for (const f of found) debug.log('capture.react-diagnosis', 'drift', { verdict: f.verdict, surfaceId: f.surfaceId, reason: f.reason, evidence: f.evidence });
      }
    } catch { /* fail-soft */ } finally { inFlight = false; }
  }, intervalMs);
  (handle as { unref?: () => void }).unref?.();
  if (debug.enabled) debug.log('capture.react-diagnosis', 'started', { intervalMs });
  return () => { clearIntervalFn(handle); if (debug.enabled) debug.log('capture.react-diagnosis', 'stopped', {}); };
}
