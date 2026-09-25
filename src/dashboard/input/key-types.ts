import type { KeyEvent } from '../../plugins/core/types.js';
import type { Key } from '../../tui.js';

export type DashboardKeyRouteResult = 'consumed' | 'passthrough';

export interface DashboardKeyHandler {
  readonly name: string;
  handle(key: Key): DashboardKeyRouteResult;
}

export function toDashboardKeyEvent(key: Key): KeyEvent {
  return {
    name: key.name,
    ctrl: !!key.ctrl,
    shift: !!key.shift,
    alt: !!key.alt,
    sequence: key.raw,
  };
}
