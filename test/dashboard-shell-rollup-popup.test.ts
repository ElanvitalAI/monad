import { describe, expect, mock, test } from 'bun:test';
import { openDashboardShellRollupPopup } from '../src/dashboard/shell-rollup-popup.js';

function makeRegistry() {
  const handles = [
    { id: 'h1', status: 'running', mode: 'vw' },
  ];
  return {
    list: () => handles,
    get: (id: string) => handles.find((h) => h.id === id) ?? null,
    getVwLabel: () => 'runner',
  } as never;
}

describe('openDashboardShellRollupPopup', () => {
  test('closes previous popup and reports empty registries', async () => {
    const calls: string[] = [];
    let currentDispose: (() => void) | null = () => calls.push('old-dispose');

    await openDashboardShellRollupPopup({
      getShellRegistry: () => ({ list: () => [], get: () => null, getVwLabel: () => null } as never),
      getCurrentDispose: () => currentDispose,
      setCurrentDispose: (dispose) => {
        currentDispose = dispose;
        calls.push(`set:${dispose ? 'some' : 'null'}`);
      },
      resolveVwIdByLabel: () => null,
      switchVirtualWindow: () => calls.push('switch'),
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: () => ({ dispose: () => calls.push('dispose') }),
      onEmpty: () => calls.push('empty'),
      onWarning: (message) => calls.push(`warn:${message}`),
      redraw: () => calls.push('redraw'),
    });

    expect(calls).toEqual(['old-dispose', 'set:null', 'empty', 'redraw']);
  });

  test('mounts popup and routes attach outcomes', async () => {
    const calls: string[] = [];
    let currentDispose: (() => void) | null = null;
    const dispose = mock(() => calls.push('dispose'));
    let mountedSurface: any = null;
    let pick: ((id: string) => void) | null = null;
    let cancel: (() => void) | null = null;

    await openDashboardShellRollupPopup({
      getShellRegistry: () => makeRegistry(),
      getCurrentDispose: () => currentDispose,
      setCurrentDispose: (next) => {
        currentDispose = next;
        calls.push(`set:${next ? 'some' : 'null'}`);
      },
      resolveVwIdByLabel: (label) => (label === 'runner' ? 9 : null),
      switchVirtualWindow: (id) => calls.push(`switch:${id}`),
      ownerWorkspaceId: 'virtual-window:4',
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: (surface) => {
        mountedSurface = surface;
        return { dispose };
      },
      onEmpty: () => calls.push('empty'),
      onWarning: (message) => calls.push(`warn:${message}`),
      redraw: () => calls.push('redraw'),
      createShellRollupPopupRecipe: (opts) => {
        pick = opts.onPick;
        cancel = opts.onCancel ?? null;
        expect(opts.placement).toEqual({
          anchorStartCol: 40,
          anchorEndCol: 80,
          statusRow: 20,
          termCols: 120,
          termRows: 40,
        });
        expect(opts.entries).toEqual([
          {
            id: 'h1',
            chip: 'chip:running',
            mode: 'vw',
            status: 'running',
            label: 'runner',
          },
        ]);
        return {
          surface: { id: 'shell-rollup-popup' } as never,
          handleKey: () => false,
          dispose: () => calls.push('recipe:dispose'),
        } as never;
      },
      renderHandleStatusChip: (status) => `chip:${status}`,
      decideAttach: () => ({ kind: 'switch-vw', windowId: 9 }),
    });

    expect(calls).toEqual(['set:some', 'redraw']);
    expect(mountedSurface?.ownerWorkspaceId).toBe('virtual-window:4');
    pick?.('h1');
    expect(calls).toEqual([
      'set:some',
      'redraw',
      'switch:9',
      'recipe:dispose',
      'dispose',
      'set:null',
      'redraw',
    ]);

    calls.length = 0;
    cancel?.();
    expect(calls).toEqual(['set:null', 'redraw']);
  });
});
