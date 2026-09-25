// ─────────────────────────────────────────────────────────────────
// chrome-layer Primitive — Compositor-owned modal chrome
// · H2.3 / W5 of PLAN-compositor-w5-chrome-transfer.md
// · ROADMAP-compositor-primitive §4.2 H2.3 · §3.1 W5 · ⭐ M3 anchor
//
// Encapsulates the outer border + centered title + optional backdrop
// that `src/dashboard-pane-multi-modal.ts` used to draw inline inside
// its paint() function. Registers the chrome as a first-class node in
// the W1 LayerTree (zTier: 'modal' · repaintBoundary: true) and wires
// geometry / title / focus mutations through W2 RenderCoordinator's
// markNeedsPaint so downstream consumers (W4 DamageRegion · printer-
// cell-model in Phase γ) observe chrome changes via the same event
// surface they already watch for widget layers.
//
// Intent (M3 anchor · post-H2.3):
//   - chrome sits on exactly one primitive, not scattered across
//     caller paint() blocks. Future chrome regressions get fixed in
//     this module, not in every modal host.
//   - widget-level chrome suppression bridge became redundant once the
//     compositor owned the outer frame. `R3` later removed the public
//     `RenderCtx.embedded` field entirely.
//   - pane-multi-modal is the first consumer · renderModalOverlay /
//     renderLayout / log-pane etc. follow in H3 Phase δ.
//
// Scope limits (per PLAN §1.2):
//   - Paint is pure string emit · stdout writing stays at the coord
//     layer (DECSET 2026 wrap in H1 Phase γ).
//   - No off-screen buffer · no content rendering · caller keeps
//     writing widget content into `inner` after chrome.paint().
//   - No W4 DamageRegion auto-build · caller (or Phase γ wire) builds
//     via buildDamageFromRenderCoordinator as needed.
// ─────────────────────────────────────────────────────────────────

import type { LayerId, LayerTree, Rect } from '../primitives/layer-tree/index.js';
import type { LayerHandle } from '../primitives/layer-tree/handle.js';
import type { RenderCoordinator } from '../primitives/render-coordinator/index.js';
import { ansi, C, visibleWidth, stripAnsi } from '../tui.js';
import { debug } from '../debug/log.js';

// ── id counter ────────────────────────────────────────────────────

let chromeIdCounter = 0;

// ── Types ─────────────────────────────────────────────────────────

/** Inner rect (1-indexed row/col) that content is rendered into.
 *  Outer `bounds.width × bounds.height` minus 1-cell border on each
 *  side. When the outer frame is too small (width<3 or height<3) the
 *  inner width/height clamp to 0 so callers can safely skip content
 *  render. */
export interface ChromeLayerInnerBounds {
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
}

export interface ChromeFramePaintOptions {
  readonly bounds: Rect;
  readonly title: string;
  readonly termCols?: number;
  readonly termRows?: number;
  readonly withBackdrop?: boolean;
  readonly frameSpec?: ChromeFrameStyleSpec;
}

export interface ChromeFrameStyleSpec {
  readonly borderVariant?: 'plain' | 'rounded' | 'double' | 'heavy';
  readonly borderStyle?: string;
  readonly titleBarStyle?: string;
  readonly titleTextStyle?: string;
  readonly titleAlign?: 'left' | 'center';
  readonly titlePrefix?: string;
  readonly titleRight?: string;
  readonly titleRightStyle?: string;
  readonly bottomText?: string;
  readonly bottomStyle?: string;
}

export interface ChromeLayerOptions {
  readonly tree: LayerTree;
  readonly rc: RenderCoordinator;
  /** Layer id in the tree. Defaults to `chrome-<n>` when absent. */
  readonly id?: LayerId;
  /** Outer rect of the chrome (border included). */
  readonly bounds: Rect;
  /** Title text shown centered on the top border. Empty → bare horizontal. */
  readonly title: string;
  /** Focused flag · reserved for future border-tint variance. Today
   *  pane-multi-modal uses a single muted tint for both states; the
   *  field is carried anyway so future theme work has a structural
   *  hook without another migration. */
  readonly focused: boolean;
  /** Terminal size · used when `withBackdrop` is true to fill the
   *  full screen before stamping the chrome. Ignored otherwise. */
  readonly termCols: number;
  readonly termRows: number;
  /** Opt-in to full-terminal backdrop fill. pane-multi-modal sets true
   *  (matches legacy paint flow · prevents pane chrome bleed around
   *  the modal rect). Default false (chrome only). */
  readonly withBackdrop?: boolean;
  readonly frameSpec?: ChromeFrameStyleSpec;
  /** Verbatim pass-through to LayerTree's `LayerSpec.opaque` (α.2
   *  opt-in). Caller asserts the chrome covers its bounds opaquely so
   *  paint-optimizer can skip layers strictly beneath it. */
  readonly occluding?: boolean;
}

export interface ChromeLayerHandle {
  readonly id: LayerId;
  /** Inner content rect · read-only snapshot · recomputed on every
   *  `update({ bounds })`. */
  readonly inner: ChromeLayerInnerBounds;
  /** Produce the paint string for the current frame. Pure function
   *  of the current options — no stdout side effect. Empty string
   *  when disposed or when bounds are too small. */
  paint(): string;
  /** Mutate one or more options. Any real change marks the layer
   *  dirty via `rc.markNeedsPaint`. Setting a value equal to current
   *  is a no-op (no dirty mark, no LayerTree event). */
  update(next: ChromeLayerUpdate): void;
  /** Remove from LayerTree. Idempotent. After dispose, `paint()`
   *  returns '' and `update()` is a no-op · safe to call during a
   *  lifecycle race. */
  dispose(): void;
}

export type ChromeLayerUpdate = Partial<Pick<
  ChromeLayerOptions,
  'bounds' | 'title' | 'focused' | 'termCols' | 'termRows'
>>;

// ── Factory ───────────────────────────────────────────────────────

export function createChromeLayer(opts: ChromeLayerOptions): ChromeLayerHandle {
  const id = opts.id ?? (`chrome-${++chromeIdCounter}` as LayerId);
  const tree = opts.tree;
  const rc = opts.rc;
  const withBackdrop = opts.withBackdrop ?? false;
  const occluding = opts.occluding;

  let bounds: Rect = opts.bounds;
  let title: string = opts.title;
  let focused: boolean = opts.focused;
  let termCols: number = opts.termCols;
  let termRows: number = opts.termRows;
  const frameSpec = opts.frameSpec;
  let disposed = false;
  let inner: ChromeLayerInnerBounds = computeChromeInnerBounds(bounds);

  // Register in LayerTree. We pass `opaque` aligned with the α.2
  // caller intent ("this chrome fully covers its bounds") but callers
  // that aren't sure should leave occluding undefined — the paint
  // optimizer only uses it as an opt-in hint.
  const layerHandle: LayerHandle = tree.addLayer({
    id,
    bounds,
    zTier: 'modal',
    zIndex: 0,
    repaintBoundary: true,
    ...(occluding !== undefined ? { opaque: occluding } : {}),
  });

  if (debug.enabled) {
    debug.log('chrome.layer.mount', id, {
      bounds, title, focused, withBackdrop, occluding,
    });
  }

  const markDirty = (reason: string): void => {
    if (disposed) return;
    rc.markNeedsPaint(id);
    if (debug.enabled) debug.log('chrome.layer.dirty', id, { reason });
  };

  const paint = (): string => {
    if (disposed) return '';
    return paintChromeFrame({
      bounds,
      title,
      termCols,
      termRows,
      withBackdrop,
      frameSpec,
    });
  };

  const update: ChromeLayerHandle['update'] = (next) => {
    if (disposed) return;
    let geometryChanged = false;
    let cosmeticChanged = false;

    if (next.bounds !== undefined && !rectEq(bounds, next.bounds)) {
      bounds = next.bounds;
      inner = computeChromeInnerBounds(bounds);
      // LayerTree.setBounds fires its own `dirty` event with
      // reason='bounds' · the coord shadow bridge (H1.6) forwards
      // that to `rc.markNeedsPaint(id)`. We still call markDirty
      // explicitly so consumers that use the primitive without the
      // coord bridge (tests · future standalone hosts) don't rely on
      // the bridge to surface the mark.
      tree.setBounds(id, bounds);
      geometryChanged = true;
    }
    if (next.title !== undefined && title !== next.title) {
      title = next.title;
      cosmeticChanged = true;
    }
    if (next.focused !== undefined && focused !== next.focused) {
      focused = next.focused;
      cosmeticChanged = true;
    }
    if (next.termCols !== undefined && termCols !== next.termCols) {
      termCols = next.termCols;
      // Only forces a repaint when the backdrop is on; otherwise
      // termCols is unused.
      if (withBackdrop) cosmeticChanged = true;
    }
    if (next.termRows !== undefined && termRows !== next.termRows) {
      termRows = next.termRows;
      if (withBackdrop) cosmeticChanged = true;
    }

    if (geometryChanged || cosmeticChanged) markDirty('update');
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try { layerHandle.dispose(); } catch { /* tree may have been torn down */ }
    if (debug.enabled) debug.log('chrome.layer.dispose', id, {});
  };

  return {
    id,
    get inner() { return inner; },
    paint,
    update,
    dispose,
  };
}

// ── Helpers (pure) ────────────────────────────────────────────────

export function computeChromeInnerBounds(b: Rect): ChromeLayerInnerBounds {
  const width = Math.max(0, b.width - 2);
  const height = Math.max(0, b.height - 2);
  return {
    row: b.row + 1,
    col: b.col + 1,
    width,
    height,
  };
}

export function paintChromeFrame(opts: ChromeFramePaintOptions): string {
  const {
    bounds,
    title,
    termCols = 0,
    termRows = 0,
    withBackdrop = false,
    frameSpec,
  } = opts;
  const { row, col, width, height } = bounds;
  if (width < 3 || height < 3) return '';

  const parts: string[] = [];
  if (withBackdrop && termCols > 0 && termRows > 0) {
    const blank = ' '.repeat(termCols);
    for (let r = 1; r <= termRows; r++) {
      parts.push(ansi.moveTo(r, 1) + '\x1b[0m' + blank);
    }
  }

  const innerWidth = width - 2;
  const glyphs = resolveBorderGlyphs(frameSpec?.borderVariant ?? 'plain');
  parts.push(paintTopBorder(row, col, innerWidth, title, glyphs, frameSpec));
  for (let r = 1; r < height - 1; r++) {
    const absRow = row + r;
    const borderPaint = frameSpec?.borderStyle ?? '';
    parts.push(ansi.moveTo(absRow, col) + (borderPaint + glyphs.v + (borderPaint ? '\x1b[0m' : '')));
    parts.push(ansi.moveTo(absRow, col + width - 1) + (borderPaint + glyphs.v + (borderPaint ? '\x1b[0m' : '')));
  }
  parts.push(paintBottomBorder(row + height - 1, col, innerWidth, glyphs, frameSpec));
  return parts.join('');
}

function rectEq(a: Rect, b: Rect): boolean {
  return a.row === b.row
    && a.col === b.col
    && a.width === b.width
    && a.height === b.height;
}

function paintTopBorder(
  row: number,
  col: number,
  innerWidth: number,
  title: string,
  glyphs: BorderGlyphs,
  frameSpec?: ChromeFrameStyleSpec,
): string {
  const borderPaint = frameSpec?.borderStyle ?? '';
  const fillPaint = frameSpec?.titleBarStyle ?? '';
  const titlePaint = frameSpec?.titleTextStyle ?? '';
  const rightPaint = frameSpec?.titleRightStyle ?? titlePaint;
  const align = frameSpec?.titleAlign ?? 'center';
  const prefix = frameSpec?.titlePrefix?.trim().length ? `${frameSpec.titlePrefix} ` : '';
  const baseTitle = `${prefix}${title}`.trim();
  const rightText = frameSpec?.titleRight ?? '';

  if (!fillPaint && baseTitle.length === 0 && rightText.length === 0) {
    return ansi.moveTo(row, col)
      + paintBorder(borderPaint, glyphs.tl + glyphs.h.repeat(innerWidth) + glyphs.tr);
  }
  const titleBody = truncatePlain(baseTitle, Math.max(0, innerWidth - 2));
  const rightBody = truncatePlain(rightText, Math.max(0, innerWidth - 2));
  let out = ansi.moveTo(row, col) + paintBorder(borderPaint, glyphs.tl);
  out += ansi.moveTo(row, col + 1)
    + (fillPaint ? `${fillPaint}${' '.repeat(innerWidth)}\x1b[0m` : paintBorder(borderPaint, glyphs.h.repeat(innerWidth)));

  if (titleBody.length > 0) {
    const decorated = ` ${titleBody} `;
    const titleVW = visibleWidth(stripAnsi(decorated));
    const titleX = align === 'left'
      ? col + 1
      : col + 1 + Math.max(0, Math.floor((innerWidth - titleVW) / 2));
    out += ansi.moveTo(row, titleX)
      + (titlePaint ? `${titlePaint}${decorated}\x1b[0m` : decorated);
  }

  if (rightBody.length > 0) {
    const decorated = ` ${rightBody} `;
    const rightVW = visibleWidth(stripAnsi(decorated));
    const rightX = col + 1 + Math.max(0, innerWidth - rightVW);
    out += ansi.moveTo(row, rightX)
      + (rightPaint ? `${rightPaint}${decorated}\x1b[0m` : decorated);
  }

  out += ansi.moveTo(row, col + innerWidth + 1) + paintBorder(borderPaint, glyphs.tr);
  return out;
}

function paintBottomBorder(
  row: number,
  col: number,
  innerWidth: number,
  glyphs: BorderGlyphs,
  frameSpec?: ChromeFrameStyleSpec,
): string {
  const borderPaint = frameSpec?.borderStyle ?? '';
  const bottomPaint = frameSpec?.bottomStyle ?? '';
  const bottomText = frameSpec?.bottomText ?? '';
  if (!bottomPaint && bottomText.length === 0) {
    return ansi.moveTo(row, col)
      + paintBorder(borderPaint, glyphs.bl + glyphs.h.repeat(innerWidth) + glyphs.br);
  }
  let out = ansi.moveTo(row, col) + paintBorder(borderPaint, glyphs.bl);
  out += ansi.moveTo(row, col + 1)
    + (bottomPaint ? `${bottomPaint}${' '.repeat(innerWidth)}\x1b[0m` : paintBorder(borderPaint, glyphs.h.repeat(innerWidth)));
  if (bottomText.length > 0) {
    const decorated = ` ${truncatePlain(bottomText, Math.max(0, innerWidth - 2))} `;
    out += ansi.moveTo(row, col + 1)
      + (bottomPaint ? `${bottomPaint}${decorated}\x1b[0m` : decorated);
  }
  out += ansi.moveTo(row, col + innerWidth + 1) + paintBorder(borderPaint, glyphs.br);
  return out;
}

interface BorderGlyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

function resolveBorderGlyphs(variant: 'plain' | 'rounded' | 'double' | 'heavy'): BorderGlyphs {
  switch (variant) {
    case 'rounded':
      return { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
    case 'double':
      return { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' };
    case 'heavy':
      return { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' };
    default:
      return { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };
  }
}

function paintBorder(style: string, text: string): string {
  return style ? `${style}${text}\x1b[0m` : C.muted(text);
}

function truncatePlain(s: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (visibleWidth(stripAnsi(s)) <= maxW) return s;
  return s.slice(0, Math.max(0, maxW - 1)) + '…';
}

// ── Test helper (intentionally exported) ─────────────────────────

/** Reset the auto-id counter · test-only. Not part of the public
 *  contract — calling this from production code would invalidate
 *  layer ids that are still live in a tree. */
export function _resetChromeIdCounterForTesting(): void {
  chromeIdCounter = 0;
}
