import { describe, expect, test } from 'bun:test';

import { createDashboardFinderFeedbackRuntime } from '../src/dashboard/finder-feedback-runtime.js';

describe('createDashboardFinderFeedbackRuntime', () => {
  test('formats finder and ssh feedback lines', () => {
    const lines: string[] = [];
    const runtime = createDashboardFinderFeedbackRuntime({
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
      error: (text) => `error:${text}`,
      warning: (text) => `warning:${text}`,
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
    });

    runtime.onFinderScanStarted('/tmp/work');
    runtime.onFinderScanCompleted({
      count: 2,
      backend: 'fd',
      truncated: true,
      durationMs: 41,
    });
    runtime.onFinderScanEmpty();
    runtime.onFinderFailed('boom');
    runtime.onSshConnectStarted({ name: 'node-b', host: '100.0.0.1' });
    runtime.onSshConnectSucceeded('node-b');
    runtime.onSshConnectFailed('node-b', 'timeout');

    expect(lines).toEqual([
      'muted:  scanning /tmp/work…',
      'scroll',
      'muted:  2 files (fd, capped) in 41ms',
      'scroll',
      'warning:  no files found in the current tree.',
      'scroll',
      'error:  finder failed: boom',
      'scroll',
      'muted:  connecting to node-b (100.0.0.1)…',
      'scroll',
      'success:  ✓ remote node-b',
      'scroll',
      'error:  ssh node-b failed: timeout',
      'scroll',
    ]);
  });
});
