import { describe, expect, test } from 'bun:test';

import { createDashboardVirtualWindowInputRuntime } from '../src/dashboard/virtual-window-input-runtime.js';

describe('createDashboardVirtualWindowInputRuntime', () => {
  test('routes local input delivery and selector callbacks', () => {
    const lines: string[] = [];
    const selectorCalls: Array<[number, number, number]> = [];
    const pickerCalls: Array<[number, string]> = [];
    const menuCalls: Array<{ windowId: string; paneId: string }> = [];

    const runtime = createDashboardVirtualWindowInputRuntime({
      getRegistry: () => ({
        get: (windowId) => windowId === 3
          ? {
              deliverBroadcastToFocused: () => 1,
              deliverBroadcastToPane: () => 1,
              deliverBroadcastToAll: () => 2,
              getPaneDisplayTitle: () => 'notes',
              listPanes: () => [1, 2, 3],
            }
          : null,
      }),
      pushMutedLine: (line) => { lines.push(line); },
      openLocalInputTargetPopup: (windowId, seedQuery) => { pickerCalls.push([windowId, seedQuery]); },
      openSelectorPopup: (windowId, col, row) => { selectorCalls.push([windowId, col, row]); },
      routeContextMenu: (req) => {
        menuCalls.push({ windowId: req.hitTarget.windowId, paneId: req.hitTarget.paneId });
        return false;
      },
      skipWindowWhen: () => true,
      resolvePaneVisibility: (_windowId, _paneId) => 'hidden',
      termSize: () => ({ cols: 120, rows: 40 }),
    });

    runtime.onLocalInputSubmit?.(3, { target: { kind: 'focused' }, broadcast: {} } as never);
    runtime.onLocalInputSubmit?.(3, { target: { kind: 'pane', paneId: 'pane-1' }, broadcast: {} } as never);
    runtime.onLocalInputSubmit?.(3, { target: { kind: 'all' }, broadcast: {} } as never);
    runtime.onOpenLocalInputTargetPicker?.({ windowId: 3, seedQuery: 'term' } as never);
    runtime.onShowSelector?.(3, null, 9, 11);
    runtime.onShowContextMenu?.(3, 'pane-1', 5, 7);

    expect(lines).toEqual([
      '  vw:3 @focused → delivered=1 skipped=0',
      '  vw:3 @notes → delivered=1 skipped=0',
      '  vw:3 @all → delivered=2 skipped=1',
    ]);
    expect(pickerCalls).toEqual([[3, 'term']]);
    expect(selectorCalls).toEqual([[3, 9, 11], [3, 5, 7]]);
    expect(menuCalls).toEqual([{ windowId: '3', paneId: 'pane-1' }]);
    expect(runtime.extraSkipWindowWhen?.({})).toBe(true);
    expect(runtime.visibilityResolverFactory?.(3)('pane-1')).toBe('hidden');

    // ⛔ 이 단언은 «수»가 아니라 «성질»을 문다 — 높이·너비는 레이아웃 값이라 바뀐다(2026-08-30 에 39→38).
    //   그때 여기 있던 `toEqual({row,col,width,height})` 가 통째로 «지워졌고» defaultBounds 커버리지가
    //   0이 됐다. 되살리되 드리프트하는 수에는 안 묶는다.
    const bounds = runtime.defaultBounds?.();
    expect(bounds).toBeDefined();
    expect(bounds!.row).toBe(1);
    expect(bounds!.col).toBe(1);
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
  });

  test('does nothing when target window is missing and suppresses selector fallback when menu consumes', () => {
    const selectorCalls: Array<[number, number, number]> = [];
    const runtime = createDashboardVirtualWindowInputRuntime({
      getRegistry: () => ({ get: () => null }),
      pushMutedLine: () => { throw new Error('should not log'); },
      openLocalInputTargetPopup: () => {},
      openSelectorPopup: (windowId, col, row) => { selectorCalls.push([windowId, col, row]); },
      routeContextMenu: () => true,
      skipWindowWhen: () => false,
      resolvePaneVisibility: () => 'visible',
      termSize: () => ({ cols: 10, rows: 5 }),
    });

    runtime.onLocalInputSubmit?.(9, { target: { kind: 'focused' }, broadcast: {} } as never);
    runtime.onShowContextMenu?.(9, 'pane-2', 1, 2);
    expect(selectorCalls).toEqual([]);
  });
});
