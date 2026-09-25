import type { PaneClickOutcome } from '../../display/pane-click-dispatch.js';
import {
  isPrimaryDiscreteClickMouseEventType,
  type DisplayMouseEvent,
} from '../../display/types.js';
import type { PaneFocus } from '../../workspace-types.js';

export interface DashboardMouseSurfaceActionPlan {
  result: 'consumed' | 'passthrough';
  focusPane?: PaneFocus;
  submitText?: string;
}

export function resolvePaneNavMouseActionPlan(
  mouse: DisplayMouseEvent,
  deps: {
    paneNavRow: number | null;
    paneAtColumn: (col0: number) => PaneFocus | null;
  },
): DashboardMouseSurfaceActionPlan {
  if (mouse.type !== 'click') return { result: 'passthrough' };
  if (deps.paneNavRow === null || mouse.row !== deps.paneNavRow) {
    return { result: 'passthrough' };
  }
  const pane = deps.paneAtColumn(mouse.col - 1);
  if (pane === null) return { result: 'passthrough' };
  return { result: 'consumed', focusPane: pane };
}

export function resolvePaneBodyMouseActionPlan(
  mouse: DisplayMouseEvent,
  outcome: PaneClickOutcome,
  deps: {
    allowFocusSteal: boolean;
    currentFocus: PaneFocus | null;
  },
): DashboardMouseSurfaceActionPlan {
  if (outcome.kind === 'no-hit') return { result: 'passthrough' };

  const isLogWidget =
    outcome.widgetInstanceId === 'wd-log'
    || outcome.widgetInstanceId === 'wd-debug-log';

  if ((mouse.type === 'scroll-up' || mouse.type === 'scroll-down') && isLogWidget) {
    return { result: 'passthrough' };
  }

  const focusPane =
    deps.allowFocusSteal
    && outcome.focusPane
    && outcome.focusPane !== deps.currentFocus
      ? outcome.focusPane as PaneFocus
      : undefined;

  if (outcome.kind === 'widget-handled') {
    return {
      result: 'consumed',
      ...(focusPane ? { focusPane } : {}),
      ...(outcome.submitText ? { submitText: outcome.submitText } : {}),
    };
  }

  if (isPrimaryDiscreteClickMouseEventType(mouse.type)) {
    return {
      result: 'consumed',
      ...(focusPane ? { focusPane } : {}),
    };
  }

  return { result: 'passthrough' };
}

export function resolveLogZoneMouseActionPlan(
  mouse: DisplayMouseEvent,
  outcome: 'consumed' | 'passthrough' | 'out-of-zone',
  deps: {
    allowFocusSteal: boolean;
    currentFocus: PaneFocus | null;
    focusOnConsume?: boolean;
  },
): DashboardMouseSurfaceActionPlan {
  if (outcome !== 'consumed') return { result: 'passthrough' };
  const shouldFocusLog =
    deps.focusOnConsume !== false
    && deps.allowFocusSteal
    && deps.currentFocus !== 'log';
  return {
    result: 'consumed',
    ...(shouldFocusLog ? { focusPane: 'log' } : {}),
  };
}

export function runDashboardMouseSurfaceActionPlan(
  plan: DashboardMouseSurfaceActionPlan,
  deps: {
    setWorkingFocus: (pane: PaneFocus, reason: string) => void;
    focusReason: string;
    dispatchSubmitText: (text: string) => void;
  },
): 'consumed' | 'passthrough' {
  if (plan.focusPane) {
    deps.setWorkingFocus(plan.focusPane, deps.focusReason);
  }
  if (plan.submitText) {
    deps.dispatchSubmitText(plan.submitText);
  }
  return plan.result;
}
