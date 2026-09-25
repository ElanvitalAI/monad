import type { DisplayMouseEvent } from '../../display/types.js';
import type { KeyEvent } from '../../plugins/core/types.js';
import type { Key } from '../../tui.js';
import type { DashboardKeyRouteResult } from './key-types.js';

export type ChatMainInputForegroundAction =
  | { kind: 'interact-status-popup'; key: Key }
  | { kind: 'interact-terminal-modal'; keyEvent: KeyEvent }
  | { kind: 'interact-foreground-modal'; keyEvent: KeyEvent }
  | { kind: 'interact-input-surface'; mouse: DisplayMouseEvent };

export interface ResolveChatMainInputPreKeyActionDeps {
  hasActiveStatusPopup: boolean;
  hasTerminalModal: boolean;
  toKeyEvent: (key: Key) => KeyEvent;
}

export interface RunChatMainInputPreKeyActionDeps {
  routeStatusPopupKey: (key: Key) => DashboardKeyRouteResult;
  handleTerminalModalKey: (keyEvent: KeyEvent) => 'consumed' | 'passthrough' | 'closed';
  tryRouteForegroundModalKey: (keyEvent: KeyEvent) => Promise<DashboardKeyRouteResult>;
  redraw: () => void;
}

export interface RunChatMainInputPointerActionDeps {
  dispatchMouse: (mouse: DisplayMouseEvent) => void;
}

export function resolveChatMainInputPreKeyAction(
  key: Key,
  deps: ResolveChatMainInputPreKeyActionDeps,
): ChatMainInputForegroundAction {
  // Mouse events get a dedicated pointer dispatch immediately after
  // onPreKey. Do not claim them through the foreground-modal key route,
  // or modal-backed surfaces like VW shells never receive onMouse.
  if (key.mouse) {
    return { kind: 'interact-input-surface', mouse: key.mouse };
  }
  if (deps.hasActiveStatusPopup) {
    return { kind: 'interact-status-popup', key };
  }
  const keyEvent = deps.toKeyEvent(key);
  if (deps.hasTerminalModal) {
    return { kind: 'interact-terminal-modal', keyEvent };
  }
  return { kind: 'interact-foreground-modal', keyEvent };
}

export function resolveChatMainInputPointerAction(
  mouse: DisplayMouseEvent,
): ChatMainInputForegroundAction {
  return { kind: 'interact-input-surface', mouse };
}

export async function runChatMainInputPreKeyAction(
  action: ChatMainInputForegroundAction,
  deps: RunChatMainInputPreKeyActionDeps,
): Promise<DashboardKeyRouteResult> {
  switch (action.kind) {
    case 'interact-status-popup':
      return deps.routeStatusPopupKey(action.key);
    case 'interact-terminal-modal': {
      const result = deps.handleTerminalModalKey(action.keyEvent);
      if (result === 'closed') {
        deps.redraw();
        return 'consumed';
      }
      return result === 'consumed' ? 'consumed' : 'passthrough';
    }
    case 'interact-foreground-modal':
      return await deps.tryRouteForegroundModalKey(action.keyEvent);
    case 'interact-input-surface':
      return 'passthrough';
  }
}

export function runChatMainInputPointerAction(
  action: ChatMainInputForegroundAction,
  deps: RunChatMainInputPointerActionDeps,
): void {
  if (action.kind !== 'interact-input-surface') return;
  deps.dispatchMouse(action.mouse);
}
