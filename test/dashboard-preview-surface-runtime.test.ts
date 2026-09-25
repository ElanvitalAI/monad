import { describe, expect, test } from 'bun:test';

import { createDashboardPreviewSurfaceRuntime } from '../src/dashboard/preview-surface-runtime.js';

describe('createDashboardPreviewSurfaceRuntime', () => {
  test('builds plain preview titles', () => {
    const runtime = createDashboardPreviewSurfaceRuntime({
      formatPreviewSourceLabel: (sourceMode, view, lastBrowserFocus) =>
        `${sourceMode}:${view}:${lastBrowserFocus}`,
    });

    expect(runtime.buildPlainTitle('smart', 2, 'browser', 'follow'))
      .toBe('Preview · smart:2:browser');
    expect(runtime.buildPlainTitle('working', 1, 'obsidian', 'pinned'))
      .toBe('Preview · working:1:obsidian · PIN');
  });
});
