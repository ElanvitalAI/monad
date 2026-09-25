// M3 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — feedback
// envelope → ChatBlock accumulator.
//
// Single source of truth for how a FeedbackEnvelopeWire mutates the
// running block list during a chat turn. Both `runChatTurnStreaming`
// (POST self-turn) and `runChatTurnObserver` (long-lived multi-tab
// observer) call this so the two paths can't diverge on the merge
// semantics — block lifecycle behaves the same wherever the wire
// originates.
//
// Merge contract:
//   - Same `env.blockId` → mutate the existing entry in place. start /
//     delta / update / end all converge on one block per id; renderer
//     reads `phase === 'end'`-derived flags (e.g. `done`) for terminal
//     styling.
//   - Unknown / unhandled kinds → return `'unhandled'`. Caller may
//     debug-log but MUST keep the stream alive (other kinds land in
//     M4/M5/M6).
//   - Schema-level validation (envelopeVersion · kind enum · phase
//     enum) is the caller's job (daemon-client's parsePromptSseStream
//     drops malformed envelopes before they reach here).

import type { ChatBlock } from './chat-runtime';
import type { FeedbackEnvelopeWire } from './feedback-envelope';

/** Per-kind narrowing for the envelope payloads we render. Wire-mirror
 *  of the daemon's payload types in `src/feedback/envelope.ts`. */
export interface AgentThinkingPayload {
  msg?: string;
  metrics?: { elapsedMs?: number; tokenCount?: number; thoughtMs?: number };
}

export interface AgentStatusPayload {
  agentId: string;
  status: 'running' | 'queued' | 'error' | 'done';
  lastEvent?: string;
}

export interface AgentPlanPayload {
  ref: string;
  steps: Array<{
    text: string;
    status: 'pending' | 'in-progress' | 'done' | 'skipped';
  }>;
  activeIndex?: number;
}

// M4 (2026-05-13) — wire-mirror of the daemon's tool.diff /
// tool.search-hit payloads (defined in `src/feedback/envelope.ts`).
// Renderer-side narrowing only; daemon stays authoritative on schema.

export interface DiffHunkLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface ToolDiffPayload {
  filePath: string;
  language?: string;
  hunks: DiffHunk[];
}

export interface SearchHit {
  filePath: string;
  line: number;
  column?: number;
  snippet: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface ToolSearchHitPayload {
  query: string;
  hits: SearchHit[];
  accumCount: number;
  truncated?: boolean;
}

// M5 (2026-05-13) — wire-mirror of the daemon's tool.progress payload.

export interface ToolProgressPayload {
  stream: 'stdout' | 'stderr' | 'http' | 'generic';
  lines: string[];
  bytesSoFar?: number;
  exitCode?: number;
}

// M6 PR 1 (2026-05-13) — wire-mirror of the daemon's debug.line payload.
// `category`/`event`/`data` mirror `debug.log(category, event, data?)`;
// `loggedAt` is the ms epoch the entry was emitted on the daemon clock
// (envelope.emittedAt may differ — debug-bridge fans out the raw
// log-time so the drawer's timestamp is the originating event's clock,
// not the wire send clock).
export interface DebugLinePayload {
  category: string;
  event: string;
  data?: unknown;
  loggedAt: number;
}

/** Cap mirrors the daemon-side bridge ring (200 entries · drop oldest).
 *  Keeping the cap on the PWA side too means an over-long mirror window
 *  still bounds memory on the chat client even if the daemon-side
 *  guard regresses. */
export const DEBUG_SESSION_LINE_CAP = 200;

// Opportunistic followup §6.2 #6 (2026-05-13) — wire-mirror of the
// daemon's perf.tick payload. Free-form metric string keeps the wire
// extensible (new metrics = no schema change).
export interface PerfTickPayload {
  metric: string;
  value: number;
  unit?: string;
}

/** Sparkline cap: 60 samples ≈ 60s at 1Hz. Older samples drop oldest
 *  so the SVG render set stays bounded regardless of session length. */
export const PERF_SESSION_SAMPLE_CAP = 60;

// PLAN-chat-hud-multi-surface-port-2026-05-13 §2.3 — wire-mirror of the
// daemon's hud.segment payload. State map (key → segment) — NOT a
// ChatBlock variant. chat-runtime keeps the Map<key, payload> outside
// the message-scoped blocks list because HUD is process-wide singleton
// (multi-tab/multi-session PWA shares the same HUD strip).
export type HudTone =
  | 'normal'
  | 'warn'
  | 'danger'
  | 'success'
  | 'info'
  | 'muted';

export interface HudSegmentPayload {
  key: string;
  value: string;
  priority?: number;
  tone?: HudTone;
  glyph?: string;
}

const VALID_HUD_TONES: ReadonlySet<string> = new Set<HudTone>([
  'normal',
  'warn',
  'danger',
  'success',
  'info',
  'muted',
]);

export type ApplyResult = 'applied' | 'unhandled';

/** Mutate `blocks` in place based on the envelope. Returns 'applied'
 *  when the block list changed (caller should re-snapshot for partial
 *  block handlers) or 'unhandled' when the envelope kind has no
 *  renderer yet — caller should NOT trigger a redraw on unhandled. */
export function applyFeedbackEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  switch (env.kind) {
    case 'agent.thinking':
      return applyThinkingEnvelope(blocks, env);
    case 'agent.status':
      return applyStatusEnvelope(blocks, env);
    case 'agent.plan':
      return applyPlanEnvelope(blocks, env);
    case 'tool.diff':
      return applyDiffEnvelope(blocks, env);
    case 'tool.search-hit':
      return applySearchHitEnvelope(blocks, env);
    case 'tool.progress':
      return applyProgressEnvelope(blocks, env);
    case 'debug.line':
      return applyDebugLineEnvelope(blocks, env);
    case 'perf.tick':
      return applyPerfTickEnvelope(blocks, env);
    default:
      return 'unhandled';
  }
}

function applyThinkingEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = (env.payload as AgentThinkingPayload) ?? {};
  const msg = payload.msg ?? 'Thinking';
  const metrics =
    payload.metrics &&
    typeof payload.metrics.elapsedMs === 'number' &&
    typeof payload.metrics.tokenCount === 'number'
      ? {
          elapsedMs: payload.metrics.elapsedMs,
          tokenCount: payload.metrics.tokenCount,
        }
      : undefined;
  const next: Extract<ChatBlock, { kind: 'agent_thinking' }> = {
    kind: 'agent_thinking',
    blockId: env.blockId,
    msg,
    done: env.phase === 'end',
    ...(metrics ? { metrics } : {}),
    ...(env.asciiFallback.length > 0 ? { asciiFallback: env.asciiFallback } : {}),
  };
  const idx = blocks.findIndex(
    (b) => b.kind === 'agent_thinking' && b.blockId === env.blockId,
  );
  if (idx === -1) blocks.push(next);
  else blocks[idx] = next;
  return 'applied';
}

function applyStatusEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as AgentStatusPayload | null | undefined;
  if (!payload || typeof payload.agentId !== 'string' || typeof payload.status !== 'string') {
    return 'unhandled';
  }
  const next: Extract<ChatBlock, { kind: 'agent_status' }> = {
    kind: 'agent_status',
    blockId: env.blockId,
    agentId: payload.agentId,
    status: payload.status,
    ...(payload.lastEvent !== undefined ? { lastEvent: payload.lastEvent } : {}),
  };
  const idx = blocks.findIndex(
    (b) => b.kind === 'agent_status' && b.blockId === env.blockId,
  );
  if (idx === -1) blocks.push(next);
  else blocks[idx] = next;
  return 'applied';
}

function applyPlanEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as AgentPlanPayload | null | undefined;
  if (!payload || typeof payload.ref !== 'string' || !Array.isArray(payload.steps)) {
    return 'unhandled';
  }
  const next: Extract<ChatBlock, { kind: 'agent_plan' }> = {
    kind: 'agent_plan',
    blockId: env.blockId,
    ref: payload.ref,
    steps: payload.steps.map((s) => ({ text: s.text, status: s.status })),
    ...(payload.activeIndex !== undefined ? { activeIndex: payload.activeIndex } : {}),
  };
  const idx = blocks.findIndex(
    (b) => b.kind === 'agent_plan' && b.blockId === env.blockId,
  );
  if (idx === -1) blocks.push(next);
  else blocks[idx] = next;
  return 'applied';
}

function applyDiffEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as ToolDiffPayload | null | undefined;
  if (!payload || typeof payload.filePath !== 'string' || !Array.isArray(payload.hunks)) {
    return 'unhandled';
  }
  // Defensive: each hunk must declare its line counts + ranges; drop
  // malformed envelopes wholesale rather than partial-render.
  for (const h of payload.hunks) {
    if (
      typeof h.oldStart !== 'number' ||
      typeof h.oldLines !== 'number' ||
      typeof h.newStart !== 'number' ||
      typeof h.newLines !== 'number' ||
      !Array.isArray(h.lines)
    ) {
      return 'unhandled';
    }
  }
  const next: Extract<ChatBlock, { kind: 'tool_diff' }> = {
    kind: 'tool_diff',
    blockId: env.blockId,
    filePath: payload.filePath,
    ...(payload.language !== undefined ? { language: payload.language } : {}),
    hunks: payload.hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines.map((l) => ({ kind: l.kind, text: l.text })),
    })),
    ...(env.parentToolCallId !== undefined
      ? { parentToolCallId: env.parentToolCallId }
      : {}),
  };
  const idx = blocks.findIndex(
    (b) => b.kind === 'tool_diff' && b.blockId === env.blockId,
  );
  if (idx === -1) blocks.push(next);
  else blocks[idx] = next;
  return 'applied';
}

function applySearchHitEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as ToolSearchHitPayload | null | undefined;
  if (
    !payload ||
    typeof payload.query !== 'string' ||
    !Array.isArray(payload.hits) ||
    typeof payload.accumCount !== 'number'
  ) {
    return 'unhandled';
  }
  for (const h of payload.hits) {
    if (
      typeof h.filePath !== 'string' ||
      typeof h.line !== 'number' ||
      typeof h.snippet !== 'string'
    ) {
      return 'unhandled';
    }
  }
  // phase=delta appends new hits while keeping cumulative count; phase=end
  // (or update) carries the final snapshot. The accumulator preserves the
  // larger hit list — server may legitimately drop snippets past a cap
  // and only ship the running count.
  const existing = blocks.findIndex(
    (b) => b.kind === 'tool_search_hits' && b.blockId === env.blockId,
  );
  const incomingHits = payload.hits.map((h) => ({
    filePath: h.filePath,
    line: h.line,
    snippet: h.snippet,
    ...(h.column !== undefined ? { column: h.column } : {}),
    ...(Array.isArray(h.contextBefore) ? { contextBefore: [...h.contextBefore] } : {}),
    ...(Array.isArray(h.contextAfter) ? { contextAfter: [...h.contextAfter] } : {}),
  }));
  let mergedHits = incomingHits;
  if (existing !== -1 && env.phase === 'delta') {
    const prev = blocks[existing] as Extract<ChatBlock, { kind: 'tool_search_hits' }>;
    // Dedupe by (filePath, line, column?) — the server may resend hits
    // across delta envelopes when it batches. Keep insertion order so
    // the user sees the natural file-walk order.
    const seen = new Set(
      prev.hits.map((h) => `${h.filePath}:${h.line}:${h.column ?? 0}`),
    );
    const dedupedIncoming = incomingHits.filter(
      (h) => !seen.has(`${h.filePath}:${h.line}:${h.column ?? 0}`),
    );
    mergedHits = [...prev.hits, ...dedupedIncoming];
  }
  const next: Extract<ChatBlock, { kind: 'tool_search_hits' }> = {
    kind: 'tool_search_hits',
    blockId: env.blockId,
    query: payload.query,
    hits: mergedHits,
    accumCount: payload.accumCount,
    ...(payload.truncated ? { truncated: true } : {}),
    ...(env.parentToolCallId !== undefined
      ? { parentToolCallId: env.parentToolCallId }
      : {}),
  };
  if (existing === -1) blocks.push(next);
  else blocks[existing] = next;
  return 'applied';
}

const VALID_STREAMS: ReadonlySet<string> = new Set([
  'stdout',
  'stderr',
  'http',
  'generic',
]);

function applyProgressEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as ToolProgressPayload | null | undefined;
  if (
    !payload ||
    typeof payload.stream !== 'string' ||
    !VALID_STREAMS.has(payload.stream) ||
    !Array.isArray(payload.lines)
  ) {
    return 'unhandled';
  }
  for (const l of payload.lines) {
    if (typeof l !== 'string') return 'unhandled';
  }
  const existing = blocks.findIndex(
    (b) => b.kind === 'tool_progress' && b.blockId === env.blockId,
  );
  // Phase semantics:
  //  - start:  create with payload.lines as the initial buffer.
  //  - delta:  append payload.lines to existing.
  //  - update: replace existing.lines (rare — server-side full snapshot).
  //  - end:    append payload.lines + flip done=true; carry exitCode.
  let mergedLines: string[];
  if (existing === -1) {
    mergedLines = [...payload.lines];
  } else {
    const prev = blocks[existing] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    if (env.phase === 'update') mergedLines = [...payload.lines];
    else mergedLines = [...prev.lines, ...payload.lines];
  }
  const next: Extract<ChatBlock, { kind: 'tool_progress' }> = {
    kind: 'tool_progress',
    blockId: env.blockId,
    stream: payload.stream,
    lines: mergedLines,
    done: env.phase === 'end',
    ...(payload.bytesSoFar !== undefined ? { bytesSoFar: payload.bytesSoFar } : {}),
    ...(payload.exitCode !== undefined ? { exitCode: payload.exitCode } : {}),
    ...(env.parentToolCallId !== undefined
      ? { parentToolCallId: env.parentToolCallId }
      : {}),
  };
  if (existing === -1) blocks.push(next);
  else blocks[existing] = next;
  return 'applied';
}

function applyDebugLineEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as DebugLinePayload | null | undefined;
  if (
    !payload
    || typeof payload.category !== 'string'
    || typeof payload.event !== 'string'
    || typeof payload.loggedAt !== 'number'
  ) {
    return 'unhandled';
  }
  const incoming = {
    seq: env.seq,
    category: payload.category,
    event: payload.event,
    ...(payload.data !== undefined ? { data: payload.data } : {}),
    loggedAt: payload.loggedAt,
  };
  const existing = blocks.findIndex(
    (b) => b.kind === 'debug_session' && b.blockId === env.blockId,
  );
  // One block per blockId; append the incoming line and drop oldest
  // when the ring overflows. seq is preserved on each entry so the
  // drawer can use it as a stable React key (envelopes never reuse
  // a seq within a blockId — SeqTracker on the daemon is monotonic).
  let mergedLines: typeof incoming[];
  if (existing === -1) {
    mergedLines = [incoming];
  } else {
    const prev = blocks[existing] as Extract<ChatBlock, { kind: 'debug_session' }>;
    mergedLines = [...prev.lines, incoming];
    if (mergedLines.length > DEBUG_SESSION_LINE_CAP) {
      mergedLines.splice(0, mergedLines.length - DEBUG_SESSION_LINE_CAP);
    }
  }
  const next: Extract<ChatBlock, { kind: 'debug_session' }> = {
    kind: 'debug_session',
    blockId: env.blockId,
    lines: mergedLines,
  };
  if (existing === -1) blocks.push(next);
  else blocks[existing] = next;
  return 'applied';
}

/** Mutate the HUD state map based on the envelope. HUD lives **outside**
 *  the `ChatBlock[]` because it is process-wide (multi-tab/multi-session
 *  PWA shares the same HUD strip) — see PLAN-chat-hud-multi-surface-port
 *  §2.3 (state map vs turn-scoped block).
 *
 *  Phase semantics:
 *    - 'update' (or 'start'/'delta')  →  upsert state.set(key, payload)
 *    - 'end'                          →  state.delete(key)
 *
 *  Returns 'applied' on state change · 'unhandled' on malformed payload
 *  or clear-of-absent-key (caller can debug-log but MUST keep stream
 *  alive; subsequent envelopes may be valid). */
export function applyHudSegmentEnvelope(
  state: Map<string, HudSegmentPayload>,
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as HudSegmentPayload | null | undefined;
  if (!payload || typeof payload.key !== 'string' || payload.key.length === 0) {
    return 'unhandled';
  }
  if (env.phase === 'end') {
    if (!state.has(payload.key)) return 'unhandled';
    state.delete(payload.key);
    return 'applied';
  }
  if (typeof payload.value !== 'string') return 'unhandled';
  const next: HudSegmentPayload = {
    key: payload.key,
    value: payload.value,
    ...(typeof payload.priority === 'number' && Number.isFinite(payload.priority)
      ? { priority: payload.priority }
      : {}),
    ...(typeof payload.tone === 'string' && VALID_HUD_TONES.has(payload.tone)
      ? { tone: payload.tone as HudTone }
      : {}),
    ...(typeof payload.glyph === 'string' && payload.glyph.length > 0
      ? { glyph: payload.glyph }
      : {}),
  };
  state.set(payload.key, next);
  return 'applied';
}

function applyPerfTickEnvelope(
  blocks: ChatBlock[],
  env: FeedbackEnvelopeWire,
): ApplyResult {
  const payload = env.payload as PerfTickPayload | null | undefined;
  if (
    !payload
    || typeof payload.metric !== 'string'
    || payload.metric.length === 0
    || typeof payload.value !== 'number'
    || !Number.isFinite(payload.value)
  ) {
    return 'unhandled';
  }
  const incoming = {
    seq: env.seq,
    metric: payload.metric,
    value: payload.value,
    ...(typeof payload.unit === 'string' ? { unit: payload.unit } : {}),
    emittedAt: env.emittedAt,
  };
  const existing = blocks.findIndex(
    (b) => b.kind === 'perf_session' && b.blockId === env.blockId,
  );
  let merged: typeof incoming[];
  if (existing === -1) {
    merged = [incoming];
  } else {
    const prev = blocks[existing] as Extract<ChatBlock, { kind: 'perf_session' }>;
    merged = [...prev.samples, incoming];
    if (merged.length > PERF_SESSION_SAMPLE_CAP) {
      merged.splice(0, merged.length - PERF_SESSION_SAMPLE_CAP);
    }
  }
  const next: Extract<ChatBlock, { kind: 'perf_session' }> = {
    kind: 'perf_session',
    blockId: env.blockId,
    samples: merged,
  };
  if (existing === -1) blocks.push(next);
  else blocks[existing] = next;
  return 'applied';
}
