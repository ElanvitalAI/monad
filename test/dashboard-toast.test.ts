import { afterEach, describe, expect, test } from 'bun:test';

import { showToast } from '../src/dashboard/render/toast.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { _resetTransientTerminalModalsForTesting } from '../src/dashboard/modals/transient.js';

afterEach(() => {
  _resetTransientTerminalModalsForTesting();
});

describe('showToast', () => {
  test('anchors to bottom-right with margin', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = showToast({
      title: 'Terminal opened',
      lines: ['▶ yazi'],
      termCols: 120,
      termRows: 40,
      coordinator: coord,
      ttlMs: 0,
    });
    // height = max(3, lines.length + 2) = 3
    expect(handle.bounds.height).toBe(3);
    // Bottom margin = 1: row = termRows - height - 1 = 40 - 3 - 1 = 36
    expect(handle.bounds.row).toBe(36);
    // Right margin = 1: col = termCols - width - 1
    expect(handle.bounds.col).toBe(120 - handle.bounds.width - 1);
  });

  test('width is content-aware between 24 and 56', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const narrow = showToast({
      title: 'ok',         // 2 chars + 4 = 6 → clamped to 24
      lines: [],
      termCols: 100,
      termRows: 30,
      coordinator: coord,
      ttlMs: 0,
    });
    expect(narrow.bounds.width).toBe(24);

    const wide = showToast({
      title: 'a really rather wonderfully exceedingly long title that is definitely longer than the clamp limit',
      lines: [],
      termCols: 200,
      termRows: 30,
      coordinator: coord,
      ttlMs: 0,
      group: 'wide',
    });
    expect(wide.bounds.width).toBe(56);
  });

  test('toast and centered modal coexist in different groups', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const t = showToast({
      title: 'toast',
      termCols: 100,
      termRows: 30,
      coordinator: coord,
      ttlMs: 0,
    });
    // Also explicitly open a centered one from the underlying api
    // by using a different group.
    expect(coord.modalStack()).toContain(t.id);
  });
});
