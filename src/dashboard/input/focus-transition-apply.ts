import type { PaneFocus } from '../../workspace-types.js';
import type {
  DashboardInputEntryMode,
  FocusToInputTransition,
  FocusToPaneTransition,
  InputExitRestoreTransition,
} from './focus-transition.js';

export interface DashboardFocusTransitionApplyHost {
  setWorkingFocus(next: PaneFocus, reason: string): void;
  setLastWorkingDirPane(next: PaneFocus | null): void;
  setPendingInputEntryMode(next: DashboardInputEntryMode | null): void;
}

export function applyFocusToInputTransition(
  host: DashboardFocusTransitionApplyHost,
  transition: FocusToInputTransition,
): void {
  host.setLastWorkingDirPane(transition.nextLastWorkingDirPane);
  host.setPendingInputEntryMode(transition.nextPendingInputEntryMode);
  host.setWorkingFocus(transition.nextFocus, transition.reason);
}

export function applyInputExitRestoreTransition(
  host: DashboardFocusTransitionApplyHost,
  transition: InputExitRestoreTransition,
): void {
  host.setWorkingFocus(transition.nextFocus, transition.reason);
  host.setLastWorkingDirPane(null);
}

export function applyFocusToPaneTransition(
  host: DashboardFocusTransitionApplyHost,
  transition: FocusToPaneTransition,
): void {
  host.setWorkingFocus(transition.nextFocus, transition.reason);
  host.setLastWorkingDirPane(transition.nextLastWorkingDirPane);
}
