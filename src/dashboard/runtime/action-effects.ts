import type { Action, PaneSlot } from '../../plugins/core/types.js';

export type DashboardActionFocusTarget = 'browser' | 'preview' | 'log' | null;

export interface RunDashboardActionDeps {
  requestRender: (pane?: PaneSlot) => void;
  setWorkingFocus: (pane: 'browser' | 'preview' | 'log', reason: string) => void;
  deactivatePlugin: () => Promise<void>;
  refreshViewsAfterDeactivate?: () => void;
  submitText: (text: string) => void;
  focusReason: string;
}

export function resolveDashboardActionFocusTarget(
  pane: PaneSlot,
): DashboardActionFocusTarget {
  if (pane === 'log') return 'log';
  if (pane === 'preview') return 'preview';
  if (pane === 'skills' || pane === 'files') return 'browser';
  return null;
}

export async function runDashboardAction(
  action: Action,
  deps: RunDashboardActionDeps,
): Promise<void> {
  switch (action.type) {
    case 'none':
      return;
    case 'refresh':
      deps.requestRender(action.pane);
      return;
    case 'focus': {
      const target = resolveDashboardActionFocusTarget(action.pane);
      if (target) deps.setWorkingFocus(target, deps.focusReason);
      return;
    }
    case 'deactivate':
      await deps.deactivatePlugin();
      deps.refreshViewsAfterDeactivate?.();
      return;
    case 'submit':
      deps.submitText(action.text);
      return;
  }
}
