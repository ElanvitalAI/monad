import type { Key } from '../../tui.js';

export const DASHBOARD_CURSOR_SCROLL_KEYS = new Set([
  'j', 'k', 'down', 'up', 'g', 'G', 'home', 'end',
]);

export function isDashboardCursorScrollKey(key: Key): boolean {
  return DASHBOARD_CURSOR_SCROLL_KEYS.has(key.name);
}

export interface RunWidgetCursorBridgeDeps<TState> {
  itemCount: number;
  currentCursor: number;
  widgetState: TState | null;
  setWidgetCursor: (state: TState, cursor: number) => void;
  getWidgetCursor: (state: TState) => number;
  dispatchKey: () => void;
  applyNextCursor: (nextCursor: number) => void;
  debugLog?: (phase: 'pre' | 'post', payload: Record<string, unknown>) => void;
}

export function runWidgetCursorBridge<TState>(
  key: Key,
  deps: RunWidgetCursorBridgeDeps<TState>,
): boolean {
  if (!isDashboardCursorScrollKey(key)) return false;
  if (deps.itemCount > 0 && deps.widgetState) {
    const boundedCurrent = Math.max(0, Math.min(deps.currentCursor, deps.itemCount - 1));
    deps.setWidgetCursor(deps.widgetState, boundedCurrent);
    deps.debugLog?.('pre', {
      key: key.name || '(empty)',
      cursor: deps.currentCursor,
      itemCount: deps.itemCount,
    });
    deps.dispatchKey();
    const nextCursor = Math.max(
      0,
      Math.min(deps.getWidgetCursor(deps.widgetState), deps.itemCount - 1),
    );
    deps.applyNextCursor(nextCursor);
    deps.debugLog?.('post', {
      key: key.name || '(empty)',
      cursor: nextCursor,
      itemCount: deps.itemCount,
    });
  }
  return true;
}
