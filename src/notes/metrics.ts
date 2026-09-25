// R-OCR.4.1 (2026-05-09) — in-memory metric collector for the camera
// → notes pipeline.
//
// Counts what's interesting at the dogfood layer without persisting:
//   - ocr request count (by provider · by polishMode · failures)
//   - save request count (by polishMode · failures)
//   - client-side events (cancel · edit · discard) — emitted by the
//     PWA review modal since the server can't observe them
//
// Persistence: optional `dayBucket` store (R6 v2 follow-up · 2026-05-09)
// adds per-date persistence on disk + S3 sync so daemon restart no
// longer zeroes today's count and reflection queries for yesterday/
// last-week return real data. The lifetime tally still exists as the
// in-memory state — day-bucket is a parallel write path.
//
// Cross-ref:
//   src/nexus/api/notes-from-image.ts (R-OCR.1 hook site)
//   src/nexus/api/notes-save.ts (R-OCR.3 hook site)
//   src/nexus/api/metrics-notes.ts (R-OCR.4.2 endpoints)
//   src/notes/day-bucket-store.ts (R6 v2 FU · day persistence)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.4

import type { DayBucketCounts, DayBucketStore } from './day-bucket-store.js';

export type NotesPolishMode = 'minimal' | 'enrich';
export type NotesClientEventType = 'cancel' | 'edit' | 'discard';

export interface NotesMetricsSnapshot {
  ocr: {
    total: number;
    failures: number;
    byProvider: Record<string, number>;
    byPolishMode: Record<string, number>;
  };
  save: {
    total: number;
    failures: number;
    byPolishMode: Record<string, number>;
  };
  client: {
    cancel: number;
    edit: number;
    discard: number;
  };
  startedAt: string;
  /** Snapshot ts — useful for `since` calculations on the consumer
   *  side without forcing every consumer to re-derive from
   *  `startedAt`. */
  ts: string;
}

export interface NotesMetricsCollector {
  /** Record an OCR request outcome. `ok=false` increments the failure
   *  counter; provider/polishMode buckets still advance so the user
   *  can see which provider was tried even on failure. */
  recordOcr(input: { provider?: string; polishMode?: string; ok: boolean }): void;
  /** Record a save request outcome. */
  recordSave(input: { polishMode?: string; ok: boolean }): void;
  /** Record a PWA-side event. The server can't observe these
   *  directly (the user hits Cancel inside the modal, the markdown
   *  edit happens before the Save POST fires) so the PWA modal POSTs
   *  them through `/v1/metrics/notes-event`. */
  recordClientEvent(input: { type: NotesClientEventType; polishMode?: string }): void;
  snapshot(): NotesMetricsSnapshot;
  /** Reset all counters. Tests use this to start clean; production
   *  callers should NOT — restart the daemon instead so the bucket
   *  semantics stay obvious. */
  reset(): void;
  /** R6 v2 FU — read counts for a specific YYYY-MM-DD from the
   *  day-bucket store. Returns zero counts when no bucket store is
   *  wired or no entry exists for that date. Daily reflection uses
   *  this for past-date queries. */
  daySnapshot(date: string): DayBucketCounts;
}

interface CollectorState {
  ocr: {
    total: number;
    failures: number;
    byProvider: Map<string, number>;
    byPolishMode: Map<string, number>;
  };
  save: {
    total: number;
    failures: number;
    byPolishMode: Map<string, number>;
  };
  client: {
    cancel: number;
    edit: number;
    discard: number;
  };
  startedAtMs: number;
}

function emptyState(now: number): CollectorState {
  return {
    ocr: {
      total: 0,
      failures: 0,
      byProvider: new Map(),
      byPolishMode: new Map(),
    },
    save: {
      total: 0,
      failures: 0,
      byPolishMode: new Map(),
    },
    client: { cancel: 0, edit: 0, discard: 0 },
    startedAtMs: now,
  };
}

function bumpMap(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function mapToObject(m: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of m) out[k] = v;
  return out;
}

function emptyDayCounts(): DayBucketCounts {
  return {
    ocr: { total: 0, failures: 0 },
    save: { total: 0, failures: 0 },
  };
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createNotesMetricsCollector(opts: {
  now?: () => number;
  /** R6 v2 FU — optional day-bucket store. When wired every recordOcr/
   *  recordSave also bumps today's bucket; reflection.ts reads past-
   *  date counts via daySnapshot(). Tests + offline boot pass undefined
   *  to keep behaviour identical to the in-memory-only baseline. */
  dayBucket?: DayBucketStore;
} = {}): NotesMetricsCollector {
  const now = opts.now ?? Date.now;
  const dayBucket = opts.dayBucket;
  let state = emptyState(now());

  return {
    recordOcr(input) {
      state.ocr.total += 1;
      if (!input.ok) state.ocr.failures += 1;
      if (input.provider) bumpMap(state.ocr.byProvider, input.provider);
      if (input.polishMode) bumpMap(state.ocr.byPolishMode, input.polishMode);
      if (dayBucket) {
        try { dayBucket.bumpOcr(dayKey(now()), input.ok); }
        catch { /* swallow · in-memory tally still recorded */ }
      }
    },
    recordSave(input) {
      state.save.total += 1;
      if (!input.ok) state.save.failures += 1;
      if (input.polishMode) bumpMap(state.save.byPolishMode, input.polishMode);
      if (dayBucket) {
        try { dayBucket.bumpSave(dayKey(now()), input.ok); }
        catch { /* swallow · in-memory tally still recorded */ }
      }
    },
    recordClientEvent(input) {
      state.client[input.type] += 1;
    },
    snapshot() {
      const ts = new Date(now()).toISOString();
      const startedAt = new Date(state.startedAtMs).toISOString();
      return {
        ocr: {
          total: state.ocr.total,
          failures: state.ocr.failures,
          byProvider: mapToObject(state.ocr.byProvider),
          byPolishMode: mapToObject(state.ocr.byPolishMode),
        },
        save: {
          total: state.save.total,
          failures: state.save.failures,
          byPolishMode: mapToObject(state.save.byPolishMode),
        },
        client: { ...state.client },
        startedAt,
        ts,
      };
    },
    reset() {
      state = emptyState(now());
    },
    daySnapshot(date) {
      if (!dayBucket) return emptyDayCounts();
      return dayBucket.get(date);
    },
  };
}
