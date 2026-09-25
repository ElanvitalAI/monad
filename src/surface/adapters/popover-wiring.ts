// ── VW-term-infra Bundle A · A2 · IUL Phase R — Popover wiring ──
//
// Thin helper used by `dashboard-mouse-wiring.ts` (and hermetic
// tests) to register a popup as `{kind:'popover'}` in the
// SurfaceRegistry alongside its existing modal-tier registration.
//
// Background: every pill popup (wd picker · mode switcher · shell
// rollup · window picker · …) is pushed onto DisplayCoordinator via
// `pushModalSurface`, which lands in SurfaceRegistry as
// `{kind:'modal'}`. That's fine for focus routing but loses the
// "this is a popover, not a dialog" distinction the LLM needs.
//
// This registrar performs a **parallel register** with
// `{kind:'popover'}` so `GetUIState({kind:'popover'})` and
// `ObserveSurface({kind:'popover', durationMs})` surface the
// transient anchored UI the user is seeing.
//
// Scope (Bundle A · A2 · "popover only"):
//   - `createPopoverRegistrar(opts)` → thin object with
//     `register(pillName, meta?): popoverId` +
//     `unregister(popoverId): boolean`
//   - Popover ids are deterministic per-anchor (`popoverIdFromAnchor`)
//     so re-open of the same anchor is idempotent
//   - Modal-tier registration path untouched — this adapter layers
//     an additional SurfaceRegistry entry beside the existing one
//
// Deferred (Bundle B):
//   - Shell-runner inline/bg bus (IUL Phase R §3.2)
//   - InspectPane → DescribeSurface legacy shim (IUL Phase R §3.3)

import {
  popoverIdFromAnchor,
  registerPopoverSurface,
  unregisterPopoverSurface,
} from './popover-surface-adapter.js';
import type { SurfaceRegistry } from '../registry.js';

export interface PopoverRegistrarOpts {
  /** Injected registry — defaults to the module-level singleton via
   *  `getSurfaceRegistry()` in the underlying adapter. Tests supply
   *  a `createSurfaceRegistry()` instance. */
  readonly registry?: SurfaceRegistry;
}

export interface PopoverRegistrar {
  /** Register a popover for a named anchor (e.g. pill name / modal id).
   *  Returns the `popoverId` the caller must pass to `unregister`.
   *  Idempotent: re-registering the same anchor unregisters the prior
   *  entry first so the new visibility/metadata wins. */
  register(
    anchorId: string,
    meta?: { readonly kindTag?: string; readonly title?: string; readonly zHint?: number },
  ): string;
  /** Unregister by popoverId. Returns true when an entry was actually
   *  removed (mirrors the underlying registry semantics). */
  unregister(popoverId: string): boolean;
  /** Enumerate currently-active popoverIds the registrar is
   *  tracking — primarily for tests + tear-down safety nets. */
  list(): readonly string[];
}

export function createPopoverRegistrar(
  opts: PopoverRegistrarOpts = {},
): PopoverRegistrar {
  const active = new Set<string>();

  return {
    register(anchorId, meta = {}) {
      const popoverId = popoverIdFromAnchor(anchorId);
      // Refresh: if the same anchor is re-opened we unregister the
      // previous entry so the registry observers see a clean
      // unregister → register sequence instead of a silent update.
      if (active.has(popoverId)) {
        unregisterPopoverSurface(popoverId, opts.registry);
        active.delete(popoverId);
      }
      registerPopoverSurface({
        popoverId,
        anchorId,
        ...(opts.registry !== undefined ? { registry: opts.registry } : {}),
        ...(meta.kindTag !== undefined ? { kindTag: meta.kindTag } : {}),
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        ...(meta.zHint !== undefined ? { zHint: meta.zHint } : {}),
      });
      active.add(popoverId);
      return popoverId;
    },
    unregister(popoverId) {
      const removed = unregisterPopoverSurface(popoverId, opts.registry);
      active.delete(popoverId);
      return removed;
    },
    list() {
      return [...active];
    },
  };
}
