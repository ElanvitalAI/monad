import { describe, expect, test } from 'bun:test';

import { createDashboardTransferFeedbackRuntime } from '../src/dashboard/transfer-feedback-runtime.js';

describe('createDashboardTransferFeedbackRuntime', () => {
  test('reports picker preconditions and transfer progress', () => {
    const lines: string[] = [];
    const runtime = createDashboardTransferFeedbackRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      success: (text) => `success:${text}`,
      error: (text) => `error:${text}`,
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
      draw: () => { lines.push('draw'); },
      basename: (path) => path.split('/').pop() ?? path,
    });

    runtime.onNoFilesToTransfer();
    runtime.onTransferDisabled('disabled');
    runtime.onNoTransferTargets();
    runtime.onTransferStarted({ kind: 'ssh', name: 'srv', host: { name: 'srv' }, remoteDir: '/tmp' } as any, 2);
    runtime.onSshProgress({ phase: 'done', index: 0, total: 2, localPath: '/a/b.txt' });
    runtime.onSshProgress({ phase: 'error', index: 1, total: 2, localPath: '/a/c.txt', message: 'boom' });

    expect(lines).toEqual([
      'warn:  no files to transfer.', 'scroll', 'draw',
      'warn:  disabled — exit remote mode (Esc) first.', 'scroll', 'draw',
      'warn:  no transfer targets configured.', 'scroll', 'draw',
      'muted:  sending 2 files → srv…', 'scroll', 'draw',
      'muted:  ✓ 1/2 b.txt', 'scroll', 'draw',
      'error:  ✗ c.txt — boom', 'scroll', 'draw',
    ]);
  });

  test('reports final transfer outcomes', () => {
    const lines: string[] = [];
    const runtime = createDashboardTransferFeedbackRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      success: (text) => `success:${text}`,
      error: (text) => `error:${text}`,
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
      draw: () => { lines.push('draw'); },
      basename: (path) => path,
    });

    runtime.onSshTransferCompleted(
      { kind: 'ssh', name: 'srv', host: { name: 'srv' }, remoteDir: '/tmp' } as any,
      { uploaded: ['a'], failed: [] },
    );
    runtime.onIphoneTransferCompleted(
      { kind: 'iphone', name: 'phone' } as any,
      { ok: true, transport: 'pushcut', uploaded: ['a', 'b'], pushcutUrls: ['u1'] },
    );
    runtime.onTransferCrashed(new Error('kaput'));

    expect(lines).toEqual([
      'success:  ✓ uploaded 1 → srv:/tmp', 'scroll', 'draw',
      'success:  ✓ sent to phone via pushcut (2 files)', 'scroll', 'draw',
      'muted:    u1', 'scroll', 'draw',
      'error:  transfer crashed: kaput', 'scroll', 'draw',
    ]);
  });
});
