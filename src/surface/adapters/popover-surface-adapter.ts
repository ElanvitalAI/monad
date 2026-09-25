// ── IUL Phase S·b — popover-surface adapter ──
//
// Bridges popover lifecycle into `SurfaceRegistry`.
//
// Background: popovers are pushed onto DisplayCoordinator via
// `pushModal(handle.surface)` in `dashboard-mouse-wiring.ts`, which
// means the existing modal-identity wiring (Bundle 1+2 Phase M + S·a)
// already captures them as `{kind:'modal'}`. This adapter offers the
// **semantic refinement** path: callers that know a surface is a
// popover (anchor-bound, transient, dismissable on outside click)
// register it as `{kind:'popover'}` so the LLM's GetUIState /
// DescribeSurface can distinguish "this is a tooltip" from "this is
// a confirm dialog".
//
// `dashboard-mouse-wiring.ts` lives in the shared zone (PLAN-iul-
// closure-roadmap §0.5 — neither team explicit owns; treat like
// dashboard.ts with 1-import-1-call discipline). For Bundle 4T this
// adapter ships the API only; wiring lands in a future PR after
// dashboard-mouse-wiring centralizes activePopup state.

import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';

export interface PopoverRegisterOpts {
  readonly registry?: SurfaceRegistry;
  readonly popoverId: string;
  readonly kindTag?: string;        // 'pill-popup' / 'tooltip' / 'menu' …
  readonly anchorId?: string;       // owning surface (modal id / pane id) — informational
  readonly tier?: string;           // defaults to 'popup'
  readonly title?: string;
  readonly visible?: boolean;
  readonly zHint?: number;
}

export function registerPopoverSurface(opts: PopoverRegisterOpts): void {
  const registry = opts.registry ?? getSurfaceRegistry();
  registry.register({
    addr: { kind: 'popover', popoverId: opts.popoverId },
    kindTag: opts.kindTag ?? 'popover',
    surfaceId: opts.popoverId,
    tier: opts.tier ?? 'popup',
    visible: opts.visible ?? true,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.zHint !== undefined ? { zHint: opts.zHint } : {}),
    ...(opts.anchorId !== undefined ? { stateHash: `anchor:${opts.anchorId}` } : {}),
  });
}

export function unregisterPopoverSurface(
  popoverId: string,
  registry?: SurfaceRegistry,
): boolean {
  const r = registry ?? getSurfaceRegistry();
  return r.unregister({ kind: 'popover', popoverId });
}

/** Convenience: pair a popover with a synthesized id derived from the
 *  anchor so callers without a stable popover id (e.g. mouse-wiring
 *  closure-local `activePopup`) can still register. Caller passes the
 *  same anchorId on register and unregister. */
export function popoverIdFromAnchor(anchorId: string): string {
  return `popover-of-${anchorId}`;
}
