import type { Key } from '../../tui.js';
import type { DashboardFocusTransitionState } from './focus-transition-state.js';
import type { DashboardInputEntryMode } from './entry-mode.js';
import { resolveDashboardInputEntryMode } from './entry-mode.js';
import type { DashboardInputPrefixState } from './input-prefix-state.js';

export interface DashboardChatMainEntryPrelude {
  mode: DashboardInputEntryMode;
  slashQuickMode: boolean;
  initialText: string | undefined;
}

export function resolveDashboardChatMainEntryPrelude(
  key: Key,
  {
    focusTransitionState,
    inputPrefixState,
  }: {
    focusTransitionState: DashboardFocusTransitionState;
    inputPrefixState: DashboardInputPrefixState;
  },
): DashboardChatMainEntryPrelude | null {
  const mode = focusTransitionState.getPendingInputEntryMode() ?? resolveDashboardInputEntryMode(key);
  if (!mode) return null;

  const initialText = inputPrefixState.consumeInitialText(mode);
  focusTransitionState.consumePendingInputEntryMode();
  return {
    mode,
    slashQuickMode: mode === 'slash',
    initialText,
  };
}
