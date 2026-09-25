import type { PaneFocus } from '../workspace-types.js';

export function applyVisibleFocusRepair(
  current: PaneFocus,
  repaired: PaneFocus,
  setWorkingFocus: (next: PaneFocus, reason: string) => void,
): void {
  if (repaired !== current) {
    setWorkingFocus(repaired, 'repair-visible-focus');
  }
}
