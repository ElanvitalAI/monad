// R6.1 (2026-05-09) — Daily reflection aggregator.
//
// Builds a deterministic daily snapshot: how much did monad do
// today? Sources today's data from already-running services
// (NotesMetricsCollector · DaemonSessionHistory) so the v1
// aggregator runs in zero ms with no LLM call. The Hansei-style
// LLM polish layer (R6 v2) wraps this snapshot — keeping the data
// path pure means the PWA reflection view + the eventual LLM
// summarizer share a stable contract.
//
// Cross-ref:
//   src/notes/metrics.ts (notes count source)
//   src/boot/daemon-runtime.ts (DaemonSessionSummary)
//   src/nexus/api/reflection.ts (GET endpoints)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R6

import type { NotesMetricsCollector } from './metrics.js';
import type {
  DaemonSessionHistory,
  DaemonSessionSummary,
} from '../boot/daemon-runtime.js';

export interface DailyReflectionSnapshot {
  /** ISO YYYY-MM-DD for the reflection day. */
  date: string;
  /** Notes successfully saved today (via R-OCR.3 endpoint). */
  notesSaved: number;
  /** OCR requests run today (success or failure). */
  ocrRuns: number;
  /** Sessions whose last activity falls inside the day. */
  sessionsToday: number;
  /** Up to 3 sessions ordered by today's message count, descending.
   *  Empty when no sessions had activity in the day window. */
  topSessions: Array<{
    id: string;
    msgCount: number;
    lastTurnAt: string;
    lastMsgPreview?: string;
  }>;
  /** Wall-clock generation timestamp (ISO). Useful for caching. */
  generatedAt: string;
}

export interface DailyReflectionInput {
  /** Day to aggregate · ISO YYYY-MM-DD. */
  date: string;
  /** Notes metric collector. Optional — when omitted notesSaved /
   *  ocrRuns default to 0 so the snapshot still renders. */
  metrics?: NotesMetricsCollector;
  /** Session history. Optional — sessionsToday defaults to 0. */
  history?: Pick<DaemonSessionHistory, 'summary'>;
  /** Wall-clock seam. Defaults to Date.now. */
  now?: () => number;
}

const TOP_SESSIONS_LIMIT = 3;

/** Parse a YYYY-MM-DD into [startOfDayMs, startOfNextDayMs] in UTC.
 *  Bad input (non-matching shape) returns null and the caller
 *  treats it as "no day window" → all counts zero. */
export function dayBounds(date: string): { startMs: number; endMs: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number.parseInt(m[1]!, 10);
  const mo = Number.parseInt(m[2]!, 10);
  const d = Number.parseInt(m[3]!, 10);
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const endMs = Date.UTC(y, mo - 1, d + 1, 0, 0, 0);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

/** Format a Date / ms to ISO YYYY-MM-DD (UTC). */
export function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Build a deterministic snapshot for `input.date`. Pure — no
 *  network, no LLM, no filesystem. The Hansei polish layer (R6
 *  v2) wraps this; tests pin both sides separately. */
export function buildDailyReflection(input: DailyReflectionInput): DailyReflectionSnapshot {
  const now = input.now ?? Date.now;
  const generatedAtMs = now();
  const generatedAt = new Date(generatedAtMs).toISOString();
  const bounds = dayBounds(input.date);

  // Notes counters:
  //   - v1 (in-memory only): lifetime totals when date===today, 0 otherwise.
  //   - v2 (day-bucket persisted · R6 v2 FU): metrics.daySnapshot(date)
  //     returns persisted per-day counts so daemon restarts no longer
  //     zero today's count and past dates return real data.
  //
  // Strategy: prefer the day-bucket snapshot whenever the metrics
  // collector exposes one with non-zero data; fall back to the
  // lifetime-tally path for today when the bucket is empty (covers
  // tests + the very first request after boot before any bump
  // landed in the bucket file).
  const todayKey = dateKey(generatedAtMs);
  const isToday = input.date === todayKey;
  let notesSaved = 0;
  let ocrRuns = 0;
  if (input.metrics) {
    const day = input.metrics.daySnapshot(input.date);
    notesSaved = Math.max(0, day.save.total - day.save.failures);
    ocrRuns = day.ocr.total;
    if (isToday && (notesSaved === 0 && ocrRuns === 0)) {
      // Day bucket empty (or store not wired) — fall back to the
      // in-memory lifetime tally so tests + boot-time queries still
      // surface counts that have only landed via recordOcr/save.
      const snap = input.metrics.snapshot();
      notesSaved = Math.max(0, snap.save.total - snap.save.failures);
      ocrRuns = snap.ocr.total;
    }
  }

  // Sessions whose lastTurnAt falls inside the day window.
  let inDay: DaemonSessionSummary[] = [];
  if (bounds && input.history) {
    const all = input.history.summary();
    inDay = all.filter((s) => {
      const turnMs = Date.parse(s.lastTurnAt);
      return Number.isFinite(turnMs) && turnMs >= bounds.startMs && turnMs < bounds.endMs;
    });
  }
  // Top 3 by msgCount, descending; tie-broken by lastTurnAt
  // (most recent first).
  const top = [...inDay].sort((a, b) => {
    if (b.msgCount !== a.msgCount) return b.msgCount - a.msgCount;
    const aMs = Date.parse(a.lastTurnAt);
    const bMs = Date.parse(b.lastTurnAt);
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  }).slice(0, TOP_SESSIONS_LIMIT);

  return {
    date: input.date,
    notesSaved,
    ocrRuns,
    sessionsToday: inDay.length,
    topSessions: top.map((s) => ({
      id: s.id,
      msgCount: s.msgCount,
      lastTurnAt: s.lastTurnAt,
      ...(s.lastMsgPreview !== undefined ? { lastMsgPreview: s.lastMsgPreview } : {}),
    })),
    generatedAt,
  };
}
