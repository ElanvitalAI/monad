// ── Sparkline widget ──
//
// Phase 4d (2026-04-20) — first consumer widget for the Phase 4
// primitives (canvas + animation + LLM-inspector). Renders a compact
// time-series plot in a single pane using the braille 2×4 canvas, with
// optional fade-in animation on value updates and a widget-specific
// `snapshot` / `describe` override so the LLM gets useful shape info
// instead of a bare `{ samples: [...] }` blob.
//
// Canonical consumer pattern:
//   1. initialState seeds a ring buffer of samples + cursor
//   2. render() requests a Canvas from ctx.canvas?.create(w, h - 1)
//      and plots (idx → x, value → y) with canvas.line()
//   3. ctx.animate?.progress('fade') modulates how many samples are
//      visible during the initial reveal animation
//   4. snapshot() returns bounded stats (min/max/avg/last) instead of
//      the full 200-element sample array
//   5. describe(row, col) translates pointer coordinates back to
//      "at column C: value 0.42" so the LLM can point at data without
//      inspecting raw pixels
//
// onKey — `c` clears the buffer. The Cursorable behavior is NOT a good
// fit here (no discrete row cursor); scrolling is also meaningless for
// a streaming value plot.

import type { Widget } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';

export interface SparklineState {
  /** Ring buffer of samples. New values appended via push(); oldest
   *  drops when length > capacity. */
  samples: number[];
  capacity: number;
  /** Optional y-axis min/max override. null = autoscale over current samples. */
  min?: number | null;
  max?: number | null;
  /** Color token for plotted pixels — braille glyphs are foreground-only. */
  color?: 'accent' | 'success' | 'warning' | 'error' | 'info';
  /** Optional unit suffix for the rendered min/max labels. */
  unit?: string;
  /** True when this widget is focused — drives title emphasis. */
  focused: boolean;
  /** Selected sample index from mouse interaction. */
  selectedIndex?: number | null;
}

export interface SparklineConfig {
  samples?: number[];
  capacity?: number;
  min?: number | null;
  max?: number | null;
  color?: SparklineState['color'];
  unit?: string;
}

const DEFAULT_CAPACITY = 200;

const sparklineWidget: Widget<SparklineState, SparklineConfig> = {
  type: 'sparkline',
  description: 'Braille-rendered time-series plot with optional fade-in animation',
  defaultCharacter: 'Sparkline',

  initialState(config) {
    const capacity = Math.max(2, config?.capacity ?? DEFAULT_CAPACITY);
    const seed = (config?.samples ?? []).slice(-capacity);
    return {
      samples: seed,
      capacity,
      min: config?.min ?? null,
      max: config?.max ?? null,
      color: config?.color ?? 'accent',
      unit: config?.unit,
      focused: false,
      selectedIndex: null,
    };
  },

  onMount(_state, ctx) {
    ctx.animate?.tween({
      key: 'reveal',
      durationMs: 400,
      curve: 'easeOut',
    });
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 2) return lines;

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(character, ctx.focused || state.focused, w));
    const bodyH = Math.max(0, h - lines.length);
    if (bodyH === 0) return lines;

    const samples = state.samples;
    if (samples.length < 2) {
      const msg = C.muted(`  (waiting for data${state.unit ? ` — ${state.unit}` : ''})`);
      lines.push(padRight(msg, w));
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    const canvas = ctx.canvas?.create(w, bodyH, 'braille');
    if (!canvas) {
      // Graceful fallback — no canvas support, render empty body.
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    const reveal = ctx.animate?.progress('reveal') ?? 1;
    const visibleCount = Math.max(2, Math.ceil(samples.length * Math.max(0, Math.min(1, reveal))));
    const slice = samples.slice(-visibleCount);

    const [minV, maxV] = computeRange(slice, state.min, state.max);
    const span = Math.max(1e-9, maxV - minV);
    const pixelW = canvas.width;
    const pixelH = canvas.height;

    // Map sample index → x, value → y; connect with line segments.
    let prevX = 0;
    let prevY = valueToY(slice[0]!, minV, span, pixelH);
    for (let i = 1; i < slice.length; i++) {
      const x = Math.round(((i) / (slice.length - 1)) * (pixelW - 1));
      const y = valueToY(slice[i]!, minV, span, pixelH);
      canvas.line(prevX, prevY, x, y);
      prevX = x;
      prevY = y;
    }

    const rendered = canvas.render();
    const color = pickColor(state.color ?? 'accent');
    for (let i = 0; i < rendered.length && lines.length < h; i++) {
      lines.push(padRight(color(rendered[i]!), w));
    }

    // Last-value + range badge overlays the top-right corner if room.
    if (lines.length >= 2) {
      const selectedIndex = state.selectedIndex != null
        ? Math.max(0, Math.min(samples.length - 1, state.selectedIndex))
        : null;
      const selectedValue = selectedIndex != null ? samples[selectedIndex]! : slice[slice.length - 1]!;
      const label = formatLabel(selectedValue, minV, maxV, state.unit, selectedIndex);
      lines[1] = overlayRight(lines[1]!, label, w);
    }

    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  onKey(ev, state, ctx) {
    if (ev.name === 'c') {
      state.samples = [];
      ctx.animate?.cancel('reveal');
      ctx.telemetry?.emit({ kind: 'sparkline.cleared', data: { capacity: state.capacity } });
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  onMouse(ev, state, _ctx) {
    const samples = state.samples;
    if (samples.length < 2) return { type: 'none' };

    if (ev.type === 'scroll-up' || ev.type === 'scroll-down') {
      const current = state.selectedIndex ?? (samples.length - 1);
      const delta = ev.type === 'scroll-up' ? -1 : 1;
      state.selectedIndex = Math.max(0, Math.min(samples.length - 1, current + delta));
      return { type: 'refresh' };
    }
    if (ev.type !== 'click' && ev.type !== 'double-click') return { type: 'none' };

    if (ev.row < 1) return { type: 'none' };
    const idx = Math.round((ev.col / Math.max(1, samples.length - 1)) * (samples.length - 1));
    state.selectedIndex = Math.max(0, Math.min(samples.length - 1, idx));
    return { type: 'refresh' };
  },

  /** Bounded snapshot — 200-sample array gets projected to key stats. */
  snapshot(state, _ctx) {
    const n = state.samples.length;
    if (n === 0) {
      return { samples: 0, min: null, max: null, avg: null, last: null };
    }
    let min = state.samples[0]!;
    let max = state.samples[0]!;
    let sum = 0;
    for (const v of state.samples) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return {
      samples: n,
      capacity: state.capacity,
      min,
      max,
      avg: sum / n,
      last: state.samples[n - 1],
      unit: state.unit ?? null,
    };
  },

  /** describe(row, col) — translate pointer coords back to a sample value.
   *  Widget layout: row 0 = title · rows 1..h-1 = canvas body. Col
   *  maps linearly onto sample index via the same formula render() uses. */
  describe(state, ctx, row, col) {
    if (row === 0) return `title row (${ctx.character})`;
    const samples = state.samples;
    if (samples.length < 2) return 'no data yet';
    const w = Math.max(2, ctx.state?.capacity ? ctx.state.capacity : samples.length);
    void w; // value col mapping below uses samples.length directly
    const bodyRow = row - 1;
    const idx = Math.round((col / Math.max(1, samples.length - 1)) * (samples.length - 1));
    const clamped = Math.max(0, Math.min(samples.length - 1, idx));
    const v = samples[clamped]!;
    return `row ${row} (body row ${bodyRow}) col ${col}: sample[${clamped}] = ${v.toFixed(2)}${state.unit ?? ''}`;
  },

  // WR-1 (Bundle 7W · 2026-04-20) — sparkline is a high-frequency push
  // surface. We only emit on samples-reference identity changes (which
  // the `samples: [...]` setState pattern guarantees once per push
  // batch) — NOT per individual array mutation. Timeline recorders get
  // one event per host frame where the caller replaced the ring-buffer
  // reference; raw per-sample telemetry should come from the emitter,
  // not from here. `sparkline.cleared` is kept on the `c` key handler.
  onStateChange(prev, next, ctx) {
    if (prev.samples !== next.samples) {
      const n = next.samples.length;
      const last = n > 0 ? next.samples[n - 1]! : null;
      ctx.telemetry?.emit({
        kind: 'sparkline.samples.change',
        data: { count: n, capacity: next.capacity, last },
      });
    }
  },

  // WR-2 — count + last-sample bucket + focus. Bucketing the last value
  // keeps the hash stable across sub-integer drift (a "0.42 → 0.43" tick
  // doesn't bump the hash for each frame) while still catching trend
  // changes that matter for a replay recorder.
  snapshotHash(state): string {
    const n = state.samples.length;
    const last = n > 0 ? Math.round(state.samples[n - 1]! * 100) / 100 : 0;
    return `${n}:${last}:${state.focused ? 1 : 0}:${state.color ?? 'accent'}`;
  },

  describeSurface(state, ctx): string {
    const n = state.samples.length;
    const parts = [ctx.character, `${n} points`];
    if (n > 0) {
      const sum = state.samples.reduce((acc, v) => acc + v, 0);
      const avg = sum / n;
      parts.push(`avg ${avg.toFixed(2)}${state.unit ?? ''}`);
      parts.push(`last ${state.samples[n - 1]!.toFixed(2)}${state.unit ?? ''}`);
    } else {
      parts.push('no data');
    }
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        samples: {
          type: 'array',
          items: { type: 'number' },
          description: 'Seed sample values for the sparkline ring buffer.',
        },
        capacity: {
          type: 'number',
          description: 'Maximum ring buffer size retained by the widget.',
        },
        min: {
          type: ['number', 'null'],
          description: 'Optional fixed minimum value for y-axis scaling.',
        },
        max: {
          type: ['number', 'null'],
          description: 'Optional fixed maximum value for y-axis scaling.',
        },
        color: {
          type: 'string',
          enum: ['accent', 'success', 'warning', 'error', 'info'],
          description: 'Semantic color token used for the line.',
        },
        unit: {
          type: 'string',
          description: 'Optional unit suffix shown in labels.',
        },
      },
      additionalProperties: false,
    };
  },
};

function computeRange(samples: number[], minOv: number | null | undefined, maxOv: number | null | undefined): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  if (minOv != null && Number.isFinite(minOv)) min = minOv;
  if (maxOv != null && Number.isFinite(maxOv)) max = maxOv;
  if (min >= max) max = min + 1;
  return [min, max];
}

function valueToY(v: number, minV: number, span: number, pixelH: number): number {
  // Higher value → smaller y (inverted — top of canvas = max).
  const t = (v - minV) / span;
  return Math.round((1 - Math.max(0, Math.min(1, t))) * (pixelH - 1));
}

function padRight(s: string, w: number): string {
  const visible = visibleWidth(s);
  return visible >= w ? s : s + ' '.repeat(w - visible);
}

function overlayRight(line: string, label: string, width: number): string {
  const labelW = visibleWidth(label);
  if (labelW >= width) return label;
  const prefixW = width - labelW;
  // Keep the visible prefix of the existing line, truncated to prefixW cells,
  // then append the label. Visual-width-aware truncation.
  let acc = '';
  let w = 0;
  for (const ch of line) {
    const cw = visibleWidth(ch);
    if (w + cw > prefixW) break;
    acc += ch;
    w += cw;
  }
  while (w < prefixW) { acc += ' '; w += 1; }
  return acc + label;
}

function formatLabel(last: number, min: number, max: number, unit?: string, selectedIndex?: number | null): string {
  const u = unit ?? '';
  const fmt = (v: number): string => {
    const abs = Math.abs(v);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return `${v.toFixed(digits)}${u}`;
  };
  const suffix = selectedIndex != null ? C.muted(` [idx ${selectedIndex}] `) : '';
  return C.muted(` [${fmt(min)}..${fmt(max)}] `) + suffix + C.accent(fmt(last));
}

function pickColor(name: NonNullable<SparklineState['color']>): (s: string) => string {
  switch (name) {
    case 'success': return C.success;
    case 'warning': return C.warning;
    case 'error':   return C.error;
    case 'info':    return C.info;
    case 'accent':
    default:        return C.accent;
  }
}

export default sparklineWidget;
