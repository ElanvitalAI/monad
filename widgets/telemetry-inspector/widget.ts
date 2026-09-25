// ── Telemetry inspector widget ──
//
// Phase 4 P2b consumer (2026-04-20) — reads from a BufferedTelemetrySink
// (wired by the host) and displays recent events in a scrollable pane.
// Canonical consumer for the telemetry side of Phase 4a: widgets emit,
// this widget observes. Complements sparkline (canvas consumer) and
// fader (animation consumer) — 3-way primitive portfolio.
//
// State:
//   - events: Event[] cached snapshot (refreshed on each render pull)
//   - cursor: number (which event is selected)
//   - scroll: number (top-of-body index, for Scrollable behavior)
//   - filter: string (substring match on kind)
//   - filtering: boolean (in / key input mode)
//   - sinkSize: number (informational — sink buffer occupancy)
//
// Behaviors:
//   - Cursorable (j/k/g/G/Home/End against state.cursor)
//   - Filterable (/ enters filter mode, Esc exits, filter is a substr)
//
// Rendering:
//   - Title + N rows of "timestamp kind widgetId"
//   - Cursor row highlighted
//   - Filter bar below title when filtering
//   - Bottom-right badge shows "cursor/total (sink: N)"

import type { Widget } from '../../src/widgets/types.js';
import type { TelemetryEvent, TelemetrySink } from '../../src/widgets/types.js';
import type { BufferedTelemetrySink } from '../../src/widgets/inspector.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { cursorable, filterable } from '../../src/widget-behaviors/index.js';

/** Source interface — a read-only view onto a sink's event buffer. */
export interface TelemetrySource {
  events(): readonly TelemetryEvent[];
  get size(): number;
}

export interface TelemetryInspectorState {
  /** Most recent snapshot pulled from the source. Refreshed in render. */
  events: readonly TelemetryEvent[];
  /** Currently selected event index into the filtered list. */
  cursor: number;
  /** Top-of-visible-window index — Scrollable behavior mutates this. */
  scroll: number;
  maxScroll?: number;
  /** Total sink buffer occupancy (informational). */
  sinkSize: number;
  /** Substring filter on `kind` (empty = no filter). */
  filter: string;
  /** True while user is typing in the filter bar. */
  filtering: boolean;
  focused: boolean;
}

export interface TelemetryInspectorConfig {
  source?: TelemetrySource;
}

/** Module-level source ref — host wires once with setInspectorSource.
 *  Widget instances read via this indirection so tests can swap. */
let _defaultSource: TelemetrySource | null = null;
export function setInspectorSource(src: TelemetrySource | null): void {
  _defaultSource = src;
}

/** Attach a BufferedTelemetrySink as the global inspector source.
 *  Convenience wrapper — host typically does this once at init time. */
export function bindInspectorToSink(sink: BufferedTelemetrySink): void {
  _defaultSource = {
    events: () => sink.events(),
    get size() { return sink.size; },
  };
}

const telemetryInspectorWidget: Widget<TelemetryInspectorState, TelemetryInspectorConfig> = {
  type: 'telemetry-inspector',
  description: 'Observe widget telemetry events from a BufferedTelemetrySink',
  defaultCharacter: 'Telemetry',

  behaviors: [
    cursorable<TelemetryInspectorState>({
      getItemCount: (s) => filterEvents(s.events, s.filter).length,
    }),
    filterable<TelemetryInspectorState>(),
  ],

  initialState(config) {
    if (config?.source) _defaultSource = config.source;
    return {
      events: [],
      cursor: 0,
      scroll: 0,
      sinkSize: 0,
      filter: '',
      filtering: false,
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    // Pull fresh snapshot from the source.
    if (_defaultSource) {
      state.events = _defaultSource.events();
      state.sinkSize = _defaultSource.size;
    }
    const filtered = filterEvents(state.events, state.filter);

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(character, ctx.focused || state.focused, w));
    const titleRows = lines.length;

    if (state.filtering) {
      const bar = ` / ${state.filter}█`;
      lines.push(padRight(C.muted(bar), w));
    }

    const bodyH = Math.max(0, h - lines.length - 1);  // -1 for footer badge
    if (bodyH <= 0 || filtered.length === 0) {
      const label = state.filter
        ? `  (no events match "${state.filter}")`
        : `  (no telemetry events yet)`;
      lines.push(padRight(C.muted(label), w));
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    // Clamp cursor + compute scroll window.
    state.cursor = Math.max(0, Math.min(state.cursor, filtered.length - 1));
    state.maxScroll = Math.max(0, filtered.length - bodyH);
    if (state.cursor < state.scroll) state.scroll = state.cursor;
    if (state.cursor >= state.scroll + bodyH) state.scroll = state.cursor - bodyH + 1;
    state.scroll = Math.max(0, Math.min(state.scroll, state.maxScroll));

    const start = state.scroll;
    const end = Math.min(start + bodyH, filtered.length);
    for (let i = start; i < end && lines.length < h; i++) {
      const ev = filtered[i]!;
      const row = formatEvent(ev, w);
      if (i === state.cursor) {
        lines.push(padRight(C.cursor(row), w));
      } else {
        lines.push(padRight(row, w));
      }
    }

    // Footer badge — cursor/total + sink size.
    const footer = ` ${state.cursor + 1}/${filtered.length} · sink:${state.sinkSize} `;
    const footerLine = overlayRight(' '.repeat(w), C.muted(footer), w);
    // Ensure body is filled before footer.
    while (lines.length < h - 1) lines.push(' '.repeat(w));
    if (lines.length < h) lines.push(footerLine);
    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  onKey(ev, state, _ctx) {
    if (state.filtering) {
      // In-filter editing: backspace trims; printable chars append.
      if (ev.name === 'backspace') {
        state.filter = state.filter.slice(0, -1);
        state.cursor = 0;
        return { type: 'refresh' };
      }
      const ch = ev.name;
      if (ch && ch.length === 1 && ch !== ' ') {
        state.filter += ch;
        state.cursor = 0;
        return { type: 'refresh' };
      }
      return { type: 'none' };
    }
    if (ev.name === 'c') {
      // Clear filter from non-filtering state.
      if (state.filter) {
        state.filter = '';
        state.cursor = 0;
        return { type: 'refresh' };
      }
    }
    return { type: 'none' };
  },

  onMouse(ev, state, _ctx) {
    switch (ev.type) {
      case 'scroll-up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      case 'scroll-down':
        state.scroll = Math.min(state.maxScroll ?? state.scroll + 1, state.scroll + 1);
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  snapshot(state, _ctx) {
    const filtered = filterEvents(state.events, state.filter);
    const kinds: Record<string, number> = {};
    for (const e of state.events) {
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    }
    return {
      total: state.events.length,
      filtered: filtered.length,
      cursor: state.cursor,
      filter: state.filter || null,
      filtering: state.filtering,
      sinkSize: state.sinkSize,
      kinds,                // e.g. { 'cursor.move': 12, 'selection.change': 3 }
      cursorEvent: filtered[state.cursor] ?? null,
    };
  },

  describe(state, _ctx, row, _col) {
    const filtered = filterEvents(state.events, state.filter);
    if (row === 0) return `title row · ${filtered.length} of ${state.events.length} events`;
    if (state.filtering && row === 1) return `filter bar: "${state.filter}"`;
    const headerRows = 1 + (state.filtering ? 1 : 0);
    const idx = state.scroll + (row - headerRows);
    const ev = filtered[idx];
    if (!ev) return `row ${row}: (empty)`;
    return `row ${row}: event[${idx}] kind=${ev.kind} widgetId=${ev.widgetId ?? '?'} ts=${ev.ts ?? 0}`;
  },

  // WR-1 (Bundle 7W · 2026-04-20) — inspector is itself a telemetry
  // observer, so firing `telemetry-inspector.*` on every sink pull would
  // create a feedback loop (observer observes itself). We scope hooks to
  // the user-interaction axes: cursor / filter / filtering toggle — the
  // `events` array reference changes every render pull and is
  // intentionally NOT covered here.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'telemetry-inspector.cursor.change',
        data: { from: prev.cursor, to: next.cursor },
      });
    }
    if (prev.filter !== next.filter) {
      ctx.telemetry?.emit({
        kind: 'telemetry-inspector.filter.change',
        data: { filter: next.filter || null },
      });
    }
    if (prev.filtering !== next.filtering) {
      ctx.telemetry?.emit({
        kind: 'telemetry-inspector.filtering.change',
        data: { active: next.filtering },
      });
    }
  },

  // WR-2 — cursor + filter + filtering + sink size. Events reference is
  // omitted so the hash doesn't churn on every render pull from the
  // sink.
  snapshotHash(state): string {
    return `${state.cursor}:${state.filter.length}:${state.filtering ? 1 : 0}:${state.sinkSize}:${state.focused ? 1 : 0}`;
  },

  describeSurface(state, ctx): string {
    const filtered = filterEvents(state.events, state.filter);
    const parts = [ctx.character, `${filtered.length}/${state.events.length} events`];
    if (state.filter) parts.push(`filter "${state.filter}"`);
    if (state.filtering) parts.push('typing');
    parts.push(`sink ${state.sinkSize}`);
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        source: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional telemetry source adapter; host typically wires this globally.',
        },
      },
      additionalProperties: false,
    };
  },
};

function filterEvents(events: readonly TelemetryEvent[], filter: string): readonly TelemetryEvent[] {
  if (!filter) return events;
  const needle = filter.toLowerCase();
  return events.filter((e) => e.kind.toLowerCase().includes(needle));
}

function formatEvent(ev: TelemetryEvent, width: number): string {
  const ts = ev.ts ? new Date(ev.ts).toISOString().slice(11, 19) : '        ';
  const wid = ev.widgetId ?? '?';
  const line = ` ${C.muted(ts)} ${C.accent(ev.kind)} ${C.subtext(wid)}`;
  return truncate(line, Math.max(20, width - 1));
}

function padRight(s: string, w: number): string {
  const vis = visibleWidth(s);
  return vis >= w ? s : s + ' '.repeat(w - vis);
}

function overlayRight(line: string, label: string, width: number): string {
  const labelW = visibleWidth(label);
  if (labelW >= width) return label;
  const prefixW = width - labelW;
  return (line.length >= prefixW ? line.slice(0, prefixW) : line + ' '.repeat(prefixW - line.length)) + label;
}

/** Test helper sink implementation — a raw in-memory TelemetrySink the
 *  inspector can bind against without the dashboard scope. Mirrors
 *  BufferedTelemetrySink's surface. */
export class TestTelemetrySource implements TelemetrySink, TelemetrySource {
  private readonly buf: TelemetryEvent[] = [];
  emit(ev: TelemetryEvent): void {
    this.buf.push({ ...ev, ts: ev.ts ?? Date.now() });
  }
  events(): readonly TelemetryEvent[] {
    return this.buf;
  }
  get size(): number { return this.buf.length; }
  clear(): void { this.buf.length = 0; }
}

export default telemetryInspectorWidget;
