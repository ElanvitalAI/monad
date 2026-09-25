// ── X1 (Phase 1) — range-select consumer tests ──

import { describe, expect, test } from 'bun:test';
import {
  createRangeSelectConsumer,
  type RangeSelectSpec,
} from '../../src/dashboard/terminal-intent-consumers/range-select.consumer';
import type { SerializableSurfaceIntent } from '../../src/dashboard/terminal-surface-intent';

function intent(opts: Partial<SerializableSurfaceIntent>): SerializableSurfaceIntent {
  return {
    kind: opts.kind ?? 'range-select-update',
    surfaceId: opts.surfaceId ?? 's1',
    paneKind: opts.paneKind ?? 'preview-terminal',
    row: opts.row ?? 0,
    col: opts.col ?? 0,
    exposure: opts.exposure ?? { userExposure: 'observe-only', agentInteractive: true },
    capability: opts.capability ?? {
      canRead: true,
      canInterrupt: true,
      canWrite: false,
      canInspect: true,
    },
  };
}

describe('range-select consumer', () => {
  test('passes when intent kind is unrelated', () => {
    const c = createRangeSelectConsumer();
    expect(c.handle(intent({ kind: 'word-select' })).handled).toBe(false);
  });

  test('rejects when canInspect=false', () => {
    const c = createRangeSelectConsumer();
    const r = c.handle(intent({
      kind: 'range-select-update',
      capability: { canRead: false, canInterrupt: false, canWrite: false, canInspect: false },
    }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe('no-canInspect');
  });

  test('update event handled but does not invoke onRangeSelect', () => {
    const seen: RangeSelectSpec[] = [];
    const c = createRangeSelectConsumer({ onRangeSelect: (s) => { seen.push(s); } });
    expect(c.handle(intent({
      kind: 'range-select-update',
      row: 2,
      col: 3,
    })).handled).toBe(true);
    expect(seen).toHaveLength(0);
  });

  test('end after update fires onRangeSelect with anchor + end coords', () => {
    const seen: RangeSelectSpec[] = [];
    const c = createRangeSelectConsumer({ onRangeSelect: (s) => { seen.push(s); } });

    c.handle(intent({ kind: 'range-select-update', row: 1, col: 2 }));
    c.handle(intent({ kind: 'range-select-update', row: 3, col: 4 })); // mid-drag motion
    c.handle(intent({ kind: 'range-select-end', row: 5, col: 6 }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      surfaceId: 's1',
      paneKind: 'preview-terminal',
      startRow: 1, // anchor preserved across motion updates
      startCol: 2,
      endRow: 5,
      endCol: 6,
    });
  });

  test('end without prior update synthesizes single-cell range', () => {
    const seen: RangeSelectSpec[] = [];
    const c = createRangeSelectConsumer({ onRangeSelect: (s) => { seen.push(s); } });

    c.handle(intent({ kind: 'range-select-end', row: 7, col: 8 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      surfaceId: 's1',
      paneKind: 'preview-terminal',
      startRow: 7,
      startCol: 8,
      endRow: 7,
      endCol: 8,
    });
  });

  test('parallel surfaces tracked independently', () => {
    const seen: RangeSelectSpec[] = [];
    const c = createRangeSelectConsumer({ onRangeSelect: (s) => { seen.push(s); } });

    c.handle(intent({ kind: 'range-select-update', surfaceId: 'a', row: 1, col: 1 }));
    c.handle(intent({ kind: 'range-select-update', surfaceId: 'b', row: 2, col: 2 }));
    c.handle(intent({ kind: 'range-select-end',    surfaceId: 'a', row: 1, col: 5 }));
    c.handle(intent({ kind: 'range-select-end',    surfaceId: 'b', row: 2, col: 9 }));

    expect(seen).toHaveLength(2);
    expect(seen[0]!.surfaceId).toBe('a');
    expect(seen[0]!.startCol).toBe(1);
    expect(seen[0]!.endCol).toBe(5);
    expect(seen[1]!.surfaceId).toBe('b');
    expect(seen[1]!.startCol).toBe(2);
    expect(seen[1]!.endCol).toBe(9);
  });

  test('listener throw is isolated', () => {
    const c = createRangeSelectConsumer({
      onRangeSelect: () => { throw new Error('boom'); },
    });
    c.handle(intent({ kind: 'range-select-update', row: 1, col: 1 }));
    expect(() => c.handle(intent({ kind: 'range-select-end', row: 2, col: 2 }))).not.toThrow();
  });
});
