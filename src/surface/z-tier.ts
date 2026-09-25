// ── IUL Phase Z — ZTier unification ──
//
// Formalizes the 6-tier z-ordering that Phase L / ObserveSurface /
// Recorder timeline (Phase W) read from SurfaceRegistry. The tier tells
// "what band does this surface live in" — kind tells "what you address
// it as". The two axes are orthogonal.
//
// Relation to `src/display/types.ts::MODAL_TIER`:
//   MODAL_TIER is 8 rich labels (vw / execution / terminal / dialog /
//   popup / menu / picker / tooltip) optimized for modal-stack routing
//   decisions. ZTier is a 6-tier rollup optimized for LLM z-order
//   reasoning — we keep the rich labels in the coordinator but always
//   project them into ZTier when emitting to Layer B. Mapping is
//   deterministic and one-way (rich → rollup).
//
// The union order is the z-stack order bottom → top:
//
//   bg       — inline shell-runner pill / background status rollups
//   inline   — inline terminal panes inside chat log
//   vw       — virtual window host (pane substrate · widgets)
//   modal    — dialog / execution / terminal modal / chat-search
//   popover  — anchor-bound popover / menu / picker
//   overlay  — tooltip · top-of-everything transients
//
// When the widget team later lands WR-3 (`WidgetContext.zTier`
// pass-through), widgets can hint a tier *within* 'vw' — that's
// a widget-owned refinement, not a re-definition of these 6 bands.

export const Z_TIER = {
  bg:      'bg',
  inline:  'inline',
  vw:      'vw',
  modal:   'modal',
  popover: 'popover',
  overlay: 'overlay',
} as const;

export type ZTier = (typeof Z_TIER)[keyof typeof Z_TIER];

/** Low rank → bottom of stack, high rank → top. */
export const Z_TIER_ORDER: readonly ZTier[] = [
  'bg', 'inline', 'vw', 'modal', 'popover', 'overlay',
] as const;

export interface SurfaceKindFamilyPolicy {
  readonly kind: string;
  readonly family:
    | 'vw-host'
    | 'modal-stack'
    | 'anchor-floating'
    | 'inline-strip'
    | 'background-rollup'
    | 'window-container'
    | 'host-derived-input';
  readonly defaultTier: ZTier;
  /** True when callers should treat `defaultTier` as a fallback only
   *  and pass an explicit tier whenever the host substrate already
   *  knows more (e.g. modal/popup-hosted inputs). */
  readonly fallbackOnly?: boolean;
}

/** Canonical family policy for every current `SurfaceAddress.kind`.
 *  This is the vocabulary lock for R5.3: adding a new kind requires a
 *  code change here instead of letting ad-hoc tier assumptions spread
 *  across adapters and docs. */
export const SURFACE_KIND_FAMILY_POLICY = {
  pane:    { kind: 'pane',    family: 'vw-host',          defaultTier: 'vw' },
  widget:  { kind: 'widget',  family: 'vw-host',          defaultTier: 'vw' },
  modal:   { kind: 'modal',   family: 'modal-stack',      defaultTier: 'modal' },
  popover: { kind: 'popover', family: 'anchor-floating',  defaultTier: 'popover' },
  inline:  { kind: 'inline',  family: 'inline-strip',     defaultTier: 'inline' },
  bg:      { kind: 'bg',      family: 'background-rollup', defaultTier: 'bg' },
  window:  { kind: 'window',  family: 'window-container', defaultTier: 'vw' },
  input:   { kind: 'input',   family: 'host-derived-input', defaultTier: 'inline', fallbackOnly: true },
} as const satisfies Record<string, SurfaceKindFamilyPolicy>;

export function surfaceKindFamilyPolicy(kind: string): SurfaceKindFamilyPolicy | undefined {
  return SURFACE_KIND_FAMILY_POLICY[kind as keyof typeof SURFACE_KIND_FAMILY_POLICY];
}

export function zTierRank(tier: ZTier): number {
  return Z_TIER_ORDER.indexOf(tier);
}

export function isZTier(value: unknown): value is ZTier {
  return value === 'bg' || value === 'inline' || value === 'vw'
    || value === 'modal' || value === 'popover' || value === 'overlay';
}

/** Is mounting `next` on top of `top` legal? `next` must be equal or
 *  higher rank. `top=undefined` (empty stack) is always OK. */
export function zTiersCompatible(
  top: ZTier | undefined,
  next: ZTier,
): boolean {
  if (top === undefined) return true;
  return zTierRank(next) >= zTierRank(top);
}

/** Map DisplayCoordinator's rich `MODAL_TIER` into the 6-band rollup.
 *  Unknown values fall back to 'modal' (the median interactive band)
 *  so a new MODAL_TIER addition never silently lands at bottom. */
export function modalTierToZTier(modalTier: string | undefined): ZTier {
  switch (modalTier) {
    case 'vw':         return 'vw';
    case 'execution':  return 'modal';
    case 'terminal':   return 'modal';
    case 'dialog':     return 'modal';
    case 'popup':      return 'popover';
    case 'menu':       return 'popover';
    case 'picker':     return 'modal';
    case 'tooltip':    return 'overlay';
    default:           return 'modal';
  }
}

/** Map a `SurfaceAddress.kind` → default `ZTier` when caller didn't
 *  supply one. Adapters use this so a bare `register({addr, kindTag})`
 *  still lands in the correct band. */
export function defaultZTierForKind(kind: string): ZTier {
  return surfaceKindFamilyPolicy(kind)?.defaultTier ?? 'vw';
}

/** Coerce an arbitrary string into a ZTier via the modal-tier bridge
 *  or direct match. Useful in `update()` paths where the caller may
 *  pass a MODAL_TIER string they got from DisplayCoordinator. */
export function coerceZTier(raw: string | undefined): ZTier | undefined {
  if (raw === undefined) return undefined;
  if (isZTier(raw)) return raw;
  return modalTierToZTier(raw);
}

/** Normalize a raw tier into the effective ZTier used for ordering.
 *  Unknown or missing tiers intentionally fall into the median
 *  interactive band (`modal`) so a caller with partial metadata does
 *  not accidentally sort to the bottom. */
export function normalizeZOrderTier(raw: string | undefined): ZTier {
  return coerceZTier(raw) ?? 'modal';
}

/** Shared z-order comparison used by both SurfaceRegistry and
 *  LayerTree. Contract:
 *  1. ZTier band bottom→top
 *  2. intra-band index ascending (`zHint` / `zIndex`)
 *  3. insertion-order ascending for stable ties */
export function compareByZSemantics(
  a: { readonly tier?: string; readonly index?: number; readonly insertionOrder: number },
  b: { readonly tier?: string; readonly index?: number; readonly insertionOrder: number },
): number {
  const tierDelta = zTierRank(normalizeZOrderTier(a.tier)) - zTierRank(normalizeZOrderTier(b.tier));
  if (tierDelta !== 0) return tierDelta;
  const aIndex = a.index ?? 0;
  const bIndex = b.index ?? 0;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return a.insertionOrder - b.insertionOrder;
}
