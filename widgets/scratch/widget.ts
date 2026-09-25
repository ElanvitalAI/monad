// ── Scratch widget ──
//
// Phase 7 Batch S (2026-04-20) — 3-mode multiplexer pane:
//
//   preview mode   — read-only file / image content viewer
//   memo mode      — in-pane multi-line editor
//   clipboard mode — interactive history viewer
//
// ## Dashboard integration status
//
// S1-S3 land the widget as a **spawn-able plugin** — `wd-scratch` in
// the current dashboard is still the `markdown`-type instance driven
// by the 150+ scratchMode / memoLines / clipHistory sites in
// `src/dashboard.ts`. The new scratch widget is the forward-looking
// replacement: alternative workspace layouts can spawn `type: 'scratch'`
// today (see `syncScratchFromDashboard` helper below), and when a
// future arc is ready to swap `wd-scratch`'s type in dashboard.ts, the
// bridge is a single sync block change.
//
// Honest scope narrow (same pattern as Phase 7 Batches A-F): widget
// owns the render + keymap; dashboard keeps source-of-truth state;
// bridge is a per-draw push into widget.state. S3 ships the bridge
// helper + integration test — the actual dashboard swap is deferred.

import type { Widget } from '../../src/widgets/types.js';
import { C, visibleWidth, truncate } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';

export type ScratchMode = 'preview' | 'memo' | 'clipboard';

/** Discriminated state — each mode carries its own sub-state. The
 *  widget renders whichever branch `mode` selects. */
export interface ScratchState {
  mode: ScratchMode;

  // ── Preview mode ──────────────────────────────────────────────
  previewLines: string[];
  previewPath?: string | null;
  /** Matches Scrollable state contract (scroll / maxScroll / pageSize). */
  scroll: number;
  maxScroll?: number;
  pageSize?: number;
  halfPageSize?: number;

  // ── Memo mode ─────────────────────────────────────────────────
  memoLines: string[];           // one string per line
  memoLineIdx: number;           // current line under cursor
  memoColIdx: number;            // column offset within the line
  /** When true, the widget's render draws the memo editor chrome. */
  memoDirty: boolean;
  /** Arc M — render the "type your note · Ctrl+S save · Esc cancel"
   *  help header above the memo body. Dashboard sets true to match its
   *  pre-Arc-M look; bare widget consumers (layout plugins) default to
   *  false so the chrome stays minimal. */
  memoShowHelp?: boolean;
  /** Arc M — how to paint the cursor cell. 'pipe' draws `│` between
   *  chars (widget default, cursor as a divider), 'inverse' uses the
   *  classic `\x1b[7m<char>\x1b[0m` inverse-video highlight (dashboard
   *  default, cursor on the char itself). */
  memoCursorStyle?: 'pipe' | 'inverse';

  // ── Clipboard mode ────────────────────────────────────────────
  clipHistory: ClipboardEntry[];
  clipCursor: number;

  // ── Chrome ────────────────────────────────────────────────────
  focused: boolean;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  /** Epoch ms — informational. */
  ts?: number;
}

export interface ScratchConfig {
  mode?: ScratchMode;
  previewLines?: string[];
  previewPath?: string | null;
  memoLines?: string[];
  clipHistory?: ClipboardEntry[];
}

const scratchWidget: Widget<ScratchState, ScratchConfig> = {
  type: 'scratch',
  description: '3-mode scratch pane (preview / memo / clipboard)',
  defaultCharacter: 'Scratch',

  // Scratch doesn't use behavior mixins — each mode has its own key
  // semantics that would conflict (memo's 'end' = line end, preview's
  // 'end' = scroll to bottom). All keys flow through onKey which
  // branches on state.mode. The pane handler handles preview-mode
  // scrolling via state.scroll mutation directly.
  behaviors: [],

  initialState(config) {
    return {
      mode: config?.mode ?? 'preview',
      previewLines: config?.previewLines ?? [],
      previewPath: config?.previewPath ?? null,
      scroll: 0,
      memoLines: config?.memoLines ?? [''],
      memoLineIdx: 0,
      memoColIdx: 0,
      memoDirty: false,
      clipHistory: config?.clipHistory ?? [],
      clipCursor: 0,
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    // Title reflects mode as a suffix so the user always knows which
    // half of the state machine is active.
    const titleText = `${character} · ${modeLabel(state.mode)}`;
    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(titleText, ctx.focused || state.focused, w));

    const bodyH = Math.max(0, h - lines.length);
    if (bodyH === 0) return lines;

    switch (state.mode) {
      case 'preview':
        appendPreview(lines, state, bodyH, w);
        break;
      case 'memo':
        appendMemo(lines, state, bodyH, w, ctx.focused || state.focused);
        break;
      case 'clipboard':
        appendClipboard(lines, state, bodyH, w, ctx.focused || state.focused);
        break;
    }

    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  // All keys route through onKey — each mode branch has its own
  // handler. Preview mode intentionally handles only the scroll
  // keys (j/k/g/G/Home/End/PgUp/PgDn); if a consumer wants the
  // Scrollable mixin's full keymap (Ctrl+d/u etc.), they can
  // manually compose the behavior outside the widget — the mode
  // conflict (memo's 'end' vs Scrollable's 'end') is why we don't
  // declare it here.
  onKey(ev, state, ctx) {
    if (state.mode === 'memo') return handleMemoKey(ev, state, ctx);
    if (state.mode === 'clipboard') return handleClipboardKey(ev, state, ctx);
    return handlePreviewKey(ev, state, ctx);
  },

  onMouse(ev, state, ctx) {
    if (state.mode === 'preview') {
      if (ev.type === 'scroll-up') return handlePreviewKey({ name: 'up' }, state, ctx);
      if (ev.type === 'scroll-down') return handlePreviewKey({ name: 'down' }, state, ctx);
      return { type: 'none' };
    }
    if (state.mode === 'clipboard') {
      if (ev.type === 'scroll-up') return handleClipboardKey({ name: 'up' }, state, ctx);
      if (ev.type === 'scroll-down') return handleClipboardKey({ name: 'down' }, state, ctx);
      const bodyRow = ev.row - 1;
      if (bodyRow < 0) return { type: 'none' };
      const entry = state.clipHistory[bodyRow];
      if (!entry) return { type: 'none' };
      state.clipCursor = bodyRow;
      if (ev.type === 'double-click') return { type: 'submit', text: entry.text };
      if (ev.type === 'click') return { type: 'refresh' };
      return { type: 'none' };
    }
    return { type: 'none' };
  },

  snapshot(state, _ctx) {
    return {
      mode: state.mode,
      preview: {
        path: state.previewPath ?? null,
        lines: state.previewLines.length,
        scroll: state.scroll,
      },
      memo: {
        lines: state.memoLines.length,
        cursor: { line: state.memoLineIdx, col: state.memoColIdx },
        dirty: state.memoDirty,
      },
      clipboard: {
        entries: state.clipHistory.length,
        cursor: state.clipCursor,
      },
    };
  },

  describe(state, ctx, row, _col) {
    if (row === 0) return `title row · mode=${state.mode} (${ctx.character})`;
    const bodyRow = row - 1;
    switch (state.mode) {
      case 'preview': {
        const idx = state.scroll + bodyRow;
        const line = state.previewLines[idx];
        return line === undefined
          ? `preview row ${row}: (past end)`
          : `preview row ${row}: line[${idx}] = ${truncate(line, 40)}`;
      }
      case 'memo': {
        const line = state.memoLines[bodyRow];
        return line === undefined
          ? `memo row ${row}: (past end)`
          : `memo row ${row}: line[${bodyRow}] = ${truncate(line, 40)}`;
      }
      case 'clipboard': {
        const entry = state.clipHistory[bodyRow];
        return entry === undefined
          ? `clipboard row ${row}: (empty)`
          : `clipboard row ${row}: ${entry.id} · ${truncate(entry.text, 40)}`;
      }
    }
  },

  // WR-1 (2026-04-20 · IUL Phase W prereq) — opt-in state observation.
  // Scratch has rich state (3 modes + memo cursor + clipboard) — these
  // hooks capture the mode transition + memo dirty-flag transition,
  // which matter most for "replay this scratch session" scenarios.
  // Rest of state (scroll / memoLineIdx / clipCursor) is high-frequency
  // and deferred to widget-specific telemetry events inside onKey.
  onStateChange(prev, next, ctx) {
    if (prev.mode !== next.mode) {
      ctx.telemetry?.emit({
        kind: 'scratch.mode.change',
        data: { from: prev.mode, to: next.mode },
      });
    }
    if (prev.memoDirty !== next.memoDirty) {
      ctx.telemetry?.emit({
        kind: 'scratch.memo.dirty.change',
        data: { dirty: next.memoDirty },
      });
    }
  },

  // WR-2 (Bundle 5W) — mode + memo cursor + dirty flag covers the
  // meaningful axes. Preview scroll + clipboard cursor are high-
  // frequency and bump the hash only when mode makes them visible
  // (mode-scoped parts join). Per DESIGN §1.2 example for scratch.
  snapshotHash(state): string {
    const core = `${state.mode}:${state.memoLineIdx}:${state.memoColIdx}:${state.memoDirty ? 1 : 0}`;
    if (state.mode === 'preview') return `${core}:p${state.scroll}`;
    if (state.mode === 'clipboard') return `${core}:c${state.clipCursor}`;
    return core;
  },

  describeSurface(state, ctx): string {
    const parts = [ctx.character, `mode=${state.mode}`];
    switch (state.mode) {
      case 'memo':
        parts.push(`${state.memoLines.length} lines`);
        parts.push(`cursor ${state.memoLineIdx}:${state.memoColIdx}`);
        if (state.memoDirty) parts.push('dirty');
        break;
      case 'preview':
        if (state.previewPath) parts.push(`"${state.previewPath}"`);
        parts.push(`${state.previewLines.length} lines`);
        if (state.scroll > 0) parts.push(`scroll ${state.scroll}`);
        break;
      case 'clipboard':
        parts.push(`${state.clipHistory.length} entries`);
        if (state.clipHistory.length > 0) {
          parts.push(`cursor ${state.clipCursor}`);
        }
        break;
    }
    return parts.join(' · ');
  },

  // WR-3 (Bundle 6W · Phase W replay prereq) — time-rewind hook.
  // Scratch has rich state (3 modes + memo cursor + clipboard history)
  // but all state lives in the state object itself — no external
  // subscriptions or watchers that need scrubbing. Default setState
  // merge is semantically correct since every top-level key is in the
  // recorded snapshot. Override signals scenario-level awareness +
  // leaves a clear extension point: future arcs that add a file watcher
  // on `state.previewPath` would plug teardown here before the setState
  // call. Telemetry emit so Phase W player can mark "scratch replayed"
  // events in the scrub timeline.
  replayState(state, ctx): void {
    ctx.telemetry?.emit({
      kind: 'scratch.replay',
      data: {
        toMode: state.mode,
        clipHistory: state.clipHistory.length,
        memoDirty: state.memoDirty,
      },
    });
    ctx.setState(state as Partial<typeof state>);
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['preview', 'memo', 'clipboard'],
          description: 'Initial scratch sub-mode.',
        },
        previewLines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Read-only preview body for preview mode.',
        },
        previewPath: {
          type: ['string', 'null'],
          description: 'Optional path label shown for preview mode.',
        },
        memoLines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial memo buffer lines.',
        },
        clipHistory: {
          type: 'array',
          description: 'Clipboard history entries for clipboard mode.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              ts: { type: 'number' },
            },
            required: ['id', 'text'],
          },
        },
      },
      additionalProperties: false,
    };
  },
};

/** Preview mode scroll handler — subset of Scrollable's keymap scoped
 *  to preview mode so mode-shared keys (end / home / etc.) don't
 *  conflict with memo mode. */
function handlePreviewKey(
  ev: { name?: string; ctrl?: boolean; shift?: boolean },
  state: ScratchState,
  _ctx: unknown,
): { type: 'refresh' | 'none' } {
  const name = ev.name ?? '';
  const max = state.maxScroll ?? Infinity;
  const page = state.pageSize ?? 10;
  const half = state.halfPageSize ?? 5;
  const clamp = (n: number): number => {
    const lo = Math.max(0, n);
    return Number.isFinite(max) ? Math.min(max, lo) : lo;
  };
  switch (name) {
    case 'j': case 'down':
      state.scroll = clamp(state.scroll + 1); return { type: 'refresh' };
    case 'k': case 'up':
      state.scroll = clamp(state.scroll - 1); return { type: 'refresh' };
    case 'g': case 'home':
      state.scroll = 0; return { type: 'refresh' };
    case 'G': case 'end':
      if (Number.isFinite(max)) state.scroll = max as number;
      return { type: 'refresh' };
    case 'pagedown':
      state.scroll = clamp(state.scroll + page); return { type: 'refresh' };
    case 'pageup':
      state.scroll = clamp(state.scroll - page); return { type: 'refresh' };
    case 'd':
      if (ev.ctrl) { state.scroll = clamp(state.scroll + half); return { type: 'refresh' }; }
      return { type: 'none' };
    case 'u':
      if (ev.ctrl) { state.scroll = clamp(state.scroll - half); return { type: 'refresh' }; }
      return { type: 'none' };
    default:
      return { type: 'none' };
  }
}

/** Memo mode key handler — in-pane multi-line editor. S2.
 *
 *  Accepted keys:
 *    printable char         → insert at cursor
 *    backspace              → delete char before cursor (or merge with prev line)
 *    enter                  → split line at cursor
 *    left / right           → move cursor within line (wraps to prev/next at edges)
 *    up / down              → move cursor line (clamps col to line length)
 *    home                   → col = 0
 *    end                    → col = line length
 *    j / k                  → treated as down/up (vi-style nav) when not printable conflict
 *
 *  Any mutation sets memoDirty = true and returns 'refresh'. Keys we
 *  don't recognise return 'none' so callers can compose higher-level
 *  behavior (e.g. Ctrl+S outside the widget to trigger a host save).
 */
function handleMemoKey(
  ev: { name?: string; ctrl?: boolean; shift?: boolean },
  state: ScratchState,
  _ctx: unknown,
): { type: 'refresh' | 'none' } {
  const name = ev.name ?? '';
  // Ctrl chords (e.g. Ctrl+S) leave the widget alone.
  if (ev.ctrl) return { type: 'none' };

  const curLine = state.memoLines[state.memoLineIdx] ?? '';
  const cols = curLine.length;

  switch (name) {
    case 'backspace': {
      if (state.memoColIdx > 0) {
        state.memoLines[state.memoLineIdx] =
          curLine.slice(0, state.memoColIdx - 1) + curLine.slice(state.memoColIdx);
        state.memoColIdx -= 1;
      } else if (state.memoLineIdx > 0) {
        const prev = state.memoLines[state.memoLineIdx - 1] ?? '';
        const merged = prev + curLine;
        state.memoLines.splice(state.memoLineIdx - 1, 2, merged);
        state.memoLineIdx -= 1;
        state.memoColIdx = prev.length;
      } else {
        return { type: 'none' };
      }
      state.memoDirty = true;
      return { type: 'refresh' };
    }
    case 'enter': {
      const head = curLine.slice(0, state.memoColIdx);
      const tail = curLine.slice(state.memoColIdx);
      state.memoLines.splice(state.memoLineIdx, 1, head, tail);
      state.memoLineIdx += 1;
      state.memoColIdx = 0;
      state.memoDirty = true;
      return { type: 'refresh' };
    }
    case 'left': {
      if (state.memoColIdx > 0) {
        state.memoColIdx -= 1;
      } else if (state.memoLineIdx > 0) {
        state.memoLineIdx -= 1;
        state.memoColIdx = (state.memoLines[state.memoLineIdx] ?? '').length;
      }
      return { type: 'refresh' };
    }
    case 'right': {
      if (state.memoColIdx < cols) {
        state.memoColIdx += 1;
      } else if (state.memoLineIdx < state.memoLines.length - 1) {
        state.memoLineIdx += 1;
        state.memoColIdx = 0;
      }
      return { type: 'refresh' };
    }
    case 'up':
    case 'k': {
      if (state.memoLineIdx > 0) {
        state.memoLineIdx -= 1;
        const newLen = (state.memoLines[state.memoLineIdx] ?? '').length;
        state.memoColIdx = Math.min(state.memoColIdx, newLen);
      }
      return { type: 'refresh' };
    }
    case 'down':
    case 'j': {
      if (state.memoLineIdx < state.memoLines.length - 1) {
        state.memoLineIdx += 1;
        const newLen = (state.memoLines[state.memoLineIdx] ?? '').length;
        state.memoColIdx = Math.min(state.memoColIdx, newLen);
      }
      return { type: 'refresh' };
    }
    case 'home': {
      state.memoColIdx = 0;
      return { type: 'refresh' };
    }
    case 'end': {
      state.memoColIdx = cols;
      return { type: 'refresh' };
    }
    default: {
      if (isPrintable(name)) {
        state.memoLines[state.memoLineIdx] =
          curLine.slice(0, state.memoColIdx) + name + curLine.slice(state.memoColIdx);
        state.memoColIdx += 1;
        state.memoDirty = true;
        return { type: 'refresh' };
      }
      return { type: 'none' };
    }
  }
}

/** Clipboard mode key handler. S2 lands the navigation keys; S3 will
 *  add the copy-selected-entry emit. */
function handleClipboardKey(
  ev: { name?: string; ctrl?: boolean; shift?: boolean },
  state: ScratchState,
  _ctx: unknown,
): { type: 'refresh' | 'none' } {
  const name = ev.name ?? '';
  if (ev.ctrl) return { type: 'none' };
  const max = state.clipHistory.length - 1;
  if (max < 0) return { type: 'none' };

  switch (name) {
    case 'j': case 'down':
      state.clipCursor = Math.min(state.clipCursor + 1, max);
      return { type: 'refresh' };
    case 'k': case 'up':
      state.clipCursor = Math.max(state.clipCursor - 1, 0);
      return { type: 'refresh' };
    case 'g': case 'home':
      state.clipCursor = 0;
      return { type: 'refresh' };
    case 'G': case 'end':
      state.clipCursor = max;
      return { type: 'refresh' };
    default:
      return { type: 'none' };
  }
}

function modeLabel(mode: ScratchMode): string {
  switch (mode) {
    case 'preview':   return 'preview';
    case 'memo':      return 'memo';
    case 'clipboard': return 'clipboard';
  }
}

function appendPreview(lines: string[], state: ScratchState, bodyH: number, w: number): void {
  const body = state.previewLines;
  if (body.length === 0) {
    lines.push(padRight(C.muted('  (no preview content)'), w));
    return;
  }
  state.maxScroll = Math.max(0, body.length - bodyH);
  state.scroll = Math.max(0, Math.min(state.scroll, state.maxScroll));
  const start = state.scroll;
  for (let i = 0; i < bodyH && start + i < body.length; i++) {
    lines.push(padRight(truncate(body[start + i]!, w), w));
  }
}

function appendMemo(lines: string[], state: ScratchState, bodyH: number, w: number, focused: boolean): void {
  const body = state.memoLines;
  // Arc M — optional chrome matching dashboard's pre-swap memo render.
  // Each line consumed by the chrome reduces the body viewport.
  let headerRows = 0;
  if (state.memoShowHelp && bodyH >= 3) {
    lines.push(padRight(C.muted('  type your note \u00B7 Ctrl+S save \u00B7 Esc cancel'), w));
    lines.push(' '.repeat(w));
    headerRows = 2;
  }
  const effectiveBody = bodyH - headerRows;
  const cursorStyle = state.memoCursorStyle ?? 'pipe';
  // Visible window — scroll toward the current line.
  const winStart = Math.max(0, Math.min(state.memoLineIdx - Math.floor(effectiveBody / 2), Math.max(0, body.length - effectiveBody)));
  for (let i = 0; i < effectiveBody; i++) {
    const lineIdx = winStart + i;
    const line = body[lineIdx] ?? '';
    const isCursor = lineIdx === state.memoLineIdx;
    if (isCursor && focused) {
      const col = Math.min(state.memoColIdx, line.length);
      if (cursorStyle === 'inverse') {
        const before = line.slice(0, col);
        const at = col < line.length ? line[col]! : ' ';
        const after = col < line.length ? line.slice(col + 1) : '';
        lines.push(padRight(`  ${before}\x1b[7m${at}\x1b[0m${after}`, w));
      } else {
        const withCursor = line.slice(0, col) + C.cursor('│') + line.slice(col);
        lines.push(padRight(C.text(truncate(withCursor, w + 12)), w)); // +12 for ansi
      }
    } else if (isCursor) {
      lines.push(padRight(C.bold(truncate(line, w)), w));
    } else {
      lines.push(padRight(truncate(line, w), w));
    }
  }
}

function appendClipboard(lines: string[], state: ScratchState, bodyH: number, w: number, focused: boolean): void {
  const entries = state.clipHistory;
  if (entries.length === 0) {
    lines.push(padRight(C.muted('  (clipboard history empty)'), w));
    return;
  }
  const winStart = Math.max(0, Math.min(state.clipCursor - Math.floor(bodyH / 2), Math.max(0, entries.length - bodyH)));
  for (let i = 0; i < bodyH; i++) {
    const idx = winStart + i;
    const entry = entries[idx];
    if (!entry) {
      lines.push(' '.repeat(w));
      continue;
    }
    const label = `  [${entry.id}] ${truncate(entry.text, Math.max(4, w - 10))}`;
    if (idx === state.clipCursor) {
      lines.push(padRight(focused ? C.cursor(label) : C.bold(label), w));
    } else {
      lines.push(padRight(C.subtext(label), w));
    }
  }
}

function padRight(s: string, w: number): string {
  const vis = visibleWidth(s);
  return vis >= w ? s : s + ' '.repeat(w - vis);
}

function isPrintable(keyName: string | undefined): boolean {
  if (!keyName) return false;
  if (keyName.length !== 1) return false;
  const c = keyName.charCodeAt(0);
  return c >= 32 && c < 127;
}

/** Bridge helper — pushes dashboard-local state into a spawned scratch
 *  widget instance each draw. Invoke from the dashboard's per-frame
 *  sync block (the same location that currently updates `wd-scratch`'s
 *  markdown text) when the workspace layout embeds a `type: 'scratch'`
 *  instance. */
export function syncScratchFromDashboard(
  state: ScratchState,
  src: {
    mode: ScratchMode;
    previewLines?: string[];
    previewPath?: string | null;
    scrollOffset?: number;
    memoLines?: string[];
    memoLineIdx?: number;
    memoColIdx?: number;
    memoDirty?: boolean;
    clipHistory?: ClipboardEntry[];
    clipCursor?: number;
    focused?: boolean;
  },
): void {
  state.mode = src.mode;
  if (src.previewLines !== undefined) state.previewLines = src.previewLines;
  if (src.previewPath !== undefined) state.previewPath = src.previewPath;
  if (src.scrollOffset !== undefined) state.scroll = src.scrollOffset;
  if (src.memoLines !== undefined) state.memoLines = src.memoLines.length > 0 ? src.memoLines : [''];
  if (src.memoLineIdx !== undefined) state.memoLineIdx = Math.max(0, src.memoLineIdx);
  if (src.memoColIdx !== undefined) state.memoColIdx = Math.max(0, src.memoColIdx);
  if (src.memoDirty !== undefined) state.memoDirty = src.memoDirty;
  if (src.clipHistory !== undefined) state.clipHistory = src.clipHistory;
  if (src.clipCursor !== undefined) state.clipCursor = Math.max(0, src.clipCursor);
  if (src.focused !== undefined) state.focused = src.focused;
}

/** Mode transition helper — callable from host code. Widget itself
 *  doesn't define mode-switch keystrokes (Ctrl+N / Ctrl+P etc. are
 *  dashboard-local chord concerns). */
export function setScratchMode(state: ScratchState, mode: ScratchMode): void {
  state.mode = mode;
  // Reset mode-local cursors so switching into a mode doesn't inherit
  // stale indices from the previous mode's context.
  if (mode === 'memo') {
    state.memoLineIdx = Math.max(0, Math.min(state.memoLineIdx, state.memoLines.length - 1));
    state.memoColIdx = Math.max(0, Math.min(state.memoColIdx, (state.memoLines[state.memoLineIdx] ?? '').length));
  }
  if (mode === 'clipboard') {
    state.clipCursor = Math.max(0, Math.min(state.clipCursor, Math.max(0, state.clipHistory.length - 1)));
  }
  if (mode === 'preview') {
    state.scroll = Math.max(0, state.scroll);
  }
}

export default scratchWidget;
