// ── IUL Phase M — modal-identity ↔ DisplayHooks wiring ──
//
// Bridges the passive `ModalIdentityRegistry` to the
// `DisplayCoordinator`'s `onSurfaceMounted` / `onSurfaceDisposed`
// hooks. Existing callers of `coord.pushModal(surface)` do not need
// to change — surfaces with `kind === 'modal'` are auto-allocated
// an identity and the registry sees push/pop events.
//
// Construction shape: `composeIdentityHooks(existingHooks?)` returns
// a `DisplayHooks` you pass to `DisplayCoordinator({ hooks })`. It
// stays back-compat with whatever hooks the dashboard already wires
// — they fire in addition.
//
// Surface→identity mapping is kept in a Map<surfaceId, ModalIdentity>
// owned by this module. Re-mounting the same surface id (close →
// re-open) allocates a *fresh* identity by design — pre/post-promote
// links are the caller's job (call `registry.promote(prev)` directly
// when you know the previous identity should chain).

import type { DisplayHooks } from './types.js';
import type { DisplaySurface } from './types.js';
import { getModalIdentityRegistry, type ModalIdentity, type ModalIdentityRegistry } from './modal-identity.js';
import { debug } from '../debug/log.js';

export interface IdentityWiringOpts {
  readonly registry?: ModalIdentityRegistry;
  /** Forwarded to `allocate({now})`. Defaults to Date.now. */
  readonly now?: () => number;
  /** Override the kind derivation. Default uses `surface.tier ?? 'unknown'`. */
  readonly kindOf?: (surface: DisplaySurface) => string;
}

export interface IdentityWiringHandle extends DisplayHooks {
  /** Lookup the identity currently associated with a mounted modal. */
  identityFor(surfaceId: string): ModalIdentity | undefined;
  /** Detach: future hook calls won't allocate or notify. The
   *  underlying registry stays intact. */
  dispose(): void;
}

export function composeIdentityHooks(
  base: DisplayHooks = {},
  opts: IdentityWiringOpts = {},
): IdentityWiringHandle {
  const registry = opts.registry ?? getModalIdentityRegistry();
  const kindOf = opts.kindOf ?? defaultKindOf;
  const surfaceToIdentity = new Map<string, ModalIdentity>();
  let active = true;

  const wired: IdentityWiringHandle = {
    identityFor(id) { return surfaceToIdentity.get(id); },
    dispose() {
      active = false;
      surfaceToIdentity.clear();
    },
    onSurfaceMounted(surface) {
      try {
        if (active && surface.kind === 'modal') {
          const existing = surfaceToIdentity.get(surface.id);
          const identity = existing ?? registry.allocate({
            kind: kindOf(surface),
            surfaceId: surface.id,
            ...(opts.now ? { now: opts.now } : {}),
          });
          if (!existing) surfaceToIdentity.set(surface.id, identity);
          registry.notifyPush(identity, surface.id, surface.tier);
        }
      } catch (err) {
        if (debug.enabled) {
          debug.log('modal.identity.wiring.mount.error', surface.id, {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
      }
      base.onSurfaceMounted?.(surface);
    },
    onSurfaceDisposed(surface) {
      try {
        if (active && surface.kind === 'modal') {
          const identity = surfaceToIdentity.get(surface.id);
          if (identity) {
            registry.notifyPop(identity, surface.id, surface.tier);
            registry.release(identity.modalId);
            surfaceToIdentity.delete(surface.id);
          }
        }
      } catch (err) {
        if (debug.enabled) {
          debug.log('modal.identity.wiring.dispose.error', surface.id, {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
      }
      base.onSurfaceDisposed?.(surface);
    },
    ...(base.beforeRender ? { beforeRender: base.beforeRender } : {}),
    ...(base.afterRender  ? { afterRender:  base.afterRender }  : {}),
    ...(base.onFocusChanged ? { onFocusChanged: base.onFocusChanged } : {}),
  };

  return wired;
}

function defaultKindOf(surface: DisplaySurface): string {
  return surface.tier ?? 'unknown';
}
