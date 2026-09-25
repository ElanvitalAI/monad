import type { PaneFocus } from '../../workspace-types.js';
import type { InputOwner } from './input-owner.js';

export type DashboardInputEntryMode = 'plain' | 'slash';

export interface FocusToInputTransition {
  nextFocus: 'input';
  nextPendingInputEntryMode: DashboardInputEntryMode | null;
  nextLastWorkingDirPane: PaneFocus | null;
  reason: string;
}

export interface InputExitRestoreTransition {
  nextFocus: PaneFocus;
  reason: 'input-exit-restore-pane';
}

export interface FocusToPaneTransition {
  nextFocus: PaneFocus;
  nextLastWorkingDirPane: PaneFocus | null;
  reason: string;
}

/** Dashboard first-entry contract: the chat input owns focus on boot.
 *  Higher-level flows may move focus later, but a plain launch should
 *  always accept typing immediately. */
export function resolveDashboardInitialWorkingFocus(): PaneFocus {
  return 'input';
}

/** General focus→input transition. Some routes want the input but do
 *  not want to overwrite pane-restore memory; others explicitly enter
 *  from a pane and should remember that origin. */
export function resolveFocusToInputTransition(opts?: {
  sourcePane?: PaneFocus | null;
  rememberPane?: boolean;
  mode?: DashboardInputEntryMode;
  reason?: string;
}): FocusToInputTransition {
  return {
    nextFocus: 'input',
    nextPendingInputEntryMode: opts?.mode ?? null,
    nextLastWorkingDirPane: opts?.rememberPane === false
      ? null
      : (opts?.sourcePane ?? null),
    reason: opts?.reason ?? 'focus-to-input',
  };
}

/** Pane-scoped input entry uses a single transition contract so the
 *  dashboard can centralize "remember last pane + optional entry mode"
 *  without duplicating it across key routes. */
export function resolvePaneEnterInputTransition(
  pane: PaneFocus,
  opts?: { mode?: DashboardInputEntryMode; reason?: string },
): FocusToInputTransition {
  return resolveFocusToInputTransition({
    sourcePane: pane,
    rememberPane: true,
    mode: opts?.mode,
    reason: opts?.reason ?? 'pane-enter-input',
  });
}

/** General focus→pane transition. Used for pane-directed shortcuts
 *  that want to keep the "return target" memory coherent without
 *  open-coding `lastWorkingDirPane` mutations at each call site. */
export function resolveFocusToPaneTransition(opts: {
  targetPane: PaneFocus;
  rememberPane?: boolean;
  reason?: string;
}): FocusToPaneTransition {
  return {
    nextFocus: opts.targetPane,
    nextLastWorkingDirPane: opts.rememberPane === false ? null : opts.targetPane,
    reason: opts.reason ?? 'focus-to-pane',
  };
}

/** Input exit restore only fires when the chat-main input really owned
 *  the foreground and the current loop iteration just consumed an
 *  auto-enter or exited the prompt. Returning null keeps focus where it
 *  is (plugin/modal/overlay still owns the input path, etc.). */
export function resolveInputExitRestoreTransition(opts: {
  inputOwner: InputOwner;
  pluginActive: boolean;
  autoInputArmed: boolean;
  inputExited: boolean;
  lastWorkingDirPane: PaneFocus | null;
  fallbackPane: PaneFocus;
}): InputExitRestoreTransition | null {
  if (opts.inputOwner !== 'chat-main') return null;
  if (opts.pluginActive) return null;
  if (!opts.autoInputArmed && !opts.inputExited) return null;
  return {
    nextFocus: opts.lastWorkingDirPane ?? opts.fallbackPane,
    reason: 'input-exit-restore-pane',
  };
}
