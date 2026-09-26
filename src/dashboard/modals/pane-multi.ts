// TR-P5 / Task 2 Phase T-2 — multi-column pane modal.
//
// Renders N side-by-side pane snapshots inside a single centered
// modal. Phase T-3 wires `Ctrl+M B` to open a 2-column [browser,
// preview] modal on demand; callers may invoke it directly for any
// column set. Content is captured at open time (same semantics as
// `showTransientTerminalModal` — not a live-widget mount). The
// outer modal is a coordinator-registered ModalSurface so ESC
// dismissal + z-order are handled by the normal stack.
//
// Narrow-fallback: when termCols < MIN_WIDE_WIDTH, the modal degrades
// to a single-column presentation using only the first pane so the
// content stays legible. Callers can still close with dispose() or
// ESC.

import { ansi, C, visibleWidth, stripAnsi } from '../../tui.js';
import type { ModalSurface, ModalBounds, ModalWindowRole } from '../../display/modal-stack.js';
import type { SurfaceFocus } from '../../display/types.js';
import type { SurfaceInteractionClass } from '../../display/surface-interaction-policy.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import {
  isModalChromeMouseEventType,
  isPointerFocusMouseEventType,
  type KeyEvent,
  type Action,
  type RenderCtx,
  type DisplayMouseEvent,
} from '../../display/types.js';
import type { WidgetDef, WidgetInstance } from '../../widgets/types.js';
import {
  computeChromeInnerBounds,
  createChromeLayer,
  paintChromeFrame,
  type ChromeFrameStyleSpec,
  type ChromeLayerHandle,
} from '../../display/chrome-layer.js';
import {
  contentOnlyMouseRow,
  renderWidgetBodyWithoutTitle,
} from '../../display/widget-content-only.js';
import type { LayerId } from '../../primitives/layer-tree/index.js';
import { debug } from '../../debug/log.js';
import type { ThemeTokens } from '../../theme/tokens.js';
import { ansiForPair, DEFAULT_WIDGET_TOKENS } from '../../theme/tokens.js';
import {
  buildCompositeWindowMatrix,
  cycleCompositeWindowMatrixFocus,
  hitCompositeWindowMatrixCell,
  type CompositeWindowLayoutMode,
  type CompositeWindowMatrix,
} from '../../window/composite-window-matrix.js';

/** Minimal widget-host surface the live-modal factory depends on.
 *  Keeps the factory decoupled from WidgetHost's full API so tests
 *  can stub with 10 lines instead of re-implementing the class. */
export interface WidgetHostLike {
  get(id: string): WidgetInstance | null;
  defFor(id: string): WidgetDef | null;
}

/** Per-column payload — one visual pane inside the outer modal. */
export interface PaneMultiModalColumn {
  /** Display title (shown above the column's own inner border). */
  title: string;
  /** ANSI-styled lines — not re-wrapped. Long rows are hard-clipped
   *  to the column width so the outer border stays intact. */
  lines: string[];
  /** Optional column weight. Columns share the inner content width
   *  in proportion to their weights (default 1 each = equal split).
   *  Example: `[{weight: 2}, {weight: 3}]` → 40/60 split. */
  weight?: number;
}

/** Full-terminal backdrop. Paints blank (SGR-reset) cells over every
 *  row so underlying pane chrome / log / input does not show through
 *  the margins around the modal's visual rect. Emitted before the
 *  modal borders + content so the centered frame overlays a clean
 *  background. The coordinator's `surface.bounds` is set to the same
 *  full-screen rect — that way V4 flushOverlay invalidation on
 *  dispose repaints every row the backdrop touched. */
function paintBackdrop(termCols: number, termRows: number): string {
  if (termCols <= 0 || termRows <= 0) return '';
  const blank = ' '.repeat(termCols);
  const parts: string[] = [];
  for (let r = 1; r <= termRows; r++) {
    parts.push(ansi.moveTo(r, 1) + '\x1b[0m' + blank);
  }
  return parts.join('');
}

/** Share `contentWidth` across `columns` in proportion to their
 *  weights. Each column gets at least 1 cell; the last column
 *  absorbs any rounding remainder so `widths.sum === contentWidth`
 *  exactly. Used by both snapshot + live variants so the weight API
 *  is symmetric. */
function computeColumnWidths(
  columns: readonly { weight?: number }[],
  contentWidth: number,
): number[] {
  const n = Math.max(1, columns.length);
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.max(0.001, columns[i]?.weight ?? 1);
    weights.push(w);
    totalWeight += w;
  }
  const widths: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      widths.push(Math.max(1, contentWidth - allocated));
    } else {
      const w = Math.max(1, Math.floor((contentWidth * weights[i]!) / totalWeight));
      widths.push(w);
      allocated += w;
    }
  }
  return widths;
}

/** Result handle for the caller. dispose() is idempotent. */
export interface PaneMultiModalHandle {
  readonly id: string;
  dispose(): void;
  readonly bounds: ModalBounds;
  /** Number of columns actually rendered — useful for tests and the
   *  "was narrow fallback triggered?" check. */
  readonly columnCount: number;
}

export interface PaneMultiModalChromeControl {
  id: string;
  label: string;
}

export interface PaneMultiModalChromeSpec {
  theme?: ThemeTokens;
  variant?: 'plain' | 'rounded' | 'double' | 'heavy';
  titleAlign?: 'left' | 'center';
  titlePrefix?: string;
  titleRight?: string;
  titleControls?: readonly PaneMultiModalChromeControl[];
  bottomStatus?: string;
}

export interface PaneMultiModalChromeAction {
  area: 'title-control';
  controlId: string;
  anchorStartCol: number;
  anchorEndCol: number;
  anchorRow: number;
  bounds: ModalBounds;
}

export interface ShowPaneMultiModalParams {
  id?: string;
  /** Outer modal title (e.g. "Browser + Preview"). */
  title: string;
  columns: PaneMultiModalColumn[];
  /** Current terminal dimensions. */
  termCols: number;
  termRows: number;
  coordinator: DisplayCoordinator;
  /** Width override. Default: 88 % of termCols (clamped). */
  width?: number;
  /** Height override. Default: 80 % of termRows (clamped). */
  height?: number;
  /** Full bounds override — wins over width/height. */
  bounds?: ModalBounds;
  /** Auto-dismiss delay. 0 = persistent (default). Single-pane
   *  transient modals default to 2500ms; multi-pane stays on until
   *  ESC or explicit dispose — the user is inspecting side-by-side
   *  content and a surprise auto-close would be disorienting. */
  ttlMs?: number;
  /** Singleton group key. A second modal with the same key replaces
   *  the first. Default group = `'pane-multi-modal'`. */
  group?: string;
  /** Optional timer injection (for tests). */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (h: ReturnType<typeof setTimeout>) => void;
  /** Called once on dispose (TTL fired / group replacement / explicit
   *  dispose). Task T-4 uses this to restore focus. Exceptions
   *  swallowed — dispose teardown must never throw. */
  onDispose?: () => void;
  onCancel?: () => void;
  chrome?: PaneMultiModalChromeSpec;
  onChromeAction?: (action: PaneMultiModalChromeAction, ev: DisplayMouseEvent) => void;
  windowRole?: ModalWindowRole;
  interactionClass?: SurfaceInteractionClass;
  layoutMode?: Exclude<CompositeWindowLayoutMode, '1x1'> | 'auto';
}

/** Below this outer width, the 2×1 layout is unreadable and the
 *  modal falls back to a single column (the first pane). The 80-col
 *  threshold matches the `tabletTwo` CompactLevel boundary — wider
 *  than that, two 40-col columns comfortably fit. */
export const MIN_WIDE_WIDTH = 80;

/** Minimum width for a single sub-column including its 2-cell
 *  border + 1-cell title pad. Anything narrower is unreadable. */
const MIN_COLUMN_INNER = 20;

const activeByGroup = new Map<string, PaneMultiModalHandle>();
let idCounter = 0;

function resolvePaneMultiWindowRole(role: ModalWindowRole | undefined): ModalWindowRole {
  return role ?? 'foreground';
}

function resolvePaneMultiInteractionClass(
  role: ModalWindowRole,
  explicit: SurfaceInteractionClass | undefined,
): SurfaceInteractionClass | undefined {
  if (explicit) return explicit;
  return role === 'companion' ? 'embedded-overlay' : undefined;
}

function resolvePaneMultiBackgroundInteractionPolicy(
  role: ModalWindowRole,
): 'allow' | 'block' {
  return role === 'companion' ? 'allow' : 'block';
}

function resolvePaneMultiFocus(role: ModalWindowRole): SurfaceFocus {
  return role === 'companion' ? 'none' : 'owns';
}

function resolvePaneMultiOwnsBackdrop(role: ModalWindowRole): boolean {
  return role !== 'companion';
}

export function showPaneMultiModal(params: ShowPaneMultiModalParams): PaneMultiModalHandle {
  const group = params.group ?? 'pane-multi-modal';
  const prior = activeByGroup.get(group);
  if (prior) prior.dispose();

  const bounds = computeBounds(params);
  // Narrow-fallback decision is based on the OUTER width after
  // clamping. If there's only one column to begin with, the
  // single-column path fires regardless of width.
  const wantMulti = params.columns.length >= 2 && bounds.width >= MIN_WIDE_WIDTH;
  const columns = wantMulti ? params.columns : params.columns.slice(0, 1);

  const id = params.id ?? `pane-multi-modal:${++idCounter}`;
  const ttlMs = params.ttlMs ?? 0;
  const windowRole = resolvePaneMultiWindowRole(params.windowRole);
  const interactionClass = resolvePaneMultiInteractionClass(windowRole, params.interactionClass);
  const ownsBackdrop = resolvePaneMultiOwnsBackdrop(windowRole);
  if (debug.enabled) {
    debug.log('modal.pane-multi.show', id, {
      id,
      group,
      title: params.title,
      columnCount: columns.length,
      requested: params.columns.length,
      bounds: { ...bounds },
      ttlMs,
      windowRole,
      narrowFallback: !wantMulti && params.columns.length >= 2,
      replacedPrior: !!prior,
    });
  }

  const schedule = params.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = params.clearSchedule ?? ((h) => clearTimeout(h));

  // Full-screen surface bounds → coordinator sees the modal as owning
  // every row, so backdrop cells in the margins get invalidated on
  // dispose (V4 flushOverlay). Visual bounds stay centered via the
  // `bounds` closure used inside `paint`.
  const surfaceBounds: ModalBounds = ownsBackdrop
    ? {
        row: 1, col: 1,
        width: Math.max(1, params.termCols),
        height: Math.max(1, params.termRows),
      }
    : { ...bounds };
  let surface: ModalSurface;
  const currentBounds = (): ModalBounds => {
    const visual = surface.visualBounds ?? surface.interactiveBounds ?? surface.bounds;
    return { ...visual };
  };
  surface = {
    id,
    owner: 'dashboard',
    kind: 'modal',
    // T-4 — focusable so the modal lands on the focus stack; ESC is
    // routed through the dashboard key loop (same precedent as the
    // transient terminal modal).
    focus: resolvePaneMultiFocus(windowRole),
    priority: 210,
    tier: 'popup',
    bounds: surfaceBounds,
    interactiveBounds: { ...bounds },
    visualBounds: { ...bounds },
    backdropBounds: ownsBackdrop ? { ...surfaceBounds } : { ...bounds },
    backgroundInteractionPolicy: resolvePaneMultiBackgroundInteractionPolicy(windowRole),
    windowRole,
    interactionClass,
    render: () => [],
    paint: () => (ownsBackdrop ? paintBackdrop(params.termCols, params.termRows) : '')
      + paintMultiColumn({
        bounds: currentBounds(),
        title: params.title,
        columns,
        chrome: params.chrome,
        layoutMode: params.layoutMode,
        resizeHandleHint: surface.resizeHandleHint,
      }),
    cursor: () => null,
    resizeHandleHint: null,
    onKey: (ev: KeyEvent) => {
      if ((ev.name === 'escape' || ev.name === 'esc') && params.onCancel) {
        try { params.onCancel(); } catch { /* isolate */ }
        return 'consumed' as const;
      }
      return 'passthrough' as const;
    },
    onMouse: (ev: DisplayMouseEvent) => {
      if (!isModalChromeMouseEventType(ev.type)) {
        return { type: 'none' } as const;
      }
      const bounds = currentBounds();
      const chromeAction = resolvePaneMultiChromeAction(bounds, params.chrome, ev.row, ev.col);
      if (!chromeAction && isPaneMultiTitleRailHit(bounds, params.chrome, ev.row, ev.col)) {
        ev.hitTarget = { kind: 'modal-title', modalId: id };
        return { type: 'refresh' } as const;
      }
      if (!chromeAction) return { type: 'none' } as const;
      try { params.onChromeAction?.(chromeAction, ev); } catch { /* isolate */ }
      return { type: 'refresh' } as const;
    },
  };

  const { dispose: popFn } = params.coordinator.pushModal(surface);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearSchedule(timer);
    timer = null;
    if (activeByGroup.get(group) === handle) activeByGroup.delete(group);
    try { popFn(); } catch { /* coordinator already disposed */ }
    if (debug.enabled) debug.log('modal.pane-multi.dispose', id, { id, group });
    if (params.onDispose) {
      try { params.onDispose(); } catch { /* never let dispose callbacks break teardown */ }
    }
  };

  if (ttlMs > 0) timer = schedule(dispose, ttlMs);

  const handle: PaneMultiModalHandle = { id, dispose, bounds, columnCount: columns.length };
  activeByGroup.set(group, handle);
  return handle;
}

/** Test helper — wipe the singleton registry so state doesn't leak. */
export function _resetPaneMultiModalsForTesting(): void {
  for (const h of [...activeByGroup.values()]) h.dispose();
  activeByGroup.clear();
}

/** Current handle in a group, if any. */
export function currentPaneMultiModal(group = 'pane-multi-modal'): PaneMultiModalHandle | null {
  return activeByGroup.get(group) ?? null;
}

// ─── Internals ──────────────────────────────────────────────────

interface PaintInput {
  bounds: ModalBounds;
  title: string;
  columns: PaneMultiModalColumn[];
  chrome?: PaneMultiModalChromeSpec;
  layoutMode?: Exclude<CompositeWindowLayoutMode, '1x1'> | 'auto';
  resizeHandleHint?: 'nw' | 'ne' | 'sw' | 'se' | null;
}

function paintResizeHandleHint(
  bounds: ModalBounds,
  hint: 'nw' | 'ne' | 'sw' | 'se' | null | undefined,
): string {
  if (!hint) return '';
  const row = hint === 'nw' || hint === 'ne' ? bounds.row : bounds.row + bounds.height - 1;
  const col = hint === 'nw' || hint === 'sw' ? bounds.col : bounds.col + bounds.width - 1;
  const glyph =
    hint === 'nw' ? '◤'
    : hint === 'ne' ? '◥'
    : hint === 'sw' ? '◣'
    : '◢';
  return ansi.moveTo(row, col) + C.accent(glyph);
}

function paintMultiColumn(input: PaintInput): string {
  const { row, col, width, height } = input.bounds;
  if (width < 6 || height < 5) return '';
  const out: string[] = [];
  const inner = computeChromeInnerBounds(input.bounds);
  out.push(paintChromeFrame({
    bounds: input.bounds,
    title: input.title,
    frameSpec: resolvePaneMultiModalChromeFrame(input.chrome),
  }));
  const resizeHandle = paintResizeHandleHint(input.bounds, input.resizeHandleHint);
  if (resizeHandle) out.push(resizeHandle);

  const columnCount = Math.max(1, input.columns.length);
  const matrix = buildCompositeWindowMatrix({
    bounds: inner,
    layoutMode: input.layoutMode,
    cellCount: columnCount,
    columnWeights: input.columns.map((column) => column.weight ?? 1),
    minCellWidth: MIN_COLUMN_INNER,
    minCellHeight: 3,
  });

  for (const cell of matrix.cells) {
    const column = input.columns[cell.index];
    if (!column) continue;
    const title = clipPlain(column.title, Math.max(1, cell.bounds.width - 2));
    const styledTitle = ` ${C.accent(title)} `;
    const titleVW = visibleWidth(stripAnsi(styledTitle));
    const titlePad = Math.max(0, cell.bounds.width - titleVW);
    out.push(ansi.moveTo(cell.bounds.row, cell.bounds.col) + styledTitle + ' '.repeat(titlePad));
    for (let r = 1; r < cell.bounds.height; r++) {
      const raw = column.lines[r - 1] ?? '';
      const vw = visibleWidth(stripAnsi(raw));
      const line = vw > cell.bounds.width
        ? truncateAnsi(raw, cell.bounds.width)
        : raw + ' '.repeat(Math.max(0, cell.bounds.width - vw));
      out.push(ansi.moveTo(cell.bounds.row + r, cell.bounds.col) + line);
    }
  }

  for (const dividerCol of matrix.verticalDividers) {
    let line = '';
    for (let r = inner.row; r < inner.row + inner.height; r++) {
      line += ansi.moveTo(r, dividerCol) + C.muted('│');
    }
    out.push(line);
  }
  for (const dividerRow of matrix.horizontalDividers) {
    const chars = Array.from({ length: inner.width }, () => '─');
    for (const dividerCol of matrix.verticalDividers) {
      const offset = dividerCol - inner.col;
      if (offset >= 0 && offset < chars.length) chars[offset] = '┼';
    }
    out.push(ansi.moveTo(dividerRow, inner.col) + C.muted(chars.join('')));
  }

  return out.join('');
}

function clipPlain(value: string, maxVW: number): string {
  if (visibleWidth(value) <= maxVW) return value;
  return `${value.slice(0, Math.max(0, maxVW - 1))}…`;
}

function truncateAnsi(s: string, maxVW: number): string {
  if (!s.includes('\x1b')) {
    const trimmed = s.slice(0, Math.max(0, maxVW - 1)) + '…';
    const vw = visibleWidth(trimmed);
    return trimmed + ' '.repeat(Math.max(0, maxVW - vw));
  }
  let out = '';
  let vw = 0;
  const escRe = /\x1b\[[0-9;]*m/y;
  let i = 0;
  while (i < s.length && vw < maxVW - 1) {
    escRe.lastIndex = i;
    const m = escRe.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = s[i]!;
    out += ch;
    vw += visibleWidth(ch);
    i++;
  }
  out += '…\x1b[0m';
  const tailPad = Math.max(0, maxVW - vw - 1);
  return out + ' '.repeat(tailPad);
}

function computeBounds(params: ShowPaneMultiModalParams): ModalBounds {
  if (params.bounds) return clampBounds(params.bounds, params.termCols, params.termRows);
  const minWidth = Math.min(MIN_COLUMN_INNER + 6, Math.max(4, params.termCols - 2));
  const minHeight = Math.min(8, Math.max(5, params.termRows - 2));
  const width = params.width
    ?? Math.max(minWidth, Math.min(params.termCols - 2, Math.floor(params.termCols * 0.88)));
  const rawHeight = params.height
    ?? Math.max(minHeight, Math.min(params.termRows - 2, Math.floor(params.termRows * 0.8)));
  // Content height ≈ the tallest column's line count + chrome (3:
  // outer top + sub-title + divider + outer bottom → 4 actually; use
  // 4 here, computeBounds has always slightly over-reserved rather
  // than truncate).
  const tallest = params.columns.reduce((max, c) => Math.max(max, c.lines.length), 0);
  const contentHeight = tallest + 4;
  const height = params.height ? rawHeight : Math.min(rawHeight, Math.max(minHeight, contentHeight));
  const row = Math.max(1, Math.floor((params.termRows - height) / 2) + 1);
  const col = Math.max(1, Math.floor((params.termCols - width) / 2) + 1);
  return clampBounds({ row, col, width, height }, params.termCols, params.termRows);
}

function resolvePaneMultiModalChromeFrame(
  chrome: PaneMultiModalChromeSpec | undefined,
): ChromeFrameStyleSpec | undefined {
  if (!chrome) return undefined;
  const modalChrome = chrome.theme?.widgetTokens?.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome;
  if (!modalChrome) return undefined;
  return {
    borderVariant: chrome.variant ?? modalChrome.chromeVariant ?? 'plain',
    borderStyle: ansiForPair(modalChrome.borderActive),
    titleBarStyle: ansiForPair(modalChrome.titleBar),
    titleTextStyle: ansiForPair(modalChrome.titleText),
    titleAlign: chrome.titleAlign ?? 'left',
    titlePrefix: chrome.titlePrefix,
    titleRight: resolvePaneMultiTitleRight(chrome),
    titleRightStyle: ansiForPair(modalChrome.closeButton ?? modalChrome.titleText),
    bottomText: chrome.bottomStatus,
    bottomStyle: ansiForPair(modalChrome.titleBarInactive ?? modalChrome.titleBar),
  };
}

function resolvePaneMultiTitleRight(chrome: PaneMultiModalChromeSpec | undefined): string | undefined {
  if (!chrome) return undefined;
  if (chrome.titleControls && chrome.titleControls.length > 0) {
    return chrome.titleControls.map((control) => control.label).join(' ');
  }
  return chrome.titleRight;
}

function resolvePaneMultiChromeAction(
  bounds: ModalBounds,
  chrome: PaneMultiModalChromeSpec | undefined,
  row: number,
  col: number,
): PaneMultiModalChromeAction | null {
  const controls = chrome?.titleControls;
  if (!controls || controls.length === 0) return null;
  if (row !== bounds.row) return null;
  const rightText = controls.map((control) => control.label).join(' ');
  const decorated = ` ${rightText} `;
  const rightVW = visibleWidth(stripAnsi(decorated));
  const innerWidth = Math.max(0, bounds.width - 2);
  const rightX = bounds.col + 1 + Math.max(0, innerWidth - rightVW);
  let cursorCol = rightX + 1; // skip leading padding inside decorated text
  for (let i = 0; i < controls.length; i++) {
    const control = controls[i]!;
    const width = Math.max(1, visibleWidth(stripAnsi(control.label)));
    const start = cursorCol;
    const end = cursorCol + width - 1;
    if (col >= start && col <= end) {
      return {
        area: 'title-control',
        controlId: control.id,
        anchorStartCol: start,
        anchorEndCol: end,
        anchorRow: bounds.row,
        bounds,
      };
    }
    cursorCol = end + 2; // one trailing space between controls
  }
  return null;
}

function isPaneMultiTitleRailHit(
  bounds: ModalBounds,
  chrome: PaneMultiModalChromeSpec | undefined,
  row: number,
  col: number,
): boolean {
  if (row !== bounds.row || bounds.width < 4) return false;
  if (col <= bounds.col || col >= bounds.col + bounds.width - 1) return false;
  return resolvePaneMultiChromeAction(bounds, chrome, row, col) === null;
}

function clampBounds(b: ModalBounds, termCols: number, termRows: number): ModalBounds {
  const col = Math.max(1, Math.min(b.col, Math.max(1, termCols)));
  const row = Math.max(1, Math.min(b.row, Math.max(1, termRows)));
  const width = Math.max(6, Math.min(b.width, Math.max(6, termCols - col + 1)));
  const height = Math.max(5, Math.min(b.height, Math.max(5, termRows - row + 1)));
  return { row, col, width, height };
}

// ═══ Live widget variant — Track A autopilot ════════════════════════
//
// `showLivePaneMultiModal` delegates content rendering to live widget
// instances (via `widgetHost.defFor(id).render(...)`) instead of
// pre-captured snapshots. Each column is re-rendered on every paint,
// so widget state changes (browser cursor moves, preview scroll) are
// visible inside the modal without re-opening it.
//
// Column focus: the modal tracks which column receives key/mouse
// events. `Tab` / `Shift+Tab` cycles. Mouse clicks switch focus to
// the column under the pointer. The focused column's widget receives
// `onKey` / `onMouse` with coordinates translated into widget-local
// space.

export interface LivePaneMultiModalColumn {
  /** Title shown above the column. */
  title: string;
  /** Widget instance id looked up via `WidgetHostLike.get(id)`. */
  widgetInstanceId: string;
  /** Optional column weight (default 1 — equal split). Columns share
   *  the inner content width proportionally. Example: `browser=2 +
   *  preview=3` gives the preview column 60 % of the content row. */
  weight?: number;
  /** Optional post-key hook fired after the focused widget's
   *  `onKey` returns. Use for cross-widget coupling the widget alone
   *  doesn't know about — e.g. Browser cursor move → refresh Preview.
   *  Receives the widget's returned `Action` and the original
   *  `KeyEvent`. Exceptions are swallowed so a broken hook cannot
   *  destabilise modal paint. */
  onAfterKey?: (action: Action, ev: KeyEvent) => void;
  /** α.2 (compositor primitive track · 2026-04-21) — post-mouse
   *  mirror of `onAfterKey`. Fires after the hit column's
   *  `widget.onMouse` returns, with the same swallow-error policy.
   *  Use for cross-widget coupling that must fire on both key and
   *  mouse paths (e.g. Browser cursor → Preview refresh was previously
   *  wired only through `onAfterKey`, so a mouse click / scroll-wheel
   *  cursor move left the Preview stale). Codex comment
   *  [#4286180153](https://github.com/ElanvitalAI/elanous/pull/369#issuecomment-4286180153)
   *  acceptance point 2. Deprecated target: W2 RenderCoordinator
   *  commit boundary in H1, which will subsume both hooks into a
   *  single cross-surface notification. */
  onAfterMouse?: (action: Action, ev: DisplayMouseEvent) => void;
  /** Optional right-click hook for consumers that need context menu
   *  behavior without teaching the underlying widget about
   *  right-click semantics. */
  onRightClick?: (ev: DisplayMouseEvent, meta: {
    localRow: number;
    localCol: number;
    cellIndex: number;
  }) => Action | void;
  /** Optional pre-widget key interceptor. Fires for the focused
   *  column AFTER the modal's own Tab/Esc handling but BEFORE the
   *  widget's `onKey`. Lets the column's owner consume keys with
   *  semantics outside the widget's vocabulary (e.g. Left/Right →
   *  parent / child directory navigation against the column's own
   *  `WorkingDirState`).
   *
   *  Return values:
   *    - `'consumed'`  → modal returns 'consumed', skipping widget.
   *                      Use when the interceptor handled the key.
   *    - `'passthrough'` → modal returns 'passthrough', skipping
   *                      widget. Use when the interceptor decided
   *                      not to handle the key but doesn't want it
   *                      to reach the widget either.
   *    - `undefined`   → modal forwards to the widget as usual.
   *
   *  Exceptions are swallowed (logged when debug is enabled) so a
   *  broken interceptor cannot destabilise modal paint. */
  onIntercept?: (ev: KeyEvent) => 'consumed' | 'passthrough' | undefined;
}

export interface ShowLivePaneMultiModalParams {
  id?: string;
  title: string;
  columns: LivePaneMultiModalColumn[];
  widgetHost: WidgetHostLike;
  coordinator: DisplayCoordinator;
  termCols: number;
  termRows: number;
  /** Initial focused column (default 0). */
  initialFocus?: number;
  width?: number;
  height?: number;
  bounds?: ModalBounds;
  ttlMs?: number;
  group?: string;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (h: ReturnType<typeof setTimeout>) => void;
  onDispose?: () => void;
  onCancel?: () => void;
  chrome?: PaneMultiModalChromeSpec;
  onChromeAction?: (action: PaneMultiModalChromeAction, ev: DisplayMouseEvent) => void;
  windowRole?: ModalWindowRole;
  interactionClass?: SurfaceInteractionClass;
  layoutMode?: Exclude<CompositeWindowLayoutMode, '1x1'> | 'auto';
  /** α.2 (2026-04-21 · compositor primitive track) — opt-in opaque
   *  hint. Forwarded verbatim to the spawned `ModalSurface.occluding`
   *  field. Set to `true` only when the caller can guarantee (a) the
   *  modal's paint covers its full surface bounds opaquely AND (b) the
   *  bounds contain every modal below it in the focus stack · otherwise
   *  the skip-paint optimization in `renderModalStack` leaks the lower
   *  modal's pixels at uncovered regions.
   *
   *  Undefined (default) → pre-α.2 behavior (every modal paints ·
   *  safe). The Browser+Preview live modal does NOT currently set this
   *  because its visual paint bounds are ~85 % of termCols×termRows —
   *  a sibling modal beyond the 15 % margin would leak if declared
   *  occluding. Future fullscreen consumers (e.g. `/iul-timeline view`
   *  in tablet mode) are candidates. */
  occluding?: boolean;
}

export interface LivePaneMultiModalHandle {
  readonly id: string;
  readonly bounds: ModalBounds;
  readonly columnCount: number;
  /** Currently-focused column index — updated when user presses Tab
   *  or clicks a different column. Exposed so tests can assert
   *  without piercing internals. */
  readonly focusedColumn: () => number;
  dispose(): void;
}

export function showLivePaneMultiModal(
  params: ShowLivePaneMultiModalParams,
): LivePaneMultiModalHandle {
  const group = params.group ?? 'live-pane-multi-modal';
  const prior = activeByGroup.get(group);
  if (prior) prior.dispose();

  const initialBounds = computeBoundsForLive(params);
  const wantMulti = params.columns.length >= 2 && initialBounds.width >= MIN_WIDE_WIDTH;
  const columns = wantMulti ? params.columns : params.columns.slice(0, 1);
  const id = params.id ?? `live-pane-multi-modal:${++idCounter}`;
  const ttlMs = params.ttlMs ?? 0;
  const windowRole = resolvePaneMultiWindowRole(params.windowRole);
  const interactionClass = resolvePaneMultiInteractionClass(windowRole, params.interactionClass);
  const ownsBackdrop = resolvePaneMultiOwnsBackdrop(windowRole);

  let focusIdx = Math.max(0, Math.min(params.initialFocus ?? 0, columns.length - 1));

  if (debug.enabled) {
    debug.log('modal.live-pane-multi.show', id, {
      id,
      group,
      title: params.title,
      columnCount: columns.length,
      requested: params.columns.length,
      bounds: { ...initialBounds },
      ttlMs,
      windowRole,
      narrowFallback: !wantMulti && params.columns.length >= 2,
      replacedPrior: !!prior,
      focusIdx,
      widgetIds: columns.map(c => c.widgetInstanceId),
    });
  }

  const schedule = params.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = params.clearSchedule ?? ((h) => clearTimeout(h));

  // Cached geometry for hit-testing. Updated on every paint so a
  // mouse event lands on whatever the user last saw.
  //
  // Layout (simplified — v2, post-external-research · 2026-04-21):
  //   row  0                   ┌── Browser + Preview ──┐   (outer top)
  //   rows 1…height-2          │<widget>│<widget>│         (content)
  //   row  height-1            └───────────────────────┘   (outer bottom)
  //
  // Removed from v1: inner sub-title row + horizontal divider + T-
  // junction column borders. The modal strips each widget's title row
  // itself and shows body-only content → visual result is ONE set of
  // chrome (outer modal border), not three (outer + sub-title row +
  // widget's own title). This resolves the "라인 뒤틀림" nested-chrome
  // bug the user reported and saves ~2 rows of body space.
  //
  // H2.3 / W5 (2026-04-21 · ⭐ M3 anchor) — backdrop + outer border +
  // title + side edges are now owned by the `createChromeLayer`
  // primitive, registered in W1 LayerTree (zTier 'modal' · repaint
  // boundary true) and wired to W2 RenderCoordinator for dirty marks.
  // The inline paint code below (content + column dividers + bottom-
  // row T-junctions) used to own backdrop + top + sides + bottom +
  // title; it now delegates the full outer frame to `chromeLayer`
  // while still owning column dividers (per-column '│' in between)
  // and the glyph-heavy bottom connector row ('┴'). Visual output is
  // byte-logically identical — `chromeLayer.paint()` is prepended
  // to the `out` array before the content loop.
  let lastMatrix: CompositeWindowMatrix = buildCompositeWindowMatrix({
    bounds: {
      row: initialBounds.row + 1,
      col: initialBounds.col + 1,
      width: initialBounds.width - 2,
      height: initialBounds.height - 2,
    },
    layoutMode: params.layoutMode,
    cellCount: columns.length,
    columnWeights: columns.map((column) => column.weight ?? 1),
    minCellWidth: MIN_COLUMN_INNER_LIVE,
    minCellHeight: 6,
  });

  // H2.3 — chrome-layer owns the outer frame + backdrop. Mount once;
  // geometry mutations (bounds / title / focused) flow through
  // `chromeLayer.update(...)` so W1 LayerTree + W2 RenderCoordinator
  // observe them via the primitive event surface.
  const chromeLayerId = `${id}:chrome` as LayerId;
  const chromeLayer: ChromeLayerHandle = createChromeLayer({
    tree: params.coordinator.layerTreeAPI(),
    rc: params.coordinator.renderCoordinatorAPI(),
    id: chromeLayerId,
    bounds: initialBounds,
    title: params.title,
    focused: true,
    termCols: params.termCols,
    termRows: params.termRows,
    withBackdrop: ownsBackdrop,
    frameSpec: resolvePaneMultiModalChromeFrame(params.chrome),
    occluding: params.occluding,
  });

  let surface: ModalSurface & { onKey?: DisplaySurface['onKey']; onMouse?: DisplaySurface['onMouse'] };
  const currentBounds = (): ModalBounds => {
    const visual = surface.visualBounds ?? surface.interactiveBounds ?? surface.bounds;
    return { ...visual };
  };

  const paint = (): string => {
    const bounds = currentBounds();
    const innerWidth = bounds.width - 2;
    const innerHeight = bounds.height - 2;
    if (bounds.width < 6 || bounds.height < 5) return '';

    const { row, col, width, height } = bounds;

    const columnCount = Math.max(1, columns.length);
    const contentRows = Math.max(0, innerHeight);
    lastMatrix = buildCompositeWindowMatrix({
      bounds: { row: row + 1, col: col + 1, width: innerWidth, height: innerHeight },
      layoutMode: params.layoutMode,
      cellCount: columnCount,
      columnWeights: columns.map((column) => column.weight ?? 1),
      minCellWidth: MIN_COLUMN_INNER_LIVE,
      minCellHeight: 6,
    });

    // Render each column's widget fresh for this frame. Any column
    // whose widget can't be found falls back to a "(widget unavailable)"
    // placeholder so paint never crashes mid-frame.
    const perColLines: string[][] = [];
    for (let i = 0; i < lastMatrix.cells.length; i++) {
      const cell = lastMatrix.cells[i]!;
      const cw = cell.bounds.width;
      const ch = cell.bounds.height;
      const colDef = columns[i];
      if (!colDef) { perColLines.push([]); continue; }
      const inst = params.widgetHost.get(colDef.widgetInstanceId);
      const def = params.widgetHost.defFor(colDef.widgetInstanceId);
      if (!inst || !def) {
        perColLines.push([`  ⚠ widget '${colDef.widgetInstanceId}' not mounted`]);
        continue;
      }
      const ctx: RenderCtx = {
        width: cw,
        height: ch,
        focused: i === focusIdx,
      };
      let lines: string[];
      try {
        lines = renderWidgetBodyWithoutTitle(def, inst, ctx);
      } catch (err) {
        lines = [`  ⚠ render error: ${err instanceof Error ? err.message : String(err)}`];
      }
      perColLines.push(lines);
    }

    const out: string[] = [];
    // H2.3 — chrome-layer emits backdrop + outer frame (top / bottom /
    // left / right) as a single pure string. The content loop then
    // writes column content between the sides; column dividers ('│'
    // between columns) are still drawn inline because the divider is
    // a column-layout concern, not outer chrome.
    chromeLayer.update({
      bounds,
      title: params.title,
      termCols: params.termCols,
      termRows: params.termRows,
    });
    out.push(chromeLayer.paint());
    const resizeHandle = paintResizeHandleHint(bounds, surface.resizeHandleHint);
    if (resizeHandle) out.push(resizeHandle);

    for (const matrixCell of lastMatrix.cells) {
      const cellLines = perColLines[matrixCell.index] ?? [];
      for (let r = 0; r < matrixCell.bounds.height; r++) {
        const raw = cellLines[r] ?? '';
        const vw = visibleWidth(stripAnsi(raw));
        const padded = vw > matrixCell.bounds.width
          ? truncateAnsi(raw, matrixCell.bounds.width)
          : raw + ' '.repeat(Math.max(0, matrixCell.bounds.width - vw));
        out.push(ansi.moveTo(matrixCell.bounds.row + r, matrixCell.bounds.col) + padded);
      }
    }

    if (lastMatrix.verticalDividers.length > 0) {
      for (const dividerCol of lastMatrix.verticalDividers) {
        const parts: string[] = [];
        for (let r = row + 1; r < row + height - 1; r++) {
          parts.push(ansi.moveTo(r, dividerCol) + C.muted('│'));
        }
        if (parts.length > 0) out.push(parts.join(''));
      }
    }
    if (lastMatrix.horizontalDividers.length > 0) {
      for (const dividerRow of lastMatrix.horizontalDividers) {
        let line = ansi.moveTo(dividerRow, col + 1);
        const chars = Array.from({ length: innerWidth }, () => '─');
        for (const dividerCol of lastMatrix.verticalDividers) {
          const offset = dividerCol - (col + 1);
          if (offset >= 0 && offset < chars.length) chars[offset] = '┼';
        }
        line += C.muted(chars.join(''));
        out.push(line);
      }
    }

    return out.join('');
  };

  const cycleFocus = (dir: 1 | -1): void => {
    if (columns.length <= 1) return;
    const next = cycleCompositeWindowMatrixFocus(lastMatrix, focusIdx, dir);
    if (debug.enabled) debug.log('modal.live-pane-multi.focus', 'cycle', { from: focusIdx, to: next, dir });
    focusIdx = next;
  };

  const isTab = (ev: KeyEvent): boolean => {
    const n = (ev.name ?? '').toLowerCase();
    return n === 'tab';
  };
  const isShiftTab = (ev: KeyEvent): boolean => {
    if (!isTab(ev)) return false;
    return !!ev.shift;
  };

  const hitColumnForMouse = (ev: DisplayMouseEvent): number => {
    return hitCompositeWindowMatrixCell(lastMatrix, ev.row, ev.col);
  };

  // Full-screen surface bounds so the coordinator's V4 vanished-region
  // detection invalidates every row the backdrop painted when the
  // modal disposes. Visual rect stays centered via the `bounds`
  // closure used inside `paint`.
  const surfaceBounds: ModalBounds = ownsBackdrop
    ? {
        row: 1, col: 1,
        width: Math.max(1, params.termCols),
        height: Math.max(1, params.termRows),
      }
    : { ...initialBounds };
  surface = {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: resolvePaneMultiFocus(windowRole),
    priority: 212,
    tier: 'popup',
    bounds: surfaceBounds,
    interactiveBounds: { ...initialBounds },
    visualBounds: { ...initialBounds },
    backdropBounds: ownsBackdrop ? { ...surfaceBounds } : { ...initialBounds },
    backgroundInteractionPolicy: resolvePaneMultiBackgroundInteractionPolicy(windowRole),
    windowRole,
    interactionClass,
    render: () => [],
    paint,
    cursor: () => null,
    resizeHandleHint: null,
    // α.2 · opt-in opaque hint · verbatim pass-through from caller.
    // Undefined by default → pre-α.2 behavior (safe).
    occluding: params.occluding,
    onKey: (ev: KeyEvent) => {
      if ((ev.name === 'escape' || ev.name === 'esc') && params.onCancel) {
        try { params.onCancel(); } catch { /* isolate */ }
        return 'consumed' as const;
      }
      // Shift+Tab / Tab cycle focused column. Only when ≥ 2 columns.
      if (columns.length >= 2 && isTab(ev)) {
        cycleFocus(isShiftTab(ev) ? -1 : 1);
        return 'consumed' as const;
      }
      const colDef = columns[focusIdx];
      if (!colDef) return 'passthrough' as const;
      // Pre-widget interceptor — column owner gets first crack at
      // the key. Used by the Browser+Preview modal to handle
      // Left/Right against its own per-modal WorkingDirState before
      // the underlying list widget (which has no Left/Right
      // semantics) returns 'none' and the key falls through to the
      // dashboard's default browser pane handler. Swallow errors so
      // a broken interceptor cannot destabilise modal paint — same
      // policy as `onAfterKey` / `onAfterMouse`.
      if (colDef.onIntercept) {
        let intercept: 'consumed' | 'passthrough' | undefined;
        try { intercept = colDef.onIntercept(ev); }
        catch (err) {
          if (debug.enabled) {
            debug.log('modal.live-pane-multi.onIntercept.error', colDef.widgetInstanceId, {
              err: err instanceof Error ? err.message : String(err),
              key: ev.name,
              focusIdx,
            }, { level: 'error' });
          }
          intercept = undefined;
        }
        if (intercept === 'consumed' || intercept === 'passthrough') {
          if (debug.enabled) {
            debug.log('modal.live-pane-multi.onIntercept', colDef.widgetInstanceId, {
              key: ev.name,
              outcome: intercept,
              focusIdx,
            });
          }
          return intercept;
        }
      }
      const def = params.widgetHost.defFor(colDef.widgetInstanceId);
      const inst = params.widgetHost.get(colDef.widgetInstanceId);
      if (!def || !inst || !def.onKey) return 'passthrough' as const;
      // Build a synthesized WidgetContext. This intentionally carries
      // only the fields widget onKey handlers commonly touch; fuller
      // ctx plumbing lands alongside the widget-host.buildContext
      // migration (tracked in TECH-DEBT).
      const widgetCtx = {
        width: lastMatrix.cells[focusIdx]?.bounds.width ?? 0,
        height: lastMatrix.cells[focusIdx]?.bounds.height ?? 0,
        focused: true,
        character: inst.character,
      } as unknown as Parameters<NonNullable<WidgetDef['onKey']>>[2];
      let action: Action;
      try {
        action = def.onKey(ev, inst.state, widgetCtx);
      } catch (err) {
        if (debug.enabled) debug.log('modal.live-pane-multi.onKey.error', colDef.widgetInstanceId, { err: err instanceof Error ? err.message : String(err) }, { level: 'error' });
        return 'passthrough' as const;
      }
      if (debug.enabled) {
        debug.log('modal.live-pane-multi.onKey', colDef.widgetInstanceId, {
          key: ev.name,
          action: action.type,
          focusIdx,
        });
      }
      // Cross-widget coupling — e.g. Browser cursor change must kick
      // Preview refresh. Runs after the widget mutated its state so
      // the hook reads the new value. Swallowed errors never break
      // modal paint (same policy as onKey/onMouse above).
      if (colDef.onAfterKey) {
        try { colDef.onAfterKey(action, ev); }
        catch (err) {
          if (debug.enabled) {
            debug.log('modal.live-pane-multi.onAfterKey.error', colDef.widgetInstanceId, {
              err: err instanceof Error ? err.message : String(err),
            }, { level: 'error' });
          }
        }
      }
      // Treat any non-'none' action as consumed — the widget owned
      // the key. The coordinator won't dispatch the action further
      // (Track A scope keeps the action local to the widget; lift to
      // full action dispatch in a follow-up when modal widgets emit
      // externally-observable actions).
      return action.type === 'none' ? 'passthrough' : 'consumed';
    },
    onMouse: (ev: DisplayMouseEvent) => {
      if (isModalChromeMouseEventType(ev.type)) {
        const bounds = currentBounds();
        const chromeAction = resolvePaneMultiChromeAction(bounds, params.chrome, ev.row, ev.col);
        if (chromeAction) {
          try { params.onChromeAction?.(chromeAction, ev); } catch { /* isolate */ }
          return { type: 'refresh' } as const;
        }
        if (isPaneMultiTitleRailHit(bounds, params.chrome, ev.row, ev.col)) {
          ev.hitTarget = { kind: 'modal-title', modalId: id };
          return { type: 'refresh' } as const;
        }
      }
      // Clicks / scrolls translate to widget-local (row, col) and
      // dispatch to the hit column's widget onMouse.
      const hit = hitColumnForMouse(ev);
      if (hit < 0) return { type: 'none' } as const;
      if (isPointerFocusMouseEventType(ev.type)) {
        if (hit !== focusIdx) {
          if (debug.enabled) debug.log('modal.live-pane-multi.focus', 'mouse', { from: focusIdx, to: hit });
          focusIdx = hit;
          if (ev.type === 'motion') return { type: 'refresh' } as const;
        }
      }
      const colDef = columns[hit];
      if (!colDef) return { type: 'none' } as const;
      const def = params.widgetHost.defFor(colDef.widgetInstanceId);
      const inst = params.widgetHost.get(colDef.widgetInstanceId);
      if (!def || !inst || !def.onMouse) return { type: 'none' } as const;
      const b = lastMatrix.cells[hit]?.bounds;
      if (!b) return { type: 'none' } as const;
      const localCol = ev.col - b.col;   // 0-indexed within column
      const localRow = ev.row - b.row;
      if (localCol < 0 || localRow < 0 || localRow >= b.height) {
        // Click on border / divider / title — consumed but no widget
        // dispatch (matches pane click semantics).
        return { type: 'none' } as const;
      }
      const widgetCtx = {
        width: b.width,
        height: b.height,
        focused: true,
        character: inst.character,
      } as unknown as Parameters<NonNullable<WidgetDef['onMouse']>>[2];
      // Widget onMouse expects {type, row, col} without shift/modal
      // metadata — synthesize the narrower shape. `ev.type` is the
      // superset; modal-local widget event types are a subset, so
      // `hover-*` and `motion` fall through as no-op.
      // Widget onMouse supports click/double-click/scroll-up/scroll-down/
      // drag/release. The DisplayMouseEvent superset adds right-click +
      // motion; filter those out so the narrower widget signature is
      // respected.
      const widgetType = ev.type;
      if (widgetType === 'right-click') {
        const action = colDef.onRightClick?.(ev, {
          localRow,
          localCol,
          cellIndex: hit,
        }) ?? { type: 'none' } as const;
        if (debug.enabled && action.type !== 'none') {
          debug.log('modal.live-pane-multi.onRightClick', colDef.widgetInstanceId, {
            row: localRow, col: localCol, action: action.type,
          });
        }
        return action;
      }
      if (widgetType === 'motion') {
        return { type: 'none' } as const;
      }
      let action: Action;
      try {
        action = def.onMouse(
          { type: widgetType, row: contentOnlyMouseRow(localRow), col: localCol },
          inst.state,
          widgetCtx,
        );
      } catch (err) {
        if (debug.enabled) debug.log('modal.live-pane-multi.onMouse.error', colDef.widgetInstanceId, { err: err instanceof Error ? err.message : String(err) }, { level: 'error' });
        return { type: 'none' } as const;
      }
      if (debug.enabled && action.type !== 'none') {
        debug.log('modal.live-pane-multi.onMouse', colDef.widgetInstanceId, {
          mouse: widgetType, row: localRow, col: localCol, action: action.type,
        });
      }
      // α.2 — cross-widget coupling mirror of the onAfterKey hook at
      // line 713. Fires after widget.onMouse so the callback reads the
      // post-mutation state. Swallowed errors never break modal paint
      // (same policy as onKey/onMouse/onAfterKey). See Codex comment
      // #4286180153 point 2.
      if (colDef.onAfterMouse) {
        try { colDef.onAfterMouse(action, ev); }
        catch (err) {
          if (debug.enabled) {
            debug.log('modal.live-pane-multi.onAfterMouse.error', colDef.widgetInstanceId, {
              err: err instanceof Error ? err.message : String(err),
            }, { level: 'error' });
          }
        }
      }
      return action;
    },
  };

  const { dispose: popFn } = params.coordinator.pushModal(surface);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearSchedule(timer);
    timer = null;
    if (activeByGroup.get(group) === handle) activeByGroup.delete(group);
    try { popFn(); } catch { /* coordinator already disposed */ }
    // H2.3 — tear down the chrome-layer so the LayerTree mirror +
    // RenderCoordinator bridge don't leak the modal's id past
    // dispose. chromeLayer.dispose() is idempotent; swallowed errors
    // match the coordinator pop policy above.
    try { chromeLayer.dispose(); } catch { /* layer tree already torn down */ }
    if (debug.enabled) debug.log('modal.live-pane-multi.dispose', id, { id, group });
    if (params.onDispose) {
      try { params.onDispose(); } catch { /* swallow */ }
    }
  };

  if (ttlMs > 0) timer = schedule(dispose, ttlMs);

  const handle: LivePaneMultiModalHandle = {
    id,
    bounds: initialBounds,
    columnCount: columns.length,
    focusedColumn: () => focusIdx,
    dispose,
  };
  activeByGroup.set(group, handle as unknown as PaneMultiModalHandle);
  return handle;
}

/** Live variant uses a slightly different default height heuristic —
 *  widget columns tend to want more vertical space than text
 *  snapshots. Falls back to the shared compute when caller supplies
 *  explicit width/height/bounds. */
function computeBoundsForLive(params: ShowLivePaneMultiModalParams): ModalBounds {
  if (params.bounds) return clampBounds(params.bounds, params.termCols, params.termRows);
  const minWidth = Math.min(MIN_COLUMN_INNER_LIVE + 6, Math.max(4, params.termCols - 2));
  const minHeight = Math.min(10, Math.max(5, params.termRows - 2));
  const width = params.width
    ?? Math.max(minWidth, Math.min(params.termCols - 2, Math.floor(params.termCols * 0.88)));
  const height = params.height
    ?? Math.max(minHeight, Math.min(params.termRows - 2, Math.floor(params.termRows * 0.85)));
  const row = Math.max(1, Math.floor((params.termRows - height) / 2) + 1);
  const col = Math.max(1, Math.floor((params.termCols - width) / 2) + 1);
  return clampBounds({ row, col, width, height }, params.termCols, params.termRows);
}

const MIN_COLUMN_INNER_LIVE = 20;

// Also needed for onMouse typing inside the file.
type DisplaySurface = import('../../display/types.js').DisplaySurface;
