// Widget inspector — default snapshot / describe implementations.
//
// Phase 4a (2026-04-20) — landed alongside the LLM control tool surface.
// Widgets may provide their own `snapshot` / `describe` methods (see
// `Widget<S>` in widget-types.ts); when omitted, these helpers give the
// LLM a safe default read of the widget's state.
//
// `defaultSnapshot` shallow-copies primitive fields from state and
// replaces complex values with type placeholders. `defaultDescribe`
// returns a generic "widget <type> instance <id> (row R col C)" line
// with common cursor/scroll hints when present on state.

import type { Widget, WidgetContext, TelemetryEvent, TelemetrySink } from './types.js';

/** Keys we never include in a snapshot — they're either internal churn
 *  (`offset`, `widgetState`) or serialization hazards. Widgets that want
 *  these exposed should override `snapshot`. */
const SNAPSHOT_SKIP = new Set<string>(['offset']);

/** Max items to include from an array field before truncation. Keeps
 *  snapshots bounded regardless of widget payload size. */
const SNAPSHOT_ARRAY_LIMIT = 20;

/** Default snapshot — JSON-safe shallow projection of state. */
export function defaultSnapshot<S>(state: S): Record<string, unknown> {
  if (state == null || typeof state !== 'object') {
    return { value: state as unknown };
  }
  const out: Record<string, unknown> = {};
  const src = state as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (SNAPSHOT_SKIP.has(key)) continue;
    const v = src[key];
    out[key] = projectValue(v);
  }
  return out;
}

function projectValue(v: unknown): unknown {
  if (v == null) return v;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  if (t === 'function' || t === 'symbol') return `[${t}]`;
  if (Array.isArray(v)) {
    const arr = v.slice(0, SNAPSHOT_ARRAY_LIMIT).map(projectValue);
    if (v.length > SNAPSHOT_ARRAY_LIMIT) {
      arr.push(`…(+${v.length - SNAPSHOT_ARRAY_LIMIT} more)`);
    }
    return arr;
  }
  if (v instanceof Set) {
    return { __type: 'Set', size: v.size, sample: [...v].slice(0, 10) };
  }
  if (v instanceof Map) {
    const sample: [unknown, unknown][] = [];
    let i = 0;
    for (const [k, val] of v) {
      if (i++ >= 10) break;
      sample.push([k, projectValue(val)]);
    }
    return { __type: 'Map', size: v.size, sample };
  }
  if (v instanceof Date) return { __type: 'Date', iso: v.toISOString() };
  // Plain object — one-level deep (avoid recursion to keep snapshots terse).
  if (t === 'object') {
    const nested: Record<string, unknown> = {};
    const src = v as Record<string, unknown>;
    for (const k of Object.keys(src)) {
      const nv = src[k];
      const nt = typeof nv;
      if (nv == null || nt === 'string' || nt === 'number' || nt === 'boolean') {
        nested[k] = nv;
      } else if (Array.isArray(nv)) {
        nested[k] = `[Array len=${nv.length}]`;
      } else if (nt === 'object') {
        nested[k] = '[Object]';
      } else {
        nested[k] = `[${nt}]`;
      }
    }
    return nested;
  }
  return String(v);
}

/** Default describe — generic positional string. Widgets with richer
 *  semantics (agent id at row, file path at row) should override. */
export function defaultDescribe<S>(
  widgetType: string,
  widgetId: string,
  state: S,
  row: number,
  col: number,
): string {
  const parts: string[] = [`widget ${widgetType} (${widgetId}) · row=${row} col=${col}`];
  if (state && typeof state === 'object') {
    const s = state as Record<string, unknown>;
    if (typeof s.cursor === 'number') parts.push(`cursor=${s.cursor}`);
    if (typeof s.scroll === 'number') parts.push(`scroll=${s.scroll}`);
    if (typeof s.focused === 'boolean') parts.push(`focused=${s.focused}`);
  }
  return parts.join(' · ');
}

/** Dispatch helper — calls widget.snapshot override if present, else the
 *  default. Safe to call for any widget instance registered on the host. */
export function getWidgetSnapshot<S>(
  def: Widget<S, unknown>,
  state: S,
  ctx: WidgetContext<S>,
): Record<string, unknown> {
  if (def.snapshot) {
    try {
      return def.snapshot(state, ctx);
    } catch (err) {
      return { __error: String(err), __fallback: defaultSnapshot(state) };
    }
  }
  return defaultSnapshot(state);
}

/** Dispatch helper — calls widget.describe override if present, else the
 *  default. */
export function getWidgetDescription<S>(
  def: Widget<S, unknown>,
  state: S,
  ctx: WidgetContext<S>,
  row: number,
  col: number,
): string {
  if (def.describe) {
    try {
      return def.describe(state, ctx, row, col);
    } catch (err) {
      return `describe error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return defaultDescribe(def.type, ctx.widgetId, state, row, col);
}

/** A tiny telemetry sink that buffers events — useful as a host-side
 *  default when no real inspector is wired. Caller can drain with
 *  `flush()` or peek with `events`. */
export class BufferedTelemetrySink implements TelemetrySink {
  private readonly buf: TelemetryEvent[] = [];
  private readonly max: number;

  constructor(max = 500) {
    this.max = max;
  }

  emit(event: TelemetryEvent): void {
    const stamped: TelemetryEvent = {
      ...event,
      ts: event.ts ?? Date.now(),
    };
    this.buf.push(stamped);
    if (this.buf.length > this.max) this.buf.shift();
  }

  events(): readonly TelemetryEvent[] {
    return this.buf;
  }

  flush(): TelemetryEvent[] {
    const out = this.buf.slice();
    this.buf.length = 0;
    return out;
  }

  get size(): number {
    return this.buf.length;
  }
}

/** No-op sink — used when the host opts out of telemetry. */
export const noopTelemetry: TelemetrySink = {
  emit(_event: TelemetryEvent): void {
    /* discard */
  },
};
