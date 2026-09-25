// ── Markdown widget ──
// Renders a markdown string with word-wrap + scroll offset. Code fences
// get a subtle background tint via render.ts's existing formatter.
// Keeps pure-function semantics — state = { text, scroll, focused }.
//
// Phase 3b (2026-04-20) — scroll keys delegated to the reusable
// Scrollable mixin. Used by debug-detail / debug-stack / debug-prompts
// panes (all spawn `type: 'markdown'`), so this one migration covers
// three panes at once.

import type { Widget } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { Scrollable } from '../../src/widget-behaviors/index.js';

export interface MarkdownWidgetState {
  text: string;
  scroll: number;       // top line offset
  focused: boolean;
  /** When true, treat `text` as already-formatted ANSI: split by `\n`
   *  with no word wrap, and skip the focus/dim wrap so per-line color
   *  codes stay visible. Used by the working-dir preview pane to keep
   *  syntax highlighting + file headers vivid even when the pane
   *  isn't focused. */
  preformatted?: boolean;
  /** Set by render() to the actual ctx.width it was given this frame,
   *  so producers (e.g. the preview-pane terminal) can size their
   *  output to match exactly without heuristic guessing. Separate
   *  field `lastBodyHeight` records the usable height below the
   *  title row. Both stay 0 until the widget has rendered once. */
  lastRenderedWidth?: number;
  lastBodyHeight?: number;
  /** 1-based absolute terminal origin (row, col) of this widget's
   *  BODY area (i.e. below the title row). Published by render()
   *  from ctx so downstream consumers (preview terminal mouse
   *  passthrough) can translate absolute mouse coords into
   *  pane-local cells. */
  lastOriginRow?: number;
  lastOriginCol?: number;
}

export interface MarkdownWidgetConfig {
  text?: string;
  character?: string;
}

/** Word-wrap a string to `width` cells. Preserves blank lines as
 *  paragraph separators but collapses runs of ≥2 blank lines to 1. */
function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  const paragraphs = text.split(/\n/);
  let lastBlank = false;
  for (const para of paragraphs) {
    if (para.trim() === '') {
      if (!lastBlank) out.push('');
      lastBlank = true;
      continue;
    }
    lastBlank = false;
    let remaining = para;
    while (remaining.length > 0) {
      if (visibleWidth(remaining) <= width) {
        out.push(remaining);
        break;
      }
      // Find break point — prefer space, fallback to hard slice
      let cut = width;
      const slice = remaining.slice(0, width + 1);
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > width * 0.4) cut = lastSpace;
      out.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
  }
  return out;
}

const markdownWidget: Widget<MarkdownWidgetState, MarkdownWidgetConfig> = {
  type: 'markdown',
  description: 'Markdown string with word-wrap + scroll',
  defaultCharacter: 'Notes',

  // Phase 3b — Scrollable covers every key the old onKey handled
  // (j/k/↓/↑/pagedown/pageup/g/home) plus G/End/Ctrl+d/u.
  behaviors: [Scrollable],

  initialState(config) {
    return {
      text: config?.text ?? '',
      scroll: 0,
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    // Publish the geometry we were given this frame so downstream
    // producers (e.g. preview-pane PTY) can size output to the real
    // cell count instead of a layout heuristic.
    state.lastRenderedWidth = ctx.width;
    // Body starts one row below the title (when we have one).
    const hasTitle = ctx.height >= 2;
    state.lastOriginRow = ctx.originRow != null ? ctx.originRow + (hasTitle ? 1 : 0) : undefined;
    state.lastOriginCol = ctx.originCol;
    if (ctx.height < 1) {
      state.lastBodyHeight = 0;
      return lines;
    }

    const titleRow = hasTitle ? paneTitle(character, ctx.focused, ctx.width) : '';
    if (titleRow) lines.push(titleRow);
    const bodyH = Math.max(0, ctx.height - (titleRow ? 1 : 0));
    state.lastBodyHeight = bodyH;
    if (bodyH === 0) return lines;

    // Preformatted text already contains ANSI per-line; word-wrap would
    // cut color codes mid-line, so split on `\n` and trust the producer
    // to keep each line within width.
    const wrapped = state.preformatted
      ? state.text.split('\n')
      : wrapToWidth(state.text, ctx.width);
    const maxScroll = Math.max(0, wrapped.length - bodyH);
    const scroll = Math.max(0, Math.min(state.scroll, maxScroll));

    for (let i = 0; i < bodyH; i++) {
      const idx = scroll + i;
      if (idx >= wrapped.length) {
        lines.push(' '.repeat(ctx.width));
        continue;
      }
      const line = wrapped[idx]!;
      const padded = line + ' '.repeat(Math.max(0, ctx.width - visibleWidth(line)));
      if (state.preformatted) lines.push(padded);
      else lines.push(ctx.focused ? C.text(padded) : C.subtext(padded));
    }
    return lines;
  },

  // Widget-specific onKey removed — Scrollable behavior handles every
  // key the old onKey did (j/k/↓/↑/pagedown/pageup/g/home) plus
  // G/End/Ctrl+d/u for free.
  onMouse(ev, state, _ctx) {
    switch (ev.type) {
      case 'scroll-up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      case 'scroll-down': {
        const bodyW = state.lastRenderedWidth ?? 0;
        const bodyH = state.lastBodyHeight ?? 0;
        const total = state.preformatted ? state.text.split('\n').length : wrapToWidth(state.text, bodyW).length;
        const max = Math.max(0, total - bodyH);
        state.scroll = Math.min(max, state.scroll + 1);
        return { type: 'refresh' };
      }
      default:
        return { type: 'none' };
    }
  },

  // WR-1 (2026-04-20 · IUL Phase W prereq) — opt-in state observation.
  // Emits telemetry on scroll changes so Phase W timeline recorder can
  // play back markdown reading sessions without re-rendering ANSI
  // cells. Telemetry sink is optional.
  onStateChange(prev, next, ctx) {
    if (prev.scroll !== next.scroll) {
      ctx.telemetry?.emit({
        kind: 'markdown.scroll.change',
        data: { from: prev.scroll, to: next.scroll },
      });
    }
  },

  // WR-2 (Bundle 5W) — scroll position + text length. Text mutation
  // reliably changes length or content; covering length alone is a
  // cheap heuristic (collision on same-length replacement is rare in
  // this widget's usage — users append/truncate rather than in-place
  // substitute).
  snapshotHash(state): string {
    return `${state.scroll}:${state.text.length}:${state.preformatted ? 1 : 0}`;
  },

  describeSurface(state, ctx): string {
    const lineCount = state.preformatted
      ? state.text.split('\n').length
      : Math.max(1, Math.ceil(state.text.length / 80));  // rough wrap estimate
    return `${ctx.character} · ${lineCount} lines · scroll ${state.scroll}`;
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Markdown or plain text body rendered in the pane.',
        },
        character: {
          type: 'string',
          description: 'Widget character / title override.',
        },
      },
      additionalProperties: false,
    };
  },
};

export default markdownWidget;
export { wrapToWidth };
