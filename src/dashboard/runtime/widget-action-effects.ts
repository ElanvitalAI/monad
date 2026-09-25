import type { Action, PaneSlot } from '../../plugins/core/types.js';
import { runDashboardAction } from './action-effects.js';

export interface RunDashboardWidgetActionDeps {
  requestRender: (pane?: PaneSlot) => void;
  setWorkingFocus: (pane: 'browser' | 'preview' | 'log', reason: string) => void;
  deactivatePlugin: () => Promise<void>;
  refreshViewsAfterDeactivate?: () => void;
  submitText: (text: string) => void;
  focusReason: string;
  handleScopedSubmitText?: (text: string) => boolean;
}

export async function runDashboardWidgetAction(
  action: Action | null | undefined,
  deps: RunDashboardWidgetActionDeps,
): Promise<boolean> {
  if (!action || action.type === 'none') return false;
  if (action.type === 'submit') {
    if (deps.handleScopedSubmitText?.(action.text)) return true;
    deps.submitText(action.text);
    return true;
  }
  await runDashboardAction(action, {
    requestRender: deps.requestRender,
    setWorkingFocus: deps.setWorkingFocus,
    deactivatePlugin: deps.deactivatePlugin,
    refreshViewsAfterDeactivate: deps.refreshViewsAfterDeactivate,
    submitText: deps.submitText,
    focusReason: deps.focusReason,
  });
  return true;
}
