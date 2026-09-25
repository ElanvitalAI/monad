import type { InputResult } from '../../chat/index.js';

export type DashboardChatMainLoopControl =
  | { kind: 'view-switch'; viewSwitch: string }
  | { kind: 'goto-pane' }
  | { kind: 'cancel-session-control' }
  | { kind: 'continue-chat-only' }
  | { kind: 'exit-input' }
  | { kind: 'submit' };

export function resolveDashboardChatMainLoopControl(
  input: InputResult,
  {
    isChatOnlyMode,
    hasActiveSessionControl,
  }: {
    isChatOnlyMode: boolean;
    hasActiveSessionControl: boolean;
  },
): DashboardChatMainLoopControl {
  if (input.viewSwitch) {
    return { kind: 'view-switch', viewSwitch: input.viewSwitch };
  }
  if (input.gotoPane) {
    return { kind: 'goto-pane' };
  }
  if (!input.submitted || !input.text) {
    if (input.cancelledBy === 'escape' && hasActiveSessionControl) {
      return { kind: 'cancel-session-control' };
    }
    if (isChatOnlyMode) {
      return { kind: 'continue-chat-only' };
    }
    return { kind: 'exit-input' };
  }
  return { kind: 'submit' };
}
