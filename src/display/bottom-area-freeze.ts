import type { PromptFrame } from './prompt-frame.js';
import { debug } from '../debug/log.js';
import {
  type ModalSurface,
} from './modal-stack.js';
import {
  isBlockingModalInteractionSurface,
  isEmbeddedOverlayInteractionSurface,
} from './surface-interaction-policy.js';

function modalBoundsForBottomAreaFreeze(surface: ModalSurface) {
  return surface.visualBounds ?? surface.interactiveBounds ?? surface.bounds;
}

function modalTierFreezesBottomArea(surface: ModalSurface): boolean {
  return surface.tier === 'popup'
    || surface.tier === 'menu';
}

export function shouldFreezeDashboardBottomArea(
  surface: ModalSurface | null | undefined,
  promptFrame: PromptFrame,
  termRows: number,
): boolean {
  if (!surface) return false;
  if (surface.freezeBottomArea === false) return false;
  if (!modalTierFreezesBottomArea(surface)) return false;
  if (isBlockingModalInteractionSurface(surface)) return false;
  if (isEmbeddedOverlayInteractionSurface(surface)) return false;
  const bounds = modalBoundsForBottomAreaFreeze(surface);
  const bandTop = Math.max(1, promptFrame.topDividerRow);
  const bandBottom = Math.max(bandTop, termRows);
  const modalBottom = bounds.row + bounds.height - 1;
  const freeze = modalBottom >= bandTop && bounds.row <= bandBottom;
  if (debug.enabled) {
    debug.log('dashboard.bottom-area-freeze', 'evaluate', {
      surfaceId: surface.id,
      tier: surface.tier ?? null,
      interactionClass: surface.interactionClass ?? null,
      row: bounds.row,
      height: bounds.height,
      modalBottom,
      bandTop,
      bandBottom,
      freeze,
    });
  }
  return freeze;
}
