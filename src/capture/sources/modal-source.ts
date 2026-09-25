// ── Capture Phase C·a (Bundle 6T) — modal source resolver ──
//
// Bridge between `ModalIdentityRegistry` (Bundle 1 Phase M) + a
// DisplayCoordinator-supplied surface lookup → the capture engine's
// `source: () => string` contract.
//
// Why DI for surface lookup: DisplayCoordinator instances are local
// to dashboard.ts (no global singleton) and the `surfaces: Map<…>`
// field is private. Rather than promote it to global, this module
// accepts a `DisplaySurfaceResolver` that returns a ModalSurface-like
// object given a surfaceId. Dashboard wires a closure over the live
// coordinator at boot.
//
// READ-ONLY contract: we only call `surface.paint()` — never mutate
// coordinator state.
//
// Engine stays substrate-unaware (engine.ts unchanged in this bundle);
// callers compose:
//     const ansi = resolveModalAnsi({ modalId, surfaceResolver, identity });
//     capture({ target: {kind:'modal', modalId}, format: 'png',
//               source: () => ansi });

import { getModalIdentityRegistry, type ModalIdentity, type ModalIdentityRegistry } from '../../display/modal-identity.js';
import { debug } from '../../debug/log.js';

/** Minimal surface shape we consume. Declared here (not imported from
 *  modal-stack.ts) so the module's read-only contract is self-contained
 *  and resistant to coordinator refactors. */
export interface PaintableModalSurface {
  paint(): string;
  tier?: string;
}

export interface DisplaySurfaceResolver {
  getSurface(surfaceId: string): PaintableModalSurface | undefined;
}

export interface ModalSourceOpts {
  readonly modalId: string;
  readonly identity?: ModalIdentityRegistry;
  readonly surfaceResolver?: DisplaySurfaceResolver;
}

export class ModalSourceNotFoundError extends Error {
  constructor(public readonly modalId: string) {
    super(`modal identity not found: ${modalId}`);
    this.name = 'ModalSourceNotFoundError';
  }
}

/** Resolve ANSI for a modal. Returns empty string when the identity is
 *  known but no paintable surface is currently mounted (modal just
 *  popped · coordinator hasn't flushed yet). Throws when the modalId
 *  is entirely unknown — callers can map that to a "modal not found"
 *  LLM response. */
export function resolveModalAnsi(opts: ModalSourceOpts): string {
  const identity = (opts.identity ?? getModalIdentityRegistry()).get(opts.modalId);
  if (!identity) throw new ModalSourceNotFoundError(opts.modalId);
  if (!identity.surfaceId) return '';
  const resolver = opts.surfaceResolver;
  if (!resolver) return '';
  const surface = resolver.getSurface(identity.surfaceId);
  if (!surface) return '';
  try {
    return surface.paint();
  } catch (err) {
    if (debug.enabled) {
      debug.log('capture.modal-source.paint.error', opts.modalId, {
        err: (err as Error)?.message ?? String(err),
      }, { level: 'error' });
    }
    return '';
  }
}

/** Async source closure matching CaptureRequest.source shape. */
export function createModalSource(opts: ModalSourceOpts): () => string {
  return () => resolveModalAnsi(opts);
}

export interface ModalDescription {
  readonly modalId: string;
  readonly kind: string;
  readonly createdAt: number;
  readonly surfaceId?: string;
  readonly promoteChainDepth: number;
  readonly promotedFromId?: string;
}

/** Lightweight describe — no coordinator call · pure identity read. */
export function describeModal(opts: ModalSourceOpts): ModalDescription | undefined {
  const identity = (opts.identity ?? getModalIdentityRegistry()).get(opts.modalId);
  if (!identity) return undefined;
  return {
    modalId: identity.modalId,
    kind: identity.kind,
    createdAt: identity.createdAt,
    promoteChainDepth: countPromoteChain(identity),
    ...(identity.surfaceId !== undefined ? { surfaceId: identity.surfaceId } : {}),
    ...(identity.promotedFrom !== undefined ? { promotedFromId: identity.promotedFrom.modalId } : {}),
  };
}

function countPromoteChain(id: ModalIdentity): number {
  let n = 0;
  let cur = id.promotedFrom;
  while (cur) { n++; cur = cur.promotedFrom; }
  return n;
}
