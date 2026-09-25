// ── Chart-line widget ──
// ASCII line chart using a dot-per-sample scatter. Samples are mapped
// to the widget's interior height; each column gets one glyph at the
// row matching its normalized value. min/max rows label the y axis.
// Designed for lightweight dogfood — consensus-trader / stock-trade
// dashboards can swap it for a fancier chart widget once one exists.
//
// WR-4 stateless · no observation hooks needed (S3.B · 2026-04-27).
// State carries `series` (caller-owned numeric array) + transient
// `selectedIndex` (mouse cursor). Series snapshots aren't useful for
// the recorder (they're already in the caller's signal/source of
// truth) and `selectedIndex` is pointer state. Recorder relies on the
// host default state-hash + setState fallback.

import type { WidgetDef } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';

export interface ChartLineState {
  series: number[];
  /** Optional label prefix shown on the y-axis (e.g. "$", "%"). */
  unit?: string;
  /** Color for the line dots — defaults to accent. */
  color?: 'accent' | 'success' | 'warning' | 'error' | 'info';
  /** Selected sample index from mouse interaction. */
  selectedIndex?: number | null;
}

export interface ChartLineConfig {
  series?: number[];
  unit?: string;
  color?: ChartLineState['color'];
}

function pickColor(name: ChartLineState['color']): (s: string) => string {
  switch (name) {
    case 'success': return C.success;
    case 'warning': return C.warning;
    case 'error':   return C.error;
    case 'info':    return C.info;
    case 'accent':
    default:        return C.accent;
  }
}

function fmtValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return (unit ?? '') + v.toFixed(digits);
}

const widget: WidgetDef<ChartLineState, ChartLineConfig> = {
  type: 'chart-line',
  description: 'Sparkline-style scatter chart over a numeric series',
  defaultCharacter: 'Chart',

  initialState(config) {
    return {
      series: config?.series ?? [],
      unit: config?.unit,
      color: config?.color,
      selectedIndex: null,
    };
  },

  render(state, ctx, character) {
    const hasTitle = true;
    if (ctx.height < 2 || ctx.width < 4) return [paneTitle(character, ctx.focused, ctx.width)];
    const bodyH = ctx.height - 1;
    const lines: string[] = [];
    if (hasTitle) lines.push(paneTitle(character, ctx.focused, ctx.width));

    const series = state.series;
    if (series.length === 0) {
      for (let i = 0; i < bodyH; i++) {
        lines.push(i === Math.floor(bodyH / 2)
          ? ' '.repeat(Math.max(0, Math.floor((ctx.width - 16) / 2))) + C.dim('(no data — series empty)') + ' '.repeat(ctx.width)
          : ' '.repeat(ctx.width));
      }
      // Trim each line to width
      return lines.map((l, i) => i === 0 ? l : (l.length > ctx.width ? l.slice(0, ctx.width) : l));
    }

    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;

    // Y-axis label column (6 chars). Mid row shows delta.
    const labelW = 7;
    const chartW = Math.max(4, ctx.width - labelW - 1);
    const sliceStart = Math.max(0, series.length - chartW);
    const samples = series.length > chartW
      ? series.slice(sliceStart)
      : series;
    const selectedVisible = state.selectedIndex != null && state.selectedIndex >= sliceStart
      ? state.selectedIndex - sliceStart
      : null;

    // Build 2D grid of columns × bodyH
    const grid: string[][] = [];
    for (let r = 0; r < bodyH; r++) grid.push(Array(samples.length).fill(' '));
    const color = pickColor(state.color);

    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!;
      const norm = (v - min) / range;
      const row = Math.min(bodyH - 1, Math.max(0, Math.round((1 - norm) * (bodyH - 1))));
      grid[row]![i] = selectedVisible === i ? C.warning('\u25C9') : color('\u25CF'); // ◉ / ●
    }

    // Compose body lines
    for (let r = 0; r < bodyH; r++) {
      let label: string;
      if (r === 0) label = fmtValue(max, state.unit);
      else if (r === bodyH - 1) label = fmtValue(min, state.unit);
      else label = '';
      const labelPart = label.padStart(labelW - 1) + ' ';
      const dots = grid[r]!.join('');
      const raw = C.muted(labelPart) + dots;
      const padded = raw + ' '.repeat(Math.max(0, ctx.width - visibleWidth(raw)));
      lines.push(padded);
    }
    if (lines.length >= (hasTitle ? 2 : 1) && state.selectedIndex != null) {
      const value = series[state.selectedIndex];
      if (value != null) {
        const row = hasTitle ? 1 : 0;
        const badge = C.muted(` [idx ${state.selectedIndex}] `) + C.warning(fmtValue(value, state.unit));
        lines[row] = overlayRight(lines[row]!, badge, ctx.width);
      }
    }
    return lines;
  },

  onMouse(ev, state, ctx) {
    const series = state.series;
    if (series.length === 0) return { type: 'none' };
    const labelW = 7;
    const chartW = Math.max(4, (ctx.width ?? 0) - labelW - 1);
    const sliceStart = Math.max(0, series.length - chartW);
    const visibleCount = Math.min(series.length, chartW);
    if (visibleCount <= 0) return { type: 'none' };

    if (ev.type === 'scroll-up' || ev.type === 'scroll-down') {
      const current = state.selectedIndex ?? (series.length - 1);
      const delta = ev.type === 'scroll-up' ? -1 : 1;
      state.selectedIndex = Math.max(0, Math.min(series.length - 1, current + delta));
      return { type: 'refresh' };
    }
    if (ev.type !== 'click' && ev.type !== 'double-click') return { type: 'none' };

    if (ev.row < 1 || ev.col < labelW) return { type: 'none' };
    const indexInSlice = Math.max(0, Math.min(visibleCount - 1, ev.col - labelW));
    state.selectedIndex = sliceStart + indexInSlice;
    return { type: 'refresh' };
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        series: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ordered numeric samples rendered left to right.',
        },
        unit: {
          type: 'string',
          description: 'Optional label prefix for y-axis values, such as "$" or "%".',
        },
        color: {
          type: 'string',
          enum: ['accent', 'success', 'warning', 'error', 'info'],
          description: 'Semantic color token used for the plotted dots.',
        },
      },
      additionalProperties: false,
    };
  },
};

function overlayRight(line: string, label: string, width: number): string {
  const labelW = visibleWidth(label);
  if (labelW >= width) return label;
  const prefixW = width - labelW;
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

export default widget;
