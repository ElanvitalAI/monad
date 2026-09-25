// ── IUL Phase S·a — modal-surface adapter ──
//
// Bridges `ModalIdentityRegistry` lifecycle into `SurfaceRegistry`.
// The first concrete consumer of Phase M's onPush/onPop subscriptions:
//   - onPush  → SurfaceRegistry.register({kind:'modal', modalId})
//   - onPop   → SurfaceRegistry.unregister
//
// Adapter does not allocate or release identities itself — the
// `composeIdentityHooks` wiring (also Phase M) handles that. Composing
// both gives DisplayCoordinator → ModalIdentityRegistry → SurfaceRegistry
// auto-flow with zero pushModal callsite changes.

import type { SurfaceRegistry } from '../registry.js';
import type { ModalIdentityRegistry } from '../../display/modal-identity.js';
import { getModalIdentityRegistry } from '../../display/modal-identity.js';
import { getSurfaceRegistry } from '../registry.js';
import { defaultZTierForKind } from '../z-tier.js';

export interface ModalSurfaceAdapterOpts {
  readonly registry?: SurfaceRegistry;
  readonly identity?: ModalIdentityRegistry;
  /** Override the title derivation; default uses identity.kind. */
  readonly titleOf?: (identity: { kind: string; modalId: string; surfaceId?: string }) => string;
}

export interface ModalSurfaceAdapterHandle {
  /** Detach from the identity registry. SurfaceRegistry entries
   *  registered before disposal are NOT removed; caller is
   *  responsible for cleanup if needed. */
  dispose(): void;
}

export function wireModalSurfaceAdapter(
  opts: ModalSurfaceAdapterOpts = {},
): ModalSurfaceAdapterHandle {
  const registry = opts.registry ?? getSurfaceRegistry();
  const identity = opts.identity ?? getModalIdentityRegistry();
  const titleOf = opts.titleOf ?? defaultTitleOf;

  const offPush = identity.onPush(event => {
    registry.register({
      addr: { kind: 'modal', modalId: event.identity.modalId },
      kindTag: event.identity.kind,
      surfaceId: event.surfaceId,
      // Phase Z (Bundle 5T): when source surface carried no tier,
      // fall back to the kind's default ZTier band so the entry is
      // immediately sortable by listVisibleZOrdered() without relying
      // on the registry's median-fallback.
      tier: event.tier ?? defaultZTierForKind('modal'),
      title: titleOf(event.identity),
      visible: true,
    });
  });

  const offPop = identity.onPop(event => {
    registry.unregister({ kind: 'modal', modalId: event.identity.modalId });
  });

  return {
    dispose() {
      offPush();
      offPop();
    },
  };
}

function defaultTitleOf(id: { kind: string; modalId: string }): string {
  return id.kind || 'modal';
}
