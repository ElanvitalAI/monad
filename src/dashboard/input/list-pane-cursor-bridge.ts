import type { Key } from '../../tui.js';
import { runWidgetCursorBridge } from './widget-cursor-bridge.js';

export interface RunListPaneCursorBridgeDeps<TState> {
  key: Key;
  itemCount: number;
  currentCursor: number;
  widgetState: TState | null;
  setWidgetCursor: (state: TState, cursor: number) => void;
  getWidgetCursor: (state: TState) => number;
  dispatchKey: () => void;
  setCursor: (cursor: number) => void;
  resetOffsetToHome?: () => void;
  onCursorChanged?: (previousCursor: number, nextCursor: number) => void;
  debugLog?: (phase: 'pre' | 'post', payload: Record<string, unknown>) => void;
}

export function runListPaneCursorBridge<TState>(
  deps: RunListPaneCursorBridgeDeps<TState>,
): boolean {
  const previousCursor = deps.currentCursor;
  return runWidgetCursorBridge(deps.key, {
    itemCount: deps.itemCount,
    currentCursor: deps.currentCursor,
    widgetState: deps.widgetState,
    setWidgetCursor: deps.setWidgetCursor,
    getWidgetCursor: deps.getWidgetCursor,
    dispatchKey: deps.dispatchKey,
    applyNextCursor: (nextCursor) => {
      deps.setCursor(nextCursor);
      if (deps.key.name === 'g' || deps.key.name === 'home') {
        deps.resetOffsetToHome?.();
      }
      if (nextCursor !== previousCursor) {
        deps.onCursorChanged?.(previousCursor, nextCursor);
      }
    },
    debugLog: deps.debugLog,
  });
}
