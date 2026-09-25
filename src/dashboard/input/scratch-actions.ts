import type { Key } from '../../tui.js';

export interface ScratchListNavigationResult {
  handled: boolean;
  cursor: number;
}

export function runScratchListNavigation(
  key: Key,
  cursor: number,
  length: number,
): ScratchListNavigationResult {
  if (length <= 0) {
    if (key.name === 'g' || key.name === 'home') {
      return { handled: true, cursor: 0 };
    }
    return { handled: false, cursor };
  }

  switch (key.name) {
    case 'j':
    case 'down':
      return { handled: true, cursor: Math.min(cursor + 1, length - 1) };
    case 'k':
    case 'up':
      return { handled: true, cursor: Math.max(0, cursor - 1) };
    case 'g':
    case 'home':
      return { handled: true, cursor: 0 };
    case 'G':
    case 'end':
      return { handled: true, cursor: length - 1 };
    default:
      return { handled: false, cursor };
  }
}
