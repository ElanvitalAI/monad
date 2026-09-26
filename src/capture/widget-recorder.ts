// ── IUL Phase W foundation (Bundle 7T) — widget-recorder ──
//
// Subscribes to `WidgetHost.onInstanceStateChange` (Bundle 4W · WR-1),
// filters via `WidgetHost.snapshotHashFor` fast-path (Bundle 5W · WR-2),
// and serializes the timeline as asciicast v2.1 (extends v2 with a new
// `"w"` frame type carrying widget state snapshots).
//
// Cross-track ownership (PLAN-iul-closure-roadmap §0.5): consumes
// widget-team public APIs READ-ONLY · zero widget-team file edits.
//
// asciicast v2.1 format:
//   Line 1 — header JSON:
//     { "version": 2.1, "width", "height", "timestamp"?, "title"?,
//       "elanous": { "kind": "widget-timeline" } }
//   Each subsequent line — one frame as JSON array:
//     [ time_sec, "w", widgetId, stateSnapshot ]
//
// Legacy v2 readers (asciinema) skip unknown frame types per spec, so
// widget timelines stay backward-compatible even though they're not
// the classic terminal `"o"` stream. Phase 8+ adds StateTimelineViewer
// widget to render these frames as a scrubbable UI.

import type { WidgetStateChangeEvent, WidgetStateChangeSubscriber } from '../widgets/host.js';
import { debug } from '../debug/log.js';

/** READ-ONLY widget-host slice the recorder consumes. Subset of the
 *  full `WidgetHost`; declared here so the recorder stays decoupled
 *  from widget-team file evolution. */
export interface WidgetRecorderHost {
  onInstanceStateChange(cb: WidgetStateChangeSubscriber): () => void;
  snapshotHashFor?(id: string): string | null;
  get(id: string): { id: string; type: string; character: string; state: unknown } | null;
}

export interface WidgetRecorderOpts {
  readonly widgetHost: WidgetRecorderHost;
  readonly dims: { readonly cols: number; readonly rows: number };
  /** Keep only events for which this predicate returns true. Default
   *  = all events. Use to throttle sparkline-style widgets (rate
   *  limit per instance id) or restrict to a named set. */
  readonly filter?: (event: WidgetStateChangeEvent) => boolean;
  /** When true (default), skip an event whose `snapshotHashFor` equals
   *  the last recorded hash for the same widget id. Saves on
   *  high-frequency widgets whose `next` state is referentially new
   *  but structurally identical. */
  readonly skipUnchanged?: boolean;
  /** Override timestamp source for deterministic tests. Returns ms. */
  readonly now?: () => number;
  readonly title?: string;
  /** Epoch seconds for header metadata. Default Math.floor(now()/1000). */
  readonly startedAtSec?: number;
}

export interface WidgetTimelineFrame {
  /** Seconds since recorder.start(). Fractional ok. */
  readonly time: number;
  readonly type: 'w';
  readonly widgetId: string;
  readonly state: unknown;
}

export interface WidgetTimelineHeader {
  readonly version: 2.1;
  readonly width: number;
  readonly height: number;
  readonly timestamp?: number;   // epoch seconds
  readonly title?: string;
  readonly elanous: { readonly kind: 'widget-timeline' };
}

export interface ParsedWidgetTimeline {
  readonly header: WidgetTimelineHeader;
  readonly frames: readonly WidgetTimelineFrame[];
}

export type WidgetRecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface WidgetRecorderHandle {
  readonly status: WidgetRecorderStatus;
  readonly frameCount: number;
  readonly elapsedSec: number;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** Serialize to asciicast v2.1 string. Safe to call mid-recording;
   *  produces a valid prefix the reader can consume. */
  serialize(): string;
  /** Raw frame view — useful for tests and the eventual
   *  StateTimelineViewer widget that renders frames directly. */
  frames(): readonly WidgetTimelineFrame[];
  /** Latest recorded state for a widget id. Returns undefined when
   *  no frame has been captured for that id yet (even if the widget
   *  was pushed an event that was then skipped as unchanged). */
  lastStateOf(instanceId: string): unknown;
}

export class WidgetRecorderStateError extends Error {
  constructor(message: string, public readonly state: WidgetRecorderStatus) {
    super(`${message} (state: ${state})`);
    this.name = 'WidgetRecorderStateError';
  }
}

export function createWidgetRecorder(opts: WidgetRecorderOpts): WidgetRecorderHandle {
  const now = opts.now ?? (() => Date.now());
  const skipUnchanged = opts.skipUnchanged ?? true;
  const frames: WidgetTimelineFrame[] = [];
  const lastHashById = new Map<string, string>();
  const lastStateById = new Map<string, unknown>();
  let status: WidgetRecorderStatus = 'idle';
  let startedAtMs = 0;
  let pausedAtMs = 0;
  let pausedCumulativeMs = 0;
  let unsubscribe: (() => void) | null = null;

  function elapsedMsAt(tsMs: number): number {
    if (status === 'idle') return 0;
    const base = tsMs - startedAtMs;
    return Math.max(0, base - pausedCumulativeMs);
  }

  const handle: WidgetRecorderHandle = {
    get status() { return status; },
    get frameCount() { return frames.length; },
    get elapsedSec() {
      if (status === 'idle') return 0;
      if (status === 'paused') return elapsedMsAt(pausedAtMs) / 1000;
      return elapsedMsAt(now()) / 1000;
    },

    start() {
      if (status !== 'idle' && status !== 'stopped') {
        throw new WidgetRecorderStateError('start() only valid from idle or stopped', status);
      }
      // Allow re-start from stopped to continue a new session.
      if (status === 'stopped') {
        frames.length = 0;
        lastHashById.clear();
        lastStateById.clear();
        pausedCumulativeMs = 0;
      }
      startedAtMs = now();
      status = 'recording';
      unsubscribe = opts.widgetHost.onInstanceStateChange((event) => {
        if (status !== 'recording') return;
        if (opts.filter && !opts.filter(event)) return;

        if (skipUnchanged) {
          try {
            const hash = opts.widgetHost.snapshotHashFor?.(event.instanceId);
            if (hash) {
              if (lastHashById.get(event.instanceId) === hash) return;  // skip unchanged
              lastHashById.set(event.instanceId, hash);
            }
          } catch (err) {
            if (debug.enabled) {
              debug.log('widget.recorder.hash.error', event.instanceId, {
                err: (err as Error)?.message ?? String(err),
              }, { level: 'error' });
            }
            // fall through — record even without hash
          }
        }

        const timeSec = elapsedMsAt(now()) / 1000;
        frames.push({
          time: timeSec,
          type: 'w',
          widgetId: event.instanceId,
          state: event.next,
        });
        lastStateById.set(event.instanceId, event.next);
      });
    },

    stop() {
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* isolate */ }
        unsubscribe = null;
      }
      status = 'stopped';
    },

    pause() {
      if (status !== 'recording') {
        throw new WidgetRecorderStateError('pause() only valid from recording', status);
      }
      pausedAtMs = now();
      status = 'paused';
    },

    resume() {
      if (status !== 'paused') {
        throw new WidgetRecorderStateError('resume() only valid from paused', status);
      }
      pausedCumulativeMs += now() - pausedAtMs;
      status = 'recording';
    },

    serialize() {
      const startedAtSec = opts.startedAtSec ?? Math.floor(startedAtMs / 1000);
      const header: WidgetTimelineHeader = {
        version: 2.1,
        width: opts.dims.cols,
        height: opts.dims.rows,
        ...(startedAtSec ? { timestamp: startedAtSec } : {}),
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        elanous: { kind: 'widget-timeline' },
      };
      const lines: string[] = [JSON.stringify(header)];
      for (const f of frames) {
        try {
          lines.push(JSON.stringify([f.time, 'w', f.widgetId, f.state]));
        } catch (err) {
          // Unserializable state → emit placeholder so replay can
          // advance past the frame instead of the whole serialize
          // call throwing.
          lines.push(JSON.stringify([f.time, 'w', f.widgetId, { __unserializable: true }]));
          if (debug.enabled) {
            debug.log('widget.recorder.serialize.error', f.widgetId, {
              err: (err as Error)?.message ?? String(err),
            }, { level: 'error' });
          }
        }
      }
      return lines.join('\n') + '\n';
    },

    frames() { return [...frames]; },
    lastStateOf(instanceId) { return lastStateById.get(instanceId); },
  };

  return handle;
}

// ── Parse (inverse of serialize) ──────────────────────────────────

export class WidgetTimelineParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'WidgetTimelineParseError';
  }
}

export function parseWidgetTimeline(serialized: string): ParsedWidgetTimeline {
  const lines = serialized.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) {
    throw new WidgetTimelineParseError('empty serialization');
  }
  let header: WidgetTimelineHeader;
  try {
    const parsed = JSON.parse(lines[0]!) as WidgetTimelineHeader;
    if (parsed.version !== 2.1) {
      throw new WidgetTimelineParseError(`unsupported version ${parsed.version}`);
    }
    header = parsed;
  } catch (err) {
    if (err instanceof WidgetTimelineParseError) throw err;
    throw new WidgetTimelineParseError('header is not valid JSON', err);
  }

  const frames: WidgetTimelineFrame[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const f = JSON.parse(lines[i]!) as unknown[];
      if (!Array.isArray(f) || f.length !== 4) continue;
      const [time, type, widgetId, state] = f;
      if (type !== 'w') continue;             // unknown frame type · skip per v2 spec
      if (typeof time !== 'number') continue;
      if (typeof widgetId !== 'string') continue;
      frames.push({ time, type: 'w', widgetId, state });
    } catch {
      // Malformed individual frames are skipped · header already parsed
    }
  }
  return { header, frames };
}
