import { describe, expect, test } from 'bun:test';

import { createDashboardMemoCompanionRuntime } from '../src/dashboard/memo-companion-runtime.js';

describe('createDashboardMemoCompanionRuntime', () => {
  test('commits saved memo lines', () => {
    const calls: string[] = [];
    let savedLines: string[] | null = null;
    const runtime = createDashboardMemoCompanionRuntime({
      readLines: () => ['alpha', 'beta'],
      resetEditor: () => { calls.push('reset'); },
      close: () => { calls.push('close'); },
      publishSaved: (lines) => { savedLines = lines; calls.push('publish'); },
      pushSavedLine: (lineCount) => { calls.push(`saved:${lineCount}`); },
      pushDiscardedLine: () => { calls.push('discarded'); },
      pushCancelledLine: () => { calls.push('cancelled'); },
    });

    expect(runtime.commit()).toEqual({ kind: 'saved', lines: ['alpha', 'beta'] });
    expect(savedLines).toEqual(['alpha', 'beta']);
    expect(calls).toEqual(['publish', 'saved:2', 'reset', 'close']);
  });

  test('commits discarded empty memo and handles cancel', () => {
    const calls: string[] = [];
    const runtime = createDashboardMemoCompanionRuntime({
      readLines: () => [' ', ''],
      resetEditor: () => { calls.push('reset'); },
      close: () => { calls.push('close'); },
      publishSaved: () => { calls.push('publish'); },
      pushSavedLine: () => { calls.push('saved'); },
      pushDiscardedLine: () => { calls.push('discarded'); },
      pushCancelledLine: () => { calls.push('cancelled'); },
    });

    expect(runtime.commit()).toEqual({ kind: 'discarded' });
    expect(calls).toEqual(['discarded', 'reset', 'close']);

    calls.length = 0;
    runtime.cancel();
    expect(calls).toEqual(['reset', 'close', 'cancelled']);
  });
});
