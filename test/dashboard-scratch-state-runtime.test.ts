import { describe, expect, test } from 'bun:test';

import { createDashboardScratchStateRuntime } from '../src/dashboard/scratch-state-runtime.js';

describe('createDashboardScratchStateRuntime', () => {
  test('replaces scratch state and resolves command snapshot', () => {
    const runtime = createDashboardScratchStateRuntime();

    expect(runtime.replace('Note', ['a', 'b'])).toEqual({
      title: 'Note',
      lines: ['a', 'b'],
      offset: 0,
    });

    expect(runtime.resolveCommandSnapshot(
      { source: 'x', mode: 'preview', title: 'Pinned', lines: ['y'], updatedAt: 1 },
      { title: 'Fallback', lines: ['z'] },
    )).toEqual({
      title: 'Pinned',
      lines: ['y'],
    });

    expect(runtime.resolveCommandSnapshot(
      { source: 'x', mode: 'agents', title: 'Agents', lines: ['a'], updatedAt: 1 },
      { title: 'Fallback', lines: ['z'] },
    )).toEqual({
      title: 'Fallback',
      lines: ['z'],
    });
  });
});
