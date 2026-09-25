import { describe, expect, test } from 'bun:test';

import { createDashboardScratchSlashRuntime } from '../src/dashboard/scratch-slash-runtime.js';

describe('createDashboardScratchSlashRuntime', () => {
  test('renders scratch slash feedback lines', () => {
    const runtime = createDashboardScratchSlashRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
    });

    expect(runtime.reopenedLine()).toBe('muted:  scratch pane reopened');
    expect(runtime.alreadyOpenLine()).toBe('muted:  scratch pane is already open');
    expect(runtime.popupLine(true)).toBe('muted:  scratch companion popup opened');
    expect(runtime.popupLine(false)).toBe('muted:  scratch companion popup closed');
    expect(runtime.popupPromotedLine()).toBe('muted:  scratch companion promoted to foreground pane');
    expect(runtime.popupUsageLine()).toBe('warning:  usage: /scratch popup [open|close|toggle|promote]');
    expect(runtime.closedLine()).toBe('muted:  scratch pane closed (Ctrl+B Ctrl+S to reopen)');
    expect(runtime.clearedLine()).toBe('muted:  scratchpad cleared');
    expect(runtime.emptyDumpLine()).toBe('muted:  (scratchpad is empty)');
    expect(runtime.dumpHeaderLine('Note')).toBe('muted:── scratchpad · Note ──');
    expect(runtime.memoOpenedLine()).toBe('muted:  memo companion popup opened');
    expect(runtime.usageLine()).toBe('warning:  Usage: /scratch <text> | /scratch + <text> | /scratch memo | /scratch clear | /scratch dump');
  });
});
