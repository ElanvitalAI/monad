import type { SurfaceId } from '../display/types.js';
import type { HitTarget } from '../display/types.js';
import { surfaceKey, type SurfaceAddress, type SurfaceKind } from './address.js';

// R5.1 canonical-vs-legacy split:
// - `surfaceIdFromHit()` returns only canonical `surfaceKey(addr)` ids
//   for hits that already map to a reversible `SurfaceAddress`
// - `legacySurfaceIdAliasesFromHit()` carries migration-only ids such
//   as bare pane ids that older drag/menu consumers still register
//   against today
//
// Keep the two spaces separate so future R5 work can tighten the
// canonical contract without losing compatibility at the call sites
// that still speak older ids.

/** Canonical HitKey for menus / hit-addressed lookup.
 *
 *  VW pane keys include `windowId` so multiple windows can expose the
 *  same paneId without colliding. `legacyHitKeyAliasesFromHit()` keeps
 *  the older paneId-only shape readable during migration. */
export function hitKeyFromHit(hit: HitTarget): string {
  switch (hit.kind) {
    case 'pill':           return `pill:${hit.name}`;
    case 'pane-nav-tab':   return `pane-nav-tab:${hit.paneId}`;
    case 'pane-title':     return `pane-title:${hit.paneId}`;
    case 'pane-body':      return `pane-body:${hit.paneId}`;
    case 'modal-body':     return `modal-body:${String(hit.modalId)}`;
    case 'modal-title':    return `modal-title:${String(hit.modalId)}`;
    case 'modal-button':   return `modal-button:${hit.buttonId}`;
    case 'vw-pane-title':  return `vw-pane-title:${hit.windowId}:${hit.paneId}`;
    case 'vw-pane-body':   return `vw-pane-body:${hit.windowId}:${hit.paneId}`;
    case 'input':          return `input:${hit.inputId}`;
    case 'status-bar':     return 'status-bar';
    default:               return `unknown:${String((hit as { kind?: unknown }).kind ?? 'none')}`;
  }
}

/** Temporary compatibility aliases for pre-R8g key shapes. */
export function legacyHitKeyAliasesFromHit(hit: HitTarget): readonly string[] {
  switch (hit.kind) {
    case 'vw-pane-title':
      return [`vw-pane-title:${hit.paneId}`];
    case 'vw-pane-body':
      return [`vw-pane-body:${hit.paneId}`];
    default:
      return [];
  }
}

export function wildcardHitKeyFromHit(hit: HitTarget): string | null {
  switch (hit.kind) {
    case 'pill':           return 'pill:*';
    case 'pane-nav-tab':   return 'pane-nav-tab:*';
    case 'pane-title':     return 'pane-title:*';
    case 'pane-body':      return 'pane-body:*';
    case 'modal-body':     return 'modal-body:*';
    case 'modal-title':    return 'modal-title:*';
    case 'modal-button':   return 'modal-button:*';
    case 'vw-pane-title':  return 'vw-pane-title:*';
    case 'vw-pane-body':   return 'vw-pane-body:*';
    case 'input':          return 'input:*';
    case 'status-bar':     return null;
    default:               return null;
  }
}

/** Canonical surface-id projection for hits that already have a
 *  reversible `SurfaceAddress`. Returns null for kinds whose runtime
 *  substrate still only has ad-hoc or ambiguous ids (pane / VW pane /
 *  pill / status-bar). */
export function surfaceIdFromHit(hit: HitTarget): SurfaceId | null {
  const addr = surfaceAddressFromHit(hit);
  return addr ? surfaceKey(addr) as SurfaceId : null;
}

/** Temporary compatibility aliases for older consumers that still key
 *  targets by bare pane ids rather than canonical `surfaceKey(addr)`.
 *  Keep this helper small and explicit: it exists to support the
 *  migration, not to define new canonical ids. */
export function legacySurfaceIdAliasesFromHit(hit: HitTarget): readonly SurfaceId[] {
  switch (hit.kind) {
    case 'pane-nav-tab':
    case 'pane-title':
    case 'pane-body':
      return [hit.paneId as SurfaceId];
    case 'vw-pane-title':
    case 'vw-pane-body':
      return [hit.paneId as SurfaceId];
    case 'pill':
    case 'status-bar':
    case 'input':
    case 'modal-body':
    case 'modal-title':
    case 'modal-button':
      return [];
    default:
      return [];
  }
}

/** Partial inverse over the canonical `surfaceKey(addr)` space. */
export function surfaceAddressFromSurfaceId(surfaceId: SurfaceId): SurfaceAddress | null {
  const raw = String(surfaceId);
  if (raw.startsWith('input::')) {
    return { kind: 'input', inputId: raw.slice('input::'.length) };
  }
  if (raw.startsWith('modal::')) {
    return { kind: 'modal', modalId: raw.slice('modal::'.length) };
  }
  return null;
}

/** Partial inverse over the canonical `surfaceKey(addr)` space.
 *  Ambiguous pane/title/body ids intentionally return null. */
export function hitFromSurfaceId(surfaceId: SurfaceId): HitTarget | null {
  const addr = surfaceAddressFromSurfaceId(surfaceId);
  if (!addr) return null;
  switch (addr.kind) {
    case 'input':
      return { kind: 'input', inputId: addr.inputId };
    case 'modal':
      return { kind: 'modal-body', modalId: addr.modalId as SurfaceId };
    default:
      return null;
  }
}

/** Shared surface-match rule for drag / future hit-addressed consumers. */
export function hitMatchesSurfaceId(hit: HitTarget, surfaceId: SurfaceId): boolean {
  const projected = surfaceIdFromHit(hit);
  const aliases = legacySurfaceIdAliasesFromHit(hit);
  if (projected === surfaceId) return true;
  for (const alias of aliases) {
    if (alias === surfaceId) return true;
  }
  if (aliases.length > 0) return false;
  if (projected === null) return true;

  // Backward-compat for pre-canonical input consumers. For input only,
  // non-`input::` ids keep the old permissive behavior so legacy
  // targets continue to work during migration.
  switch (hit.kind) {
    case 'input':
      return !surfaceId.startsWith('input::');
    default:
      return false;
  }
}

export function surfaceAddressFromHit(hit: HitTarget): SurfaceAddress | null {
  switch (hit.kind) {
    case 'vw-pane-title':
    case 'vw-pane-body':
      return {
        kind: 'pane',
        ref: { windowId: hit.windowId, paneId: hit.paneId },
      };
    case 'input':
      return { kind: 'input', inputId: hit.inputId };
    case 'modal-body':
    case 'modal-title':
    case 'modal-button':
      return { kind: 'modal', modalId: String(hit.modalId) };
    default:
      return null;
  }
}

type SurfaceKindProjectableHit =
  | { kind: 'vw-pane-title'; windowId: string | number; paneId: string }
  | { kind: 'vw-pane-body'; windowId: string | number; paneId: string }
  | { kind: 'input'; inputId: string }
  | { kind: 'modal-body'; modalId: string }
  | { kind: 'modal-title'; modalId: string }
  | { kind: 'modal-button'; modalId: string; buttonId: string }
  | { kind: string };

/** Partial projection from a hit to the canonical `SurfaceAddress.kind`
 *  vocabulary used by R5. This is intentionally broader than
 *  `surfaceAddressFromHit()`:
 *  - VW pane hits are pane-family even if the full address is only
 *    partially reconstructible
 *  - local pane hits remain ambiguous because they do not carry the
 *    full pane address today
 *  - pills / status-bar are UI affordances, not addressable surfaces */
export function surfaceKindFromHit(hit: SurfaceKindProjectableHit): SurfaceKind | null {
  switch (hit.kind) {
    case 'vw-pane-title':
    case 'vw-pane-body':
      return 'pane';
    case 'input':
      return 'input';
    case 'modal-body':
    case 'modal-title':
    case 'modal-button':
      return 'modal';
    default:
      return null;
  }
}
