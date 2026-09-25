import { describe, expect, test } from 'bun:test';

import { createDashboardPreviewSlashRuntime } from '../src/dashboard/preview-slash-runtime.js';

describe('createDashboardPreviewSlashRuntime', () => {
  test('resolves aliases and renders feedback lines', () => {
    const runtime = createDashboardPreviewSlashRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
    });

    expect(runtime.resolve('wd')).toEqual({ kind: 'source', source: 'working' });
    expect(runtime.resolve('ob')).toEqual({ kind: 'source', source: 'obsidian' });
    expect(runtime.resolve('sk')).toEqual({ kind: 'source', source: 'skill' });
    expect(runtime.resolve('s')).toEqual({ kind: 'source', source: 'smart' });
    expect(runtime.resolve('p')).toEqual({ kind: 'binding', binding: 'pinned' });
    expect(runtime.resolve('unpin')).toEqual({ kind: 'binding', binding: 'follow' });
    expect(runtime.resolve('status')).toEqual({ kind: 'status' });
    expect(runtime.resolve('nope')).toEqual({ kind: 'invalid' });

    expect(runtime.statusLine('working', 'follow')).toBe('muted:preview: source=working binding=follow');
    expect(runtime.usageLine()).toBe('warning:  Usage: /preview working|obsidian|skill|smart|pin|follow|status');
  });
});
