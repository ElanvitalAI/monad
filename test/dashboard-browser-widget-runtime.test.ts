import { describe, expect, test } from 'bun:test';

import { createDashboardBrowserWidgetRuntime } from '../src/dashboard/browser-widget-runtime.js';

describe('createDashboardBrowserWidgetRuntime', () => {
  test('detects refresh and builds browser projection', () => {
    const runtime = createDashboardBrowserWidgetRuntime({
      fmtEntryColored: (entry) => `fmt:${entry.name}`,
      iconForEntry: (entry) => `icon:${entry.name}`,
      encodeSubmitText: (entry) => `submit:${entry.name}`,
    });
    const entries = [
      { name: '..', absPath: '/p', isDir: true },
      { name: 'a.txt', absPath: '/p/a.txt', isDir: false },
    ] as any;
    const workingDir = {
      entries,
      selected: new Set(['/p/a.txt']),
      cursor: 1,
      offset: 2,
    } as any;

    expect(runtime.shouldRefresh(
      { entries: null, selectedSize: -1, cursor: -1, offset: -1 },
      workingDir,
    )).toBe(true);

    const projection = runtime.buildProjection(workingDir);
    expect(projection.items).toEqual(['fmt:..', 'fmt:a.txt']);
    expect(projection.icons).toEqual(['icon:..', 'icon:a.txt']);
    expect(projection.submitText).toEqual(['submit:..', 'submit:a.txt']);
    expect([...projection.selected]).toEqual(['fmt:a.txt']);
    expect(runtime.nextCache(workingDir)).toEqual({
      entries,
      selectedSize: 1,
      cursor: 1,
      offset: 2,
    });
  });
});
