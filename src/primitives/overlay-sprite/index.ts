// ─────────────────────────────────────────────────────────────────
// OverlaySprite Primitive — public API
// · PLAN-drag-overlay-primitive.md §5 · 2026-04-22
// · Sibling of chrome-layer (H2.3 / W5) — same LayerTree + RC wiring,
//   caller-provided paint fn instead of fixed border/title, and
//   frame-split cleanup + stamp support on bounds change.
//
// Intent
// ──────
//   Cursor-follow overlays (drag ghost badge · drop highlight rect ·
//   DS-4c LLM context banner · future hover popovers) historically
//   emitted `moveTo + content + RESET` directly via stdout.write
//   AFTER the main draw. That bypasses the diff renderer, which sees
//   the underlying cells as "unchanged" on the next frame — leaving
//   a trail of previously-painted badges.
//
//   This primitive wraps the "absolute-position overlay that moves
//   between frames" pattern:
//     · mounts a LayerTree node (zTier 'overlay' by default,
//       repaintBoundary: true) so the compositor knows the sprite
//       exists and where
//     · asks the caller for a paint(bounds) function
//     · tracks the previously-painted bounds and can emit a cleanup
//       string for cells that were in the old rect but aren't in the
//       new one before the next main-frame render
//     · emits the caller's fresh paint after the main frame
//
// This is a TUI analog of Wayland subsurface + damage_buffer, Android
// WindowManager drag shadow, Flutter Overlay+OverlayEntry, and
// Notcurses plane move_yx-with-redraw.
//
// W1 + W2 integration gives the primitive future W4 DamageRegion
// auto-consumption (Phase γ) for zero-change · but the primitive is
// usable standalone today via `handle.paint()` returning a pure ANSI
// string the caller writes after the main frame.
// ─────────────────────────────────────────────────────────────────

import type { LayerId, Rect } from '../layer-tree/index.js';

// Re-export for caller convenience.
export type { LayerId, Rect };

// ── Types ─────────────────────────────────────────────────────────

/** Caller-provided paint function.
 *
 *  Receives the sprite's current bounds. Must return an ANSI string
 *  that stamps the sprite into those cells — callers typically
 *  compose one or more `ansi.moveTo(r, c) + content + RESET` sequences
 *  per row of the bounds.
 *
 *  Contract:
 *    - pure wrt caller state (two calls with identical bounds and
 *      identical caller-captured state produce identical output)
 *    - empty string is legal (e.g. "sprite temporarily invisible" —
 *      combined with a 0×0 bounds update this is the hide pattern)
 *    - paint must not include a trailing newline — overlays write
 *      mid-frame; a newline would push the terminal's cursor and
 *      corrupt the main draw
 */
export type OverlaySpritePainter = (bounds: Rect) => string;

export interface OverlaySpriteOptions {
  /** LayerTree the sprite registers with. */
  readonly tree: import('../layer-tree/index.js').LayerTree;
  /** RenderCoordinator the sprite marks dirty against. */
  readonly rc: import('../render-coordinator/index.js').RenderCoordinator;
  /** Layer id in the tree. Defaults to `overlay-<n>` when absent. */
  readonly id?: LayerId;
  /** Initial bounds. Sprite is mounted at this rect. */
  readonly bounds: Rect;
  /** Initial paint function. Called from `handle.paint()`. */
  readonly paint: OverlaySpritePainter;
  /** Z-tier · defaults to 'overlay' (top-most transients — matches
   *  surface/z-tier.ts semantics for tooltip + cursor-follow). */
  readonly zTier?: import('../../surface/z-tier.js').ZTier;
  /** Within-tier order · default 0. Higher = closer to top. */
  readonly zIndex?: number;
  /** Opaque flag forwarded to LayerTree — rarely true for sprites
   *  (they're usually small badges atop dense UI); default false. */
  readonly opaque?: boolean;
}

export interface OverlaySpriteUpdate {
  readonly bounds?: Rect;
  readonly paint?: OverlaySpritePainter;
}

export interface OverlaySpriteHandle {
  readonly id: LayerId;
  /** Current bounds snapshot · reflects the last successful update. */
  readonly bounds: Rect;
  /** Compose the pre-frame cleanup string for the current frame.
   *  Emits erase sequences for cells in the previous rect that no
   *  longer belong to the current rect. Safe to call before the main
   *  frame render so underlying rows can repaint over the cleanup.
   *  Returns '' on first frame or when no cleanup is needed. */
  prepareFrame(): string;
  /** Compose the post-frame stamp string for the current frame.
   *  Emits only the caller's paint for the current bounds and records
   *  current bounds as "previously painted" for the next frame. */
  paint(): string;
  /** Mutate bounds or the paint fn (or both). A real change marks the
   *  layer dirty (tree.setBounds + rc.markNeedsPaint when bounds
   *  differs · rc.markNeedsPaint only when only the paint fn changed).
   *  Same-value updates are silent no-ops — chrome-layer discipline. */
  update(next: OverlaySpriteUpdate): void;
  /** Remove from LayerTree. Idempotent. After dispose `paint()` = ''
   *  and `update()` is a no-op — safe to race with async events. */
  dispose(): void;
}

export { createOverlaySprite } from './overlay-sprite.js';
