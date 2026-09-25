// Intent-prediction · feedback store — Phase 0.5.
//
// Records every (context, chosen) pair the user confirms via the
// PWA Intent panel. The ranker reads aggregate counts back into
// `IntentContext.recentTaps` (recency boost) on subsequent ticks,
// closing the simplest possible feedback loop without a real KGS
// integration. KGS write-through lands as a follow-up.
//
// Storage model (Phase 0.5):
//   • In-memory ring buffer per session, capped at 100 records.
//   • Optional JSON-line append to `~/.monad/intent-feedback.jsonl`
//     when `persistencePath` is supplied — the daemon wires this
//     so the store survives restarts.
//   • Reads are O(1) for "last N labels" queries; writes are
//     O(1) for in-memory + an async fs.appendFile when persisting.
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7
//   내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.1

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  IntentButtonLabel,
  IntentFeedback,
} from './types.js';

export interface FeedbackStoreOpts {
  /** Cap for the in-memory ring buffer per session (default 100). */
  capacity?: number;
  /** When set, every record is also appended to this JSONL file
   *  for crash-resilience. The path is canonicalized on first use;
   *  parent directories are created lazily. Reads on construction
   *  rehydrate the in-memory buffer (so a restart preserves the
   *  recent tap history the ranker consults). */
  persistencePath?: string;
}

export interface FeedbackStore {
  record(feedback: IntentFeedback): void;
  /** Most-recent labels (newest first) for a given session, capped
   *  at `n`. Used by the ranker's recency boost. */
  recentForSession(sessionId: string, n: number): IntentButtonLabel[];
  /** All recorded labels (newest first) regardless of session.
   *  Reserved for the global tally view; not consumed by the
   *  ranker today. */
  recentGlobal(n: number): IntentButtonLabel[];
  /** Total feedback count. Diagnostics + telemetry. */
  size(): number;
  /** Drop in-memory buffers + (optionally) truncate the JSONL
   *  file. Called from tests + shutdown. */
  reset(opts?: { wipePersistence?: boolean }): void;
}

interface SessionBuffer {
  labels: IntentButtonLabel[];      // newest first
  total: number;                    // monotonic — for diagnostics
}

export function createFeedbackStore(opts: FeedbackStoreOpts = {}): FeedbackStore {
  const capacity = Math.max(1, opts.capacity ?? 100);
  const perSession = new Map<string, SessionBuffer>();
  const globalLabels: IntentButtonLabel[] = [];

  // Rehydrate from persistence — best-effort. Malformed lines
  // skip silently so a single corrupt entry doesn't poison the
  // whole store.
  if (opts.persistencePath && existsSync(opts.persistencePath)) {
    try {
      const raw = readFileSync(opts.persistencePath, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as IntentFeedback;
          if (typeof parsed.sessionId !== 'string') continue;
          if (typeof parsed.chosen !== 'string') continue;
          appendInMemory(parsed);
        } catch { /* skip malformed line */ }
      }
    } catch { /* skip rehydrate on read error */ }
  }

  function appendInMemory(feedback: IntentFeedback): void {
    let buf = perSession.get(feedback.sessionId);
    if (!buf) {
      buf = { labels: [], total: 0 };
      perSession.set(feedback.sessionId, buf);
    }
    buf.labels.unshift(feedback.chosen);
    if (buf.labels.length > capacity) buf.labels.length = capacity;
    buf.total += 1;
    globalLabels.unshift(feedback.chosen);
    if (globalLabels.length > capacity) globalLabels.length = capacity;
  }

  function persist(feedback: IntentFeedback): void {
    if (!opts.persistencePath) return;
    try {
      const dir = dirname(opts.persistencePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(opts.persistencePath, JSON.stringify(feedback) + '\n');
    } catch { /* swallow — best-effort */ }
  }

  return {
    record(feedback) {
      appendInMemory(feedback);
      persist(feedback);
    },
    recentForSession(sessionId, n) {
      const buf = perSession.get(sessionId);
      if (!buf) return [];
      return buf.labels.slice(0, Math.max(0, n));
    },
    recentGlobal(n) {
      return globalLabels.slice(0, Math.max(0, n));
    },
    size() {
      let total = 0;
      for (const buf of perSession.values()) total += buf.total;
      return total;
    },
    reset(resetOpts) {
      perSession.clear();
      globalLabels.length = 0;
      if (resetOpts?.wipePersistence && opts.persistencePath) {
        try {
          // Truncate by overwriting with empty content. Avoids
          // requiring fs.unlink (more permissions friction).
          appendFileSync(opts.persistencePath, '', { flag: 'w' });
        } catch { /* swallow */ }
      }
    },
  };
}
