import type { PaneFocus } from '../../workspace-types.js';
import type { DashboardInputEntryMode } from './focus-transition.js';
import type { DashboardFocusTransitionApplyHost } from './focus-transition-apply.js';

export interface DashboardFocusTransitionState {
  getLastWorkingDirPane(): PaneFocus | null;
  setLastWorkingDirPane(next: PaneFocus | null): void;
  getPendingInputEntryMode(): DashboardInputEntryMode | null;
  setPendingInputEntryMode(next: DashboardInputEntryMode | null): void;
  consumePendingInputEntryMode(): DashboardInputEntryMode | null;
  applyHost(setWorkingFocus: (next: PaneFocus, reason: string) => void): DashboardFocusTransitionApplyHost;
}

export function createDashboardFocusTransitionState(): DashboardFocusTransitionState {
  let lastWorkingDirPane: PaneFocus | null = null;
  let pendingInputEntryMode: DashboardInputEntryMode | null = null;

  return {
    getLastWorkingDirPane: () => lastWorkingDirPane,
    setLastWorkingDirPane: (next) => { lastWorkingDirPane = next; },
    getPendingInputEntryMode: () => pendingInputEntryMode,
    setPendingInputEntryMode: (next) => { pendingInputEntryMode = next; },
    consumePendingInputEntryMode: () => {
      const next = pendingInputEntryMode;
      pendingInputEntryMode = null;
      return next;
    },
    applyHost: (setWorkingFocus) => ({
      setWorkingFocus,
      setLastWorkingDirPane: (next) => { lastWorkingDirPane = next; },
      setPendingInputEntryMode: (next) => { pendingInputEntryMode = next; },
    }),
  };
}
