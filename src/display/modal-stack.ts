// Modal stack scaffolding — P2.3.a.
//
// Adds the structural concept of a coordinator-owned modal: a
// surface with `kind: 'modal'` that knows its own bounds + paint
// method + (optional) cursor claim. The coordinator already has
// LIFO focus-stack routing for `kind: 'modal'` surfaces (since
// P0); this file adds the matching render pipeline + helpers so
// pickers (P2.3.b/c) and the agent-roster search modal (P4.1)
// have a stable shape to plug into.
//
// No active modals at landing — pure plumbing. Behavior is
// observable only via tests until P2.3.b ports the slash picker.

import type { DisplaySurface, SurfaceId } from './types.js';
import type { CursorState } from './cursor-state.js';
import type { HostChromeProfile } from './host-chrome-profile.js';
import {
  isBlockingModalInteractionSurface,
  isWorkspaceInteractionSurface,
  resolveModalInteractionPolicy,
  type SurfaceInteractionClass,
} from './surface-interaction-policy.js';

/** Rectangular region a modal occupies. Coordinates are 1-indexed
 *  to match ANSI conventions (CSI r;c H). */
export interface ModalBounds {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface ModalViewport {
  rows: number;
  cols: number;
}

const MODAL_MOVE_THRESHOLD = 2;
const MIN_VISIBLE_TITLE_COLS = 8;

export type ModalWindowRole = 'foreground' | 'companion';

/** Coordinator-owned modal. Extends DisplaySurface with paint +
 *  bounds + cursor claim. The existing focus-stack routing
 *  (topFocusedSurface('modal')) handles key precedence; this type
 *  adds the render side. */
export interface ModalSurface extends DisplaySurface {
  kind: 'modal';
  bounds: ModalBounds;
  /** Optional host-bottom-band freeze override. When false, popup/menu
   *  surfaces do not suppress prompt/status/dock even if their bounds
   *  overlap the bottom interaction band. */
  freezeBottomArea?: boolean;
  /** Workspace affinity for transient surfaces that conceptually live
   *  on top of a specific foreground workspace (e.g. a VW-owned
   *  picker). When the owner workspace is disposed, dependent popups
   *  should close with it instead of lingering as dashboard-main
   *  orphans. */
  ownerWorkspaceId?: SurfaceId;
  hostChromeProfile?: HostChromeProfile;
  /** Canonical interaction class. Product-level meaning:
   *  - `workspace`: Main-equivalent foreground work surface (e.g. VW)
   *  - `blocking-modal`: true popup / dialog / picker / terminal modal
   *  - `embedded-overlay`: companion / local overlay that coexists
   *
   *  Optional during migration. When absent, policy helpers infer a
   *  class from existing `windowRole` / `backgroundInteractionPolicy`
   *  / `hostChromeProfile` fields. */
  interactionClass?: SurfaceInteractionClass;
  /** C-d-1 (2026-07-12) — 하단 슬롯 결정 뷰 마커. 'bottom' 이면 이 모달은
   *  composer zone 을 교체하는 결정 뷰(codex bottom_pane view_stack ·
   *  claude-code focusedInputDialog 동형)로 배치되며, 활성 동안 호스트는
   *  composer 페인트를 멈춘다(essential 모드 · 하단 영역 단일 소유자). */
  slot?: 'bottom';
  /** Ownership convergence track — optional rect describing the
   *  clickable / hit-test-active region of the modal. When omitted,
   *  callers should fall back to `bounds` (pre-W2 behavior).
   *
   *  Use this when a modal paints a full-screen backdrop but only a
   *  centered window rect should receive click ownership. */
  interactiveBounds?: ModalBounds;
  /** Optional visual window rect. Useful for diagnostics and future
   *  window-role policies where `bounds` may describe the backdrop
   *  invalidate region rather than the visible chrome box. */
  visualBounds?: ModalBounds;
  /** Optional backdrop / occlusion rect. Present when a modal owns a
   *  larger background dim region than its clickable window body. */
  backdropBounds?: ModalBounds;
  /** Background interaction policy. `block` means background status
   *  bar / input / pane surfaces should be treated as non-
   *  interactive while this modal is topmost. `allow` preserves the
   *  pre-existing shared-background behavior for companion surfaces. */
  backgroundInteractionPolicy?: 'allow' | 'block';
  /** Product-facing window role. `foreground` participates in modal
   *  view-mode ownership and may block background interaction.
   *  `companion` stays visible/live without claiming global modal
   *  ownership for the whole dashboard. */
  windowRole?: ModalWindowRole;
  /** Optional resize-handle reveal hint. Presentation-only: input
   *  wiring may toggle this after a stable corner hover so modal
   *  chrome can paint a visible affordance without changing hit-test
   *  ownership. */
  resizeHandleHint?: 'nw' | 'ne' | 'sw' | 'se' | null;
  /** Returns ANSI string painted at `bounds`. Coordinator splices
   *  this into the post-render overlay.
   *
   *  Phase 4.5a (2026-05-03 · §4-pre.7) — paint() MUST be side-
   *  effect-free per REQUIREMENTS §1.6: no markDirty, no setFocus,
   *  no surface mutation (including `surface.bounds = ...`), no
   *  requestRender. Layout-dynamic surfaces (e.g. picker whose
   *  height shrinks with filter) declare a `getBounds()` lifecycle
   *  hook (below) — coord settles dynamic bounds via that hook
   *  BEFORE regionMap.resolve and paint, eliminating the snapshot/
   *  paint race that produced the picker `잔상` artifact (incident
   *  log: log/debug-20260503151235.log 13:06.292).
   *
   *  Structural guard `test/federation-guard-f12-paint-no-bounds-
   *  mutation.test.ts` bans bounds-assignment patterns inside any
   *  paint() body. */
  paint(): string;
  /** Phase 4.5a (2026-05-03 · §4-pre.7) — optional layout settle
   *  hook for surfaces whose `bounds` depend on runtime state. When
   *  defined, the coordinator calls this BEFORE regionMap.resolve()
   *  for each frame. The return value is treated as the desired
   *  bounds for this frame; coord assigns it to `surface.bounds`
   *  (with the §1.5 numeric-equality short-circuit) and invalidates
   *  the paint cache entry on change.
   *
   *  Returning `null` = no preference (use existing `surface.bounds`
   *  as-is). Returning the same numeric values as the current
   *  `surface.bounds` is a no-op (no mutation, no cache eviction).
   *
   *  Surfaces with FIXED bounds (the canonical case — most
   *  modals) MUST omit this method. Only opt in when the surface
   *  has genuinely dynamic layout. */
  getBounds?(): ModalBounds | null;
  /** Optional caret claim. Topmost modal whose cursor() returns
   *  non-null wins over coordinator.setCursor(). */
  cursor?(): CursorState | null;
  /** α.2 (compositor primitive track · 2026-04-21) — opt-in opaque
   *  flag. When `true`, this modal asserts its `bounds` is rendered
   *  fully opaque (no see-through pixels) so the compositor may skip
   *  painting modals strictly beneath it (they are completely
   *  occluded). Analogous to Wayland's `wl_surface.set_opaque_region`
   *  and Ratatui's state-driven conditional render — an
   *  *optimization*, NOT a hit-test semantic change (z-order routing
   *  is unchanged · a mouse click still lands on the top modal).
   *  Undefined / false → coordinator paints every modal (pre-α.2
   *  behavior · backward-compat default). Set `true` only when the
   *  modal's paint truly covers its `bounds` with no transparency —
   *  incorrect opt-in leaks lower modals' pixels at the edges. */
  occluding?: boolean;
  /** Phase 4 (substrate Occam · §4-pre.8 · 2026-05-03) — paint cache
   *  generation counter. Coordinator caches the most recent paint()
   *  output keyed by `(id, bounds, generation)`. When all three match
   *  the cached entry, paint() is skipped and the cached ANSI string
   *  is reused. Surfaces with mutable state should bump this counter
   *  (via `coord.bumpGeneration(id)` or by incrementing the field
   *  directly before requesting a redraw) to invalidate the cache.
   *
   *  Default `undefined` is treated as `0` — fully cache-eligible for
   *  static surfaces that never change (terminal capability splash,
   *  compile-time menus). Caching a stateful surface at `undefined`
   *  means the first paint sticks forever — opt in to a counter and
   *  bump it on state change.
   *
   *  Pattern A (dirty-tracking mismatch) and Pattern D (reference-
   *  identity churn) structural defense: with the same generation +
   *  same bounds, a paint() that mutates `bounds` reference-by-
   *  reference but produces the same string still hits cache (no work
   *  duplicated). Bumping generation invalidates exactly when the
   *  caller knows next-paint differs. */
  generation?: number;
}

/** Type guard — narrows DisplaySurface → ModalSurface. */
export function isModalSurface(s: DisplaySurface): s is ModalSurface {
  return s.kind === 'modal'
    && typeof (s as ModalSurface).paint === 'function'
    && (s as ModalSurface).bounds !== undefined;
}

/** Phase 4 (substrate Occam · §4-pre.8) — paint cache entry. The
 *  coordinator owns one Map<SurfaceId, PaintCacheEntry> and threads it
 *  into renderModalStack each frame. Key is `(boundsKey, generation)`
 *  joined; value is the ANSI string returned by `paint()` last time
 *  the same key resolved. On hit, paint() is skipped entirely.
 *
 *  **Opt-in by explicit `generation` declaration** (post-#1406 hot
 *  fix · 2026-05-03): a surface gets cached ONLY when its
 *  `generation` field is a number (not `undefined`). Surfaces that
 *  omit the field are painted every frame — same as pre-Phase-4
 *  behavior. Rationale: many existing surfaces (dock menu recipes,
 *  popovers, picker overlays) handle their own input through
 *  dashboard-level paths (`mouseWiring.handleMouse`,
 *  `mouseWiring.dispatchKey`) instead of `coord.routeKey` /
 *  `coord.routeMouseToSurface`. The auto-bump on consumed dispatch
 *  (5 sites in coordinator.ts) only covers the coord-routed path; a
 *  surface that consumes input dashboard-side mutates state without
 *  the cache knowing, leaving stale ANSI on screen. Opt-in caching
 *  preserves the existing surface authoring contract — only surfaces
 *  that explicitly add `generation: <n>` participate in the cache.
 *
 *  Cache invalidation (when opted in):
 *  - Bounds change (row/col/width/height) → new key → miss → repaint.
 *  - Surface state change → caller bumps `generation` → miss.
 *  - Surface unmount (popModal) → coordinator deletes entry. */
export interface PaintCacheEntry {
  key: string;
  ansi: string;
}

/** Build the cache key for a modal surface. Bounds reference identity
 *  is intentionally NOT used (Pattern D structural defense for
 *  opted-in surfaces): two bounds objects with the same numeric
 *  fields produce the same key, so a paint() that rewrites `bounds =
 *  { ... }` per frame still hits cache as long as the numbers match.
 *
 *  Returns `null` when the surface has not opted into caching (no
 *  `generation` field declared). Caller must skip the cache lookup
 *  and fall through to direct paint() in that case. */
function paintCacheKey(s: ModalSurface): string | null {
  if (typeof s.generation !== 'number') return null;
  const b = s.bounds;
  return `${b.row},${b.col},${b.width}x${b.height}#${s.generation}`;
}

/** Render every modal surface in focus-stack order (bottom→top) and
 *  concatenate their paint outputs. Top modal lands LAST so its
 *  pixels overwrite any underlying ones — matches normal z-order
 *  expectation.
 *
 *  α.2 (2026-04-21) — `occluding` opt-in: when any modal in the
 *  stack declares `occluding: true`, every modal *strictly beneath
 *  the highest such modal* is skipped (completely covered · its
 *  pixels are invisible after the occluder paints). Modals at or
 *  above the occluder still render so overlapping popovers land on
 *  top. This mirrors Wayland's opaque-region optimization and
 *  Ratatui's conditional render. Equivalent to the pre-α.2 output
 *  *as long as* opt-in modals really cover their `bounds` — which is
 *  the caller's contract.
 *
 *  Phase 4 (substrate Occam · §4-pre.8) — optional `paintCache`.
 *  When passed, each modal's paint() output is cached by `(id,
 *  bounds, generation)`. Cache hit reuses the prior ANSI string and
 *  skips paint() entirely. Caller (coordinator) owns the map; this
 *  function mutates it with hits/misses. */
export function renderModalStack(input: {
  surfaces: Map<SurfaceId, DisplaySurface>;
  focusStack: readonly SurfaceId[];
  paintCache?: Map<SurfaceId, PaintCacheEntry>;
  /** When provided, the function calls this on each cache decision.
   *  Test-only hook (and an instrumentation seam if a future Phase 5
   *  HUD wants to surface hit-rate stats). */
  onPaintCache?: (ev: { id: SurfaceId; hit: boolean }) => void;
  /** Phase 5 F8 shadow mode (2026-05-03 · MONAD_F8_SHADOW=1) — when
   *  true, every paint cache HIT also re-runs `s.paint()` and compares
   *  the fresh string against the cached `prior.ansi`. A divergence
   *  means the surface mutated state without bumping `generation` —
   *  exactly the F8 violation class (data ↔ paint seam broken).
   *
   *  Cache value is still used for the actual frame (no double-emit,
   *  no behavior change). The check is observability-only: callers
   *  receive the divergence event via `onShadowDivergence` and
   *  typically warn into `debug.log` or a HUD counter.
   *
   *  Off-state (default false) is identical to pre-PR behavior — no
   *  extra paint() calls, no allocations. */
  shadowMode?: boolean;
  /** Called when shadowMode is true and a cache hit's fresh paint()
   *  output differs from the cached `prior.ansi`. The receiver is
   *  responsible for reporting (debug.log, HUD, etc.). */
  onShadowDivergence?: (ev: {
    id: SurfaceId;
    key: string;
    priorLen: number;
    freshLen: number;
  }) => void;
}): string {
  // α.2 · find the highest occluding modal index. Everything below it
  // is skipped. One linear scan keeps the common case (no occluders)
  // zero-cost.
  let occluderIdx = -1;
  for (let i = 0; i < input.focusStack.length; i++) {
    const id = input.focusStack[i]!;
    const s = input.surfaces.get(id);
    if (s && isModalSurface(s) && s.occluding === true) {
      occluderIdx = i;
    }
  }
  const cache = input.paintCache;
  const out: string[] = [];
  for (let i = 0; i < input.focusStack.length; i++) {
    if (i < occluderIdx) continue;  // fully covered · skip paint
    const id = input.focusStack[i]!;
    const s = input.surfaces.get(id);
    if (!s || !isModalSurface(s)) continue;
    if (cache !== undefined) {
      const key = paintCacheKey(s);
      // Surface didn't opt into caching (no generation field). Drop
      // any stale entry from a prior opt-in lifetime and fall through
      // to direct paint().
      if (key === null) {
        cache.delete(id);
      } else {
        const prior = cache.get(id);
        if (prior !== undefined && prior.key === key) {
          // Phase 5 F8 shadow mode — re-run paint() and compare. A
          // divergence means surface state changed without bumping
          // generation. Cached value is still emitted; the check is
          // observability-only.
          if (input.shadowMode) {
            try {
              const fresh = s.paint();
              if (fresh !== prior.ansi) {
                input.onShadowDivergence?.({
                  id,
                  key,
                  priorLen: prior.ansi.length,
                  freshLen: fresh.length,
                });
              }
            } catch {
              // A broken shadow paint() must not break the frame.
            }
          }
          input.onPaintCache?.({ id, hit: true });
          out.push(prior.ansi);
          continue;
        }
        try {
          const ansi = s.paint();
          cache.set(id, { key, ansi });
          input.onPaintCache?.({ id, hit: false });
          out.push(ansi);
        } catch {
          // A broken paint must not break the frame — log but continue.
        }
        continue;
      }
    }
    try {
      out.push(s.paint());
    } catch {
      // A broken paint must not break the frame — log but continue.
    }
  }
  return out.join('');
}

/** Top-of-stack modal whose cursor() returns a non-null state.
 *  Coordinator falls back to its own setCursor value when this is
 *  null. Iterates from top to bottom — first modal that claims
 *  cursor wins. */
export function topModalCursor(input: {
  surfaces: Map<SurfaceId, DisplaySurface>;
  focusStack: readonly SurfaceId[];
}): CursorState | null {
  for (let i = input.focusStack.length - 1; i >= 0; i--) {
    const id = input.focusStack[i]!;
    const s = input.surfaces.get(id);
    if (!s || !isModalSurface(s)) continue;
    if (typeof s.cursor !== 'function') continue;
    const c = s.cursor();
    if (c) return c;
  }
  return null;
}

export interface ModalStackLookup {
  focusStack: readonly SurfaceId[];
  surfaceAt: (id: SurfaceId) => DisplaySurface | null | undefined;
}

/** Return the top-most modal surface on the focus stack. Uses a
 *  lookup function so dashboard callsites can reuse the coordinator's
 *  registry directly without first copying into a Map. */
export function topModalSurface(input: ModalStackLookup): ModalSurface | null {
  for (let i = input.focusStack.length - 1; i >= 0; i--) {
    const id = input.focusStack[i]!;
    const surface = input.surfaceAt(id);
    if (surface && isModalSurface(surface)) return surface;
  }
  return null;
}

/** Return the top-most blocking foreground modal. Companion surfaces
 *  are skipped even if future callers accidentally mark them blocking;
 *  this helper is meant for product-level "background should demote"
 *  decisions. */
export function topBlockingForegroundModalSurface(input: ModalStackLookup): ModalSurface | null {
  for (let i = input.focusStack.length - 1; i >= 0; i--) {
    const id = input.focusStack[i]!;
    const surface = input.surfaceAt(id);
    if (!surface || !isModalSurface(surface)) continue;
    if (isBlockingModalInteractionSurface(surface)) return surface;
  }
  return null;
}

/** Return the top-most workspace-class modal surface. This differs
 *  from `topModalSurface()` because a blocking popup may sit above
 *  the active workspace while the workspace still defines host chrome
 *  reserve / prompt-HUD-status-dock coexistence. */
export function topWorkspaceSurface(input: ModalStackLookup): ModalSurface | null {
  for (let i = input.focusStack.length - 1; i >= 0; i--) {
    const id = input.focusStack[i]!;
    const surface = input.surfaceAt(id);
    if (!surface || !isModalSurface(surface)) continue;
    if (isWorkspaceInteractionSurface(surface)) return surface;
  }
  return null;
}

export function modalBlocksBackground(surface: ModalSurface | null | undefined): boolean {
  return resolveModalInteractionPolicy(surface).blocksHostInput;
}

export function modalWindowRole(
  surface: ModalSurface | null | undefined,
): ModalWindowRole {
  return surface?.windowRole ?? 'foreground';
}

export function modalParticipatesInViewMode(
  surface: ModalSurface | null | undefined,
): boolean {
  return !!surface && resolveModalInteractionPolicy(surface).participatesInBlockingForegroundViewMode;
}

export function shiftModalBounds(
  bounds: ModalBounds,
  delta: { row: number; col: number },
): ModalBounds {
  return {
    row: bounds.row + delta.row,
    col: bounds.col + delta.col,
    width: bounds.width,
    height: bounds.height,
  };
}

export function clampModalBoundsToViewport(
  bounds: ModalBounds,
  viewport: ModalViewport,
): ModalBounds {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  // Keep at least part of the title rail reachable even when the
  // modal is wider than the viewport. We preserve size; moving a
  // modal should not implicitly resize it.
  const visibleTitleCols = Math.max(
    1,
    Math.min(width, viewport.cols, MIN_VISIBLE_TITLE_COLS),
  );
  const minCol = visibleTitleCols - width + 1;
  const maxCol = viewport.cols - visibleTitleCols + 1;
  return {
    // Vertical policy is stricter: the title row must stay visible.
    row: Math.min(Math.max(1, bounds.row), Math.max(1, viewport.rows)),
    col: Math.min(Math.max(minCol, bounds.col), Math.max(minCol, maxCol)),
    width,
    height,
  };
}

export function modalMoveThreshold(): number {
  return MODAL_MOVE_THRESHOLD;
}
