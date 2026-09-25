import { describe, expect, test } from 'bun:test';

import { createDashboardCompanionFeedbackRuntime } from '../src/dashboard/companion-feedback-runtime.js';

describe('createDashboardCompanionFeedbackRuntime', () => {
  test('renders memo and clipboard feedback lines', () => {
    const runtime = createDashboardCompanionFeedbackRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
    });

    expect(runtime.clipboardCopiedLine(12)).toBe('muted:  copied 12 chars to clipboard');
    expect(runtime.clipboardWriteFailedLine()).toBe('warning:  clipboard write failed');
    expect(runtime.memoSavedLine(3)).toBe('muted:  memo saved (3 line(s))');
    expect(runtime.memoDiscardedLine()).toBe('muted:  memo discarded (empty)');
    expect(runtime.memoCancelledLine()).toBe('muted:  memo cancelled');
  });
});
