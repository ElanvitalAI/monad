import type { PaneFocus } from '../workspace-types.js';
import { resolveInputExitRestoreTransition } from './input/focus-transition.js';
import type { InputOwner } from './input/input-owner.js';

export interface DashboardInputLoopExitCleanupDeps {
  clearPromptRepaint: () => void;
  detachInsertAtCursor: () => void;
  /** 2026-04-30 — detach the textInput auto-submit hook
   *  (`promptCtl.submit`) so a stale callback can't inject Enter into
   *  a torn-down textInput closure. Voice multi-turn's auto-Enter
   *  uses this hook to simulate a user-typed Enter. */
  detachSubmit?: () => void;
  clearDisplayCursor: () => void;
  markInputExited: () => void;
}

export interface DashboardInputExitRestoreDeps {
  inputOwner: InputOwner;
  pluginActive: boolean;
  autoInputArmed: boolean;
  inputExited: boolean;
  lastWorkingDirPane: PaneFocus | null;
  fallbackPane: PaneFocus;
  applyTransition: (nextFocus: PaneFocus, reason: string) => void;
  clearLastWorkingDirPane: () => void;
}

export function cleanupDashboardInputLoopExit(
  deps: DashboardInputLoopExitCleanupDeps,
): void {
  deps.clearPromptRepaint();
  deps.detachInsertAtCursor();
  deps.detachSubmit?.();
  deps.clearDisplayCursor();
  deps.markInputExited();
}

export function restoreDashboardInputExit(
  deps: DashboardInputExitRestoreDeps,
): boolean {
  const transition = resolveInputExitRestoreTransition({
    inputOwner: deps.inputOwner,
    pluginActive: deps.pluginActive,
    autoInputArmed: deps.autoInputArmed,
    inputExited: deps.inputExited,
    lastWorkingDirPane: deps.lastWorkingDirPane,
    fallbackPane: deps.fallbackPane,
  });
  if (!transition) return false;
  deps.applyTransition(transition.nextFocus, transition.reason);
  deps.clearLastWorkingDirPane();
  return true;
}
