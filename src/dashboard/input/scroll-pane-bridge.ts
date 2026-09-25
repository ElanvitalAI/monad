import type { Key } from '../../tui.js';
import { isDashboardCursorScrollKey } from './widget-cursor-bridge.js';

export interface RunScrollPaneBridgeDeps<TState> {
  key: Key;
  widgetState: TState | null;
  currentScroll: number;
  maxScroll: number;
  pageSize: number;
  halfPageSize: number;
  acceptsHalfPageCtrl?: boolean;
  setWidgetScroll: (state: TState, scroll: number) => void;
  getWidgetScroll: (state: TState) => number;
  configureWidget?: (state: TState) => void;
  dispatchKey: () => void;
  applyNextScroll: (nextScroll: number) => void;
  debugLog?: (phase: 'pre' | 'post', payload: Record<string, unknown>) => void;
}

export function isScrollPaneKey(
  key: Key,
  opts: { acceptsHalfPageCtrl?: boolean } = {},
): boolean {
  if (isDashboardCursorScrollKey(key)) return true;
  if (key.name === 'pageup' || key.name === 'pagedown') return true;
  if (opts.acceptsHalfPageCtrl && key.ctrl && (key.name === 'd' || key.name === 'u')) {
    return true;
  }
  return false;
}

export function runScrollPaneBridge<TState>(
  deps: RunScrollPaneBridgeDeps<TState>,
): boolean {
  if (!isScrollPaneKey(deps.key, { acceptsHalfPageCtrl: deps.acceptsHalfPageCtrl })) {
    return false;
  }
  if (!deps.widgetState) return true;
  deps.setWidgetScroll(deps.widgetState, deps.currentScroll);
  deps.configureWidget?.(deps.widgetState);
  deps.debugLog?.('pre', {
    key: deps.key.name || '(empty)',
    scroll: deps.currentScroll,
    maxScroll: deps.maxScroll,
  });
  deps.dispatchKey();
  const nextScroll = Math.max(0, Math.min(deps.getWidgetScroll(deps.widgetState), deps.maxScroll));
  deps.applyNextScroll(nextScroll);
  deps.debugLog?.('post', {
    key: deps.key.name || '(empty)',
    scroll: nextScroll,
    maxScroll: deps.maxScroll,
  });
  return true;
}
