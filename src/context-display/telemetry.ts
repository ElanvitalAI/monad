// ── Wave 1 · Context-display telemetry ──────────────────────────────
//
// Per-call LLM usage records buffered in-memory for the `/context`,
// `/usage`, and (Wave 5) auto-compact slashes. Each record captures
// the provider+model that ran the call, the timestamp, and the
// token breakdown reported by that provider's usage event.
//
// Why a ring buffer rather than reading `~/.monad/cost-events.jsonl`:
// the JSONL log persists across sessions and is the source of truth
// for cost rollups, but `/context` wants the *current session*'s
// recent calls to show "what's in context right now". The ring
// buffer never grows past `MAX_BUFFER_SIZE`, so long-running
// sessions stay bounded.

import type { LLMUsage } from '../prompt-cache/types.js';

/** Single LLM call record — one entry per `usage` event from the
 *  provider stream. Mirrors LLMUsage's nullable fields, plus the
 *  provider/model id and a wall-clock timestamp. */
export interface LlmCallTelemetry {
  /** Wall-clock ms epoch when the usage event was observed. */
  ts: number;
  /** Provider id from the catalog (anthropic/openai/grok/…). */
  provider: string;
  /** Model id (the catalog `id` field, not the family). */
  model: string;
  /** Optional role hint — main turn / summarizer / verify probe etc. */
  role?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Codex Responses API `reasoning_output_tokens`. Only set when the
   *  provider stream emitted it (Codex / o1 / Claude thinking). */
  reasoningOutputTokens?: number;
  /** Convenience sum: input + output (+ reasoning when present).
   *  Display surfaces use this to size the "blended_total" column;
   *  cost calculations should rely on the raw fields instead. */
  totalTokens: number;
}

/** Cap on in-memory records. Long sessions push out the oldest call
 *  first. 200 covers ~30 turns of multi-tool-call traffic — beyond
 *  that, `/context` aggregates dilute and the JSONL cost log is the
 *  better source. */
const MAX_BUFFER_SIZE = 200;

let buffer: LlmCallTelemetry[] = [];

/** Append a usage event to the ring buffer. Drops the oldest entry
 *  when the buffer is full. Idempotent on identical timestamps —
 *  callers that retry on stream restart are safe. */
export function recordLlmCall(record: Omit<LlmCallTelemetry, 'totalTokens'> & {
  totalTokens?: number;
}): void {
  const totalTokens = record.totalTokens
    ?? (record.inputTokens + record.outputTokens + (record.reasoningOutputTokens ?? 0));
  buffer.push({ ...record, totalTokens });
  if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
}

/** Bridge from the unified `LLMUsage` event shape to a telemetry
 *  record. Centralises the field rename + provider/model carry-over
 *  so the `runDashboardTurnUsageRuntime` callsite stays a one-liner.
 *  Returns the recorded entry so debug logs can pick it up. */
export function recordLlmUsage(args: {
  provider: string;
  model: string;
  usage: LLMUsage;
  role?: string;
  ts?: number;
  reasoningOutputTokens?: number;
}): LlmCallTelemetry {
  const ts = args.ts ?? Date.now();
  const inputTokens = args.usage.inputTokens ?? 0;
  const outputTokens = args.usage.outputTokens ?? 0;
  const cacheRead = args.usage.cacheReadInputTokens ?? 0;
  const cacheCreate = args.usage.cacheCreationInputTokens ?? 0;
  const reasoning = args.reasoningOutputTokens ?? 0;
  const total = inputTokens + outputTokens + reasoning;
  const entry: LlmCallTelemetry = {
    ts,
    provider: args.provider,
    model: args.model,
    inputTokens,
    outputTokens,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreate,
    totalTokens: total,
    ...(args.role ? { role: args.role } : {}),
    ...(reasoning > 0 ? { reasoningOutputTokens: reasoning } : {}),
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
  return entry;
}

/** Snapshot of the buffer in chronological order (oldest first).
 *  Returns a fresh array so callers can sort/filter without mutating
 *  the buffer. */
export function getRecentCalls(limit?: number): LlmCallTelemetry[] {
  const slice = limit !== undefined && limit < buffer.length
    ? buffer.slice(buffer.length - limit)
    : buffer.slice();
  return slice;
}

/** Most recent call, or null when the buffer is empty. Common on
 *  the `/context` happy path so we expose it as a one-liner. */
export function getLatestCall(): LlmCallTelemetry | null {
  return buffer.length === 0 ? null : { ...buffer[buffer.length - 1]! };
}

export interface SessionStats {
  callCount: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate: number;
  totalReasoning: number;
  perProvider: Record<string, {
    callCount: number;
    totalInput: number;
    totalOutput: number;
  }>;
  perModel: Record<string, {
    callCount: number;
    totalInput: number;
    totalOutput: number;
  }>;
  perRole: Record<string, {
    callCount: number;
    totalInput: number;
    totalOutput: number;
  }>;
}

/** Reduce the ring buffer into per-provider / per-model / per-role
 *  aggregates. Mirrors the dimensions Gemini's ModelStatsDisplay
 *  surfaces (per-role being the analogue of UTILITY_COMPRESSOR vs
 *  MAIN). Computed on demand — no incremental state to invalidate. */
export function getSessionStats(): SessionStats {
  const stats: SessionStats = {
    callCount: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheCreate: 0,
    totalReasoning: 0,
    perProvider: {},
    perModel: {},
    perRole: {},
  };
  for (const c of buffer) {
    stats.callCount += 1;
    stats.totalInput += c.inputTokens;
    stats.totalOutput += c.outputTokens;
    stats.totalCacheRead += c.cacheReadInputTokens;
    stats.totalCacheCreate += c.cacheCreationInputTokens;
    stats.totalReasoning += c.reasoningOutputTokens ?? 0;
    bumpBucket(stats.perProvider, c.provider, c);
    bumpBucket(stats.perModel, c.model, c);
    bumpBucket(stats.perRole, c.role ?? 'main', c);
  }
  return stats;
}

function bumpBucket(
  target: Record<string, { callCount: number; totalInput: number; totalOutput: number }>,
  key: string,
  c: LlmCallTelemetry,
): void {
  const slot = target[key] ?? { callCount: 0, totalInput: 0, totalOutput: 0 };
  slot.callCount += 1;
  slot.totalInput += c.inputTokens;
  slot.totalOutput += c.outputTokens;
  target[key] = slot;
}

/** Test isolation — tests that `recordLlmCall` should reset between
 *  cases. Production code never calls this. */
export function clearTelemetryForTest(): void {
  buffer = [];
}

/** Buffer size for diagnostics — exposed so the `/context` slash can
 *  show "captured N calls (max 200)". */
export function telemetryBufferStats(): { size: number; max: number } {
  return { size: buffer.length, max: MAX_BUFFER_SIZE };
}
