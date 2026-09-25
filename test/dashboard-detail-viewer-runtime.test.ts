import { describe, expect, test } from 'bun:test';

import { createDashboardDetailViewerRuntime } from '../src/dashboard/detail-viewer-runtime.js';

describe('createDashboardDetailViewerRuntime', () => {
  test('sets, clears, closes, and snapshots detail state', () => {
    const calls: string[] = [];
    const runtime = createDashboardDetailViewerRuntime({
      setOpen: (open) => { calls.push(`open:${open}`); },
      requestRender: () => { calls.push('render'); },
    });

    expect(runtime.snapshot()).toEqual({ title: '', lines: [] });

    runtime.set('Title', ['a', 'b']);
    expect(runtime.snapshot()).toEqual({ title: 'Title', lines: ['a', 'b'] });
    expect(calls).toEqual(['open:true', 'render']);

    calls.length = 0;
    runtime.clear();
    expect(runtime.snapshot()).toEqual({ title: '', lines: [] });
    expect(calls).toEqual(['render']);

    calls.length = 0;
    runtime.close();
    expect(calls).toEqual(['open:false']);
  });
});
