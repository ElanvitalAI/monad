import { isModalSurface } from '../../display/modal-stack.js';
import { resolveModalInteractionClass } from '../../display/surface-interaction-policy.js';
import type { DisplaySurface, ModalTier, SurfaceId } from '../../display/types.js';

const INPUT_OVERLAY_TIERS = new Set<ModalTier>([
  'dialog',
  'popup',
  'menu',
  'picker',
]);

export interface OverlayInputStack {
  focusStack: readonly SurfaceId[];
  surfaceAt: (id: SurfaceId) => DisplaySurface | null | undefined;
}

/** Canonical dashboard overlay-input owner detection.
 *
 *  Product intent:
 *    - true popup/dialog/menu/picker text/query inputs win
 *    - workspace-class VW never counts as overlay input
 *    - embedded-overlay companions also never count
 *
 *  We still keep the tier allow-list because terminal / tooltip
 *  modals intentionally do not participate in the dashboard's
 *  overlay-input draft/cursor ownership contract.
 *
 *  Bugfix 2026-05-03 — picker-flicker RCA: only `focus === 'owns'`
 *  surfaces actually capture input. `focus === 'participates'`
 *  (chat slash/at/skill/arg pickers) means the surface receives
 *  onKey dispatch but DOES NOT own the input — chat-main is still
 *  the input owner, the picker just gets first crack via the
 *  dispatch chain. The previous `focus !== 'none'` check
 *  incorrectly classified chat pickers as overlay-input owners,
 *  which suppressed chat-main, which then triggered `clearAll()`
 *  on the picker, which then released the suppression, which
 *  re-mounted the picker — a 30 Hz mount/unmount feedback loop
 *  visible as severe flicker on `/` press. See
 *  `src/chat/index.ts` `syncActivePickerModal` for the consumer
 *  side of the contract. */
export function isOverlayInputSurface(surface: DisplaySurface | null | undefined): boolean {
  if (!surface || !isModalSurface(surface)) return false;
  if (resolveModalInteractionClass(surface) !== 'blocking-modal') return false;
  if (!INPUT_OVERLAY_TIERS.has(surface.tier ?? 'vw')) return false;
  return surface.focus === 'owns';
}

export function hasOverlayInputOwner(input: OverlayInputStack): boolean {
  for (let i = input.focusStack.length - 1; i >= 0; i--) {
    const id = input.focusStack[i]!;
    if (isOverlayInputSurface(input.surfaceAt(id))) return true;
  }
  return false;
}
