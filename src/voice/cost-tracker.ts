// PR-S1V.5 (sprint 21-Parallel-Voice · 2026-04-29) — Voice cost tracker.
//
// Records every STT/TTS API call so the user sees a running monthly
// total in the status bar (`🎙 $X.XX/mo`) and can spot runaway usage
// before the credit-card statement does. Mirrors the JSONL-append
// pattern from `src/intelligence-map/cost-meter.ts:109-155` so a
// process restart re-derives the in-memory total from disk and the
// audit log survives crashes.
//
// Architecture decisions (PLAN §4.3.2):
//   - Append-only JSONL at `~/.elanous/voice-cost-events.jsonl` — no
//     locking; each event is self-contained so concurrent appends from
//     the TUI process and the daemon REST handler can interleave
//     without logical loss.
//   - Monthly rollover is *derived* from each event's `ts` field; the
//     in-memory summary recomputes the current month on every read so
//     a long-running process automatically rolls over at midnight on
//     the 1st without explicit timer logic.
//   - Singleton via `globalVoiceCostTracker()` so the TUI process and
//     the daemon REST handler (when colocated) share one tracker.
//
// Reference: PLAN §4.3.2 · BACKLOG-voice-simulation-framework Phase B.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { debug } from '../debug/log.js';
import { getElanousConfigDir } from '../elanous-config-dir.js';
import {
  costForStt,
  costForTts,
  type VoiceCostId,
} from '../models/voice-costs.js';

// ── Event shape ────────────────────────────────────────────────────

export type VoiceCostEvent =
  | {
      kind: 'stt';
      ts: number;
      providerId: VoiceCostId;
      durationMs: number;
      usd: number;
      sessionId?: string;
    }
  | {
      kind: 'tts';
      ts: number;
      providerId: VoiceCostId;
      charCount: number;
      usd: number;
      sessionId?: string;
    };

export interface VoiceCostSummary {
  /** YYYY-MM of the current month — read so the status bar pill can
   *  display "$X.XX/mo (2026-05)" if the renderer wants it. */
  monthYYYYMM: string;
  sttUsd: number;
  ttsUsd: number;
  totalUsd: number;
  sttDurationSec: number;
  ttsCharCount: number;
}

// ── Tracker ─────────────────────────────────────────────────────────

export interface VoiceCostTrackerOpts {
  /** Override the JSONL path. Tests pass an in-memory or temp path so
   *  parallel runs don't clobber the user's real log. */
  eventPath?: string;
  /** Test seam — `Date.now` substitute for deterministic clocks. */
  now?: () => number;
  /** Test seam — disable disk persistence entirely. */
  disablePersist?: boolean;
}

export interface VoiceCostTracker {
  recordStt(opts: { providerId: VoiceCostId; durationMs: number; sessionId?: string }): VoiceCostEvent;
  recordTts(opts: { providerId: VoiceCostId; charCount: number; sessionId?: string }): VoiceCostEvent;
  /** Aggregate over the *current calendar month* in local time. */
  getMonthSummary(): VoiceCostSummary;
  /** Aggregate over the entire process lifetime — useful for dev /
   *  debugging when the user wants a smaller window than "this month". */
  getProcessSummary(): VoiceCostSummary;
  /** Subscribe to each event after it's persisted. Returns disposer. */
  subscribe(cb: (ev: VoiceCostEvent) => void): () => void;
  /** Reset in-memory state — tests only. */
  _reset(): void;
}

export function defaultVoiceCostEventPath(): string {
  // Honour the centralized config-dir resolver (#2384) so
  // `--config-dir <dir>` reroutes the JSONL log too. Falls back to
  // `~/.elanous/voice-cost-events.jsonl` when no override is set.
  return join(getElanousConfigDir(), 'voice-cost-events.jsonl');
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function createVoiceCostTracker(opts: VoiceCostTrackerOpts = {}): VoiceCostTracker {
  const eventPath = opts.eventPath ?? defaultVoiceCostEventPath();
  const persistEnabled = !opts.disablePersist;
  const now = opts.now ?? Date.now;
  const subscribers = new Set<(ev: VoiceCostEvent) => void>();

  // Process-lifetime accumulator. The "current month" view is derived
  // by filtering this list — the lists stay small (a few hundred events
  // per active month) so a single pass on each `getMonthSummary` call
  // is cheap and avoids stale-cache footguns.
  let events: VoiceCostEvent[] = [];

  // Replay JSONL on construction so a process restart sees the same
  // monthly total without waiting for fresh events. Best-effort —
  // corrupted lines are skipped with a debug log.
  if (persistEnabled && existsSync(eventPath)) {
    try {
      const raw = readFileSync(eventPath, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as VoiceCostEvent;
          events.push(ev);
        } catch (err) {
          if (debug.enabled)
            debug.log('voice.cost', 'replay.parse-error', {
              line: line.slice(0, 80), err: String(err),
            }, { level: 'error' });
        }
      }
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.cost', 'replay.read-error', { err: String(err) }, { level: 'error' });
    }
  }

  function persist(ev: VoiceCostEvent): void {
    if (!persistEnabled) return;
    try {
      const dir = dirname(eventPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(eventPath, JSON.stringify(ev) + '\n', 'utf-8');
    } catch (err) {
      // Disk full / permission — log and continue. The in-memory total
      // is still accurate; only the audit trail is broken.
      if (debug.enabled)
        debug.log('voice.cost', 'persist.error', { err: String(err) }, { level: 'error' });
    }
  }

  function emit(ev: VoiceCostEvent): void {
    events.push(ev);
    persist(ev);
    for (const cb of subscribers) {
      try { cb(ev); } catch { /* subscriber isolation */ }
    }
  }

  function recordStt(opts: { providerId: VoiceCostId; durationMs: number; sessionId?: string }): VoiceCostEvent {
    const usd = costForStt({ providerId: opts.providerId, durationMs: opts.durationMs });
    const ev: VoiceCostEvent = {
      kind: 'stt',
      ts: now(),
      providerId: opts.providerId,
      durationMs: opts.durationMs,
      usd,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    };
    emit(ev);
    return ev;
  }

  function recordTts(opts: { providerId: VoiceCostId; charCount: number; sessionId?: string }): VoiceCostEvent {
    const usd = costForTts({ providerId: opts.providerId, charCount: opts.charCount });
    const ev: VoiceCostEvent = {
      kind: 'tts',
      ts: now(),
      providerId: opts.providerId,
      charCount: opts.charCount,
      usd,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    };
    emit(ev);
    return ev;
  }

  function summarize(filtered: readonly VoiceCostEvent[], month: string): VoiceCostSummary {
    let sttUsd = 0;
    let ttsUsd = 0;
    let sttDurationMs = 0;
    let ttsCharCount = 0;
    for (const ev of filtered) {
      if (ev.kind === 'stt') {
        sttUsd += ev.usd;
        sttDurationMs += ev.durationMs;
      } else {
        ttsUsd += ev.usd;
        ttsCharCount += ev.charCount;
      }
    }
    return {
      monthYYYYMM: month,
      sttUsd,
      ttsUsd,
      totalUsd: sttUsd + ttsUsd,
      sttDurationSec: sttDurationMs / 1000,
      ttsCharCount,
    };
  }

  function getMonthSummary(): VoiceCostSummary {
    const month = monthKey(now());
    const filtered = events.filter((ev) => monthKey(ev.ts) === month);
    return summarize(filtered, month);
  }

  function getProcessSummary(): VoiceCostSummary {
    return summarize(events, monthKey(now()));
  }

  function subscribe(cb: (ev: VoiceCostEvent) => void): () => void {
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }

  function _reset(): void {
    events = [];
    subscribers.clear();
  }

  return {
    recordStt,
    recordTts,
    getMonthSummary,
    getProcessSummary,
    subscribe,
    _reset,
  };
}

// ── Process-wide singleton ─────────────────────────────────────────

let _global: VoiceCostTracker | null = null;

export function globalVoiceCostTracker(): VoiceCostTracker {
  if (!_global) _global = createVoiceCostTracker();
  return _global;
}

/** Test seam — replace the singleton (e.g. with a disablePersist
 *  instance pointing at a temp path). Always restore via the returned
 *  disposer to avoid leaking state into the next test file. */
export function setGlobalVoiceCostTrackerForTesting(t: VoiceCostTracker): () => void {
  const prev = _global;
  _global = t;
  return () => { _global = prev; };
}
