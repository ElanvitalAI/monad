import { describe, expect, mock, test } from 'bun:test';
import { openDashboardWindowPickerPopup } from '../src/dashboard/window-picker-popup.js';

function makeRegistry(count: number) {
  const windows = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Window ${i + 1}`,
    listPanes: () => [],
  }));
  return {
    list: () => windows,
    current: () => windows[0] ?? null,
    get: (id: number) => windows.find((w) => w.id === id) ?? null,
  } as never;
}

describe('openDashboardWindowPickerPopup', () => {
  test('reports empty window lists without mounting', () => {
    const onEmptyWindows = mock(() => {});
    const pushModalSurface = mock(() => ({ dispose: () => {} }));

    openDashboardWindowPickerPopup({
      registry: makeRegistry(0),
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface,
      setAgentSearchModal: () => {},
      onEmptyWindows,
      onAcceptWindow: () => {},
      redraw: () => {},
      createWindowPickerModal: () => ({ surface: {} as never } as never),
    });

    expect(onEmptyWindows).toHaveBeenCalledTimes(1);
    expect(pushModalSurface).toHaveBeenCalledTimes(0);
  });

  test('mounts a centered picker and clears modal on accept/cancel', () => {
    const calls: string[] = [];
    const dispose = mock(() => calls.push('dispose'));
    const pushModalSurface = mock(() => ({ dispose }));
    let accept: ((window: { id: number }) => void) | null = null;
    let cancel: (() => void) | null = null;

    openDashboardWindowPickerPopup({
      registry: makeRegistry(3),
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface,
      setAgentSearchModal: (modal) => calls.push(modal ? 'modal:set' : 'modal:clear'),
      onEmptyWindows: () => calls.push('empty'),
      onAcceptWindow: (window) => calls.push(`accept:${window.id}`),
      redraw: () => calls.push('redraw'),
      createWindowPickerModal: (opts) => {
        accept = opts.onAccept as (window: { id: number }) => void;
        cancel = opts.onCancel ?? null;
        expect(opts.bounds).toEqual({
          row: 16,
          col: 30,
          width: 60,
          height: 7,
        });
        expect(opts.maxVisible).toBe(4);
        return { surface: { id: 'window-picker-surface' } as never } as never;
      },
    });

    expect(pushModalSurface).toHaveBeenCalledTimes(1);
    expect((pushModalSurface.mock.calls[0]![0] as any).ownerWorkspaceId).toBe('dashboard-main');
    expect(calls).toEqual(['modal:set', 'redraw']);

    accept?.({ id: 2 });
    expect(calls).toContain('accept:2');
    expect(calls).toContain('modal:clear');
    expect(calls).toContain('dispose');

    calls.length = 0;
    cancel?.();
    expect(calls).toEqual(['modal:clear', 'dispose', 'redraw']);
  });

  test('routes the synthetic main target through onAcceptMain', () => {
    const calls: string[] = [];
    let accept: ((window: { id: number } | 'main') => void) | null = null;
    openDashboardWindowPickerPopup({
      registry: makeRegistry(2),
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: () => ({ dispose: () => {} }),
      setAgentSearchModal: () => {},
      onEmptyWindows: () => {},
      onAcceptMain: () => calls.push('main'),
      onAcceptWindow: (window) => calls.push(`window:${window.id}`),
      redraw: () => {},
      createWindowPickerModal: (opts) => {
        accept = opts.onAccept as ((window: { id: number } | 'main') => void);
        return { surface: { id: 'window-picker-surface' } as never } as never;
      },
    });
    accept?.('main');
    expect(calls).toEqual(['main']);
  });

  test('assigns picker ownership to the opening workspace when provided', () => {
    let pushed: any = null;
    openDashboardWindowPickerPopup({
      registry: makeRegistry(2),
      ownerWorkspaceId: 'virtual-window:2',
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface: (surface) => {
        pushed = surface;
        return { dispose: () => {} };
      },
      setAgentSearchModal: () => {},
      onEmptyWindows: () => {},
      onAcceptWindow: () => {},
      redraw: () => {},
      createWindowPickerModal: () => ({ surface: { id: 'window-picker-surface' } as never } as never),
    });
    expect(pushed?.ownerWorkspaceId).toBe('virtual-window:2');
  });

  test('small picker opens with narrower compact bounds', () => {
    openDashboardWindowPickerPopup({
      registry: makeRegistry(2),
      termSize: () => ({ cols: 80, rows: 30 }),
      getTheme: () => undefined,
      pushModalSurface: () => ({ dispose: () => {} }),
      setAgentSearchModal: () => {},
      onEmptyWindows: () => {},
      onAcceptWindow: () => {},
      redraw: () => {},
      createWindowPickerModal: (opts) => {
        expect(opts.bounds).toEqual({
          row: 12,
          col: 21,
          width: 38,
          height: 6,
        });
        expect(opts.maxVisible).toBe(3);
        return { surface: { id: 'window-picker-surface' } as never } as never;
      },
    });
  });
});
