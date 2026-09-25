import { describe, expect, mock, test } from 'bun:test';
import { openCompactSurfaceCatalogPopup } from '../src/dashboard/compact-surface-popup.js';

describe('openCompactSurfaceCatalogPopup', () => {
  test('reports empty targets without mounting a popup', async () => {
    const pushModalSurface = mock(() => ({ dispose: () => {} }));
    const onEmptyTargets = mock(() => {});
    const redraw = mock(() => {});

    await openCompactSurfaceCatalogPopup({
      getTargets: () => [],
      openTarget: () => {},
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface,
      onEmptyTargets,
      redraw,
    });

    expect(onEmptyTargets).toHaveBeenCalledTimes(1);
    expect(pushModalSurface).toHaveBeenCalledTimes(0);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  test('mounts a centered picker and routes picked targets', async () => {
    const calls: string[] = [];
    const dispose = mock(() => calls.push('dispose'));
    const pushModalSurface = mock(() => ({ dispose }));
    const redraw = mock(() => calls.push('redraw'));
    let capturedOpts: {
      onPick: (surfaceId: string) => void | Promise<void>;
      onCancel?: () => void;
      placement: { row?: number; col?: number; width?: number; height?: number } | {
        anchorStartCol: number;
        anchorEndCol: number;
        statusRow: number;
        termCols: number;
        termRows: number;
      };
    } | null = null;

    await openCompactSurfaceCatalogPopup({
      getTargets: () => [
        { id: 'pane:browser', label: 'Browser popup', description: 'Open Browser as a popup', group: 'Panes' },
      ],
      openTarget: (surfaceId) => calls.push(`open:${surfaceId}`),
      ownerWorkspaceId: 'virtual-window:2',
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => undefined,
      pushModalSurface,
      onEmptyTargets: () => calls.push('empty'),
      redraw,
      createSurfaceCatalogRecipe: (opts) => {
        capturedOpts = opts;
        return {
          surface: {
            id: 'test-surface-catalog',
            bounds: { row: 13, col: 55, width: 48, height: 7 },
            view: {} as never,
          },
        } as never;
      },
    });

    expect(pushModalSurface).toHaveBeenCalledTimes(1);
    const mountedSurface = pushModalSurface.mock.calls[0]?.[0];
    expect(mountedSurface?.bounds).toEqual({
      row: 13,
      col: 55,
      width: 48,
      height: 7,
    });
    expect(mountedSurface?.ownerWorkspaceId).toBe('virtual-window:2');

    await capturedOpts?.onPick('pane:browser');
    expect(calls).toContain('open:pane:browser');
    expect(calls).toContain('dispose');
  });
});
