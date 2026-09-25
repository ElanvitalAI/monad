import { describe, expect, test } from 'bun:test';

import { createDashboardClipboardHistoryRuntime } from '../src/dashboard/clipboard-history-runtime.js';

describe('createDashboardClipboardHistoryRuntime', () => {
  test('maps entries and normalizes widget cursor', () => {
    const runtime = createDashboardClipboardHistoryRuntime();

    expect(runtime.mapEntries([
      { text: 'a', ts: 1 },
      { text: 'b', ts: 2 },
    ])).toEqual([
      { id: 'c1-0', text: 'a', ts: 1 },
      { id: 'c2-1', text: 'b', ts: 2 },
    ]);

    expect(runtime.normalizeCursor(3)).toBe(3);
    expect(runtime.normalizeCursor(-2)).toBe(0);
    expect(runtime.normalizeCursor('x')).toBeNull();
    expect(runtime.normalizeCursor(NaN)).toBeNull();
  });
});
