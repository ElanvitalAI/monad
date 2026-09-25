import { afterEach, describe, expect, test } from 'bun:test';
import { resetForTesting, setPtyAdapterForTesting, startPty, unregisterPty } from './registry.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await Bun.sleep(25);
  }
  return condition();
}

describe('PtyHandle.kill default termination contract', () => {
  let handle: ReturnType<typeof startPty> | undefined;

  afterEach(() => {
    if (handle?.isAlive()) handle.kill('SIGKILL');
    if (handle) unregisterPty(handle.id);
    handle = undefined;
    resetForTesting();
    setPtyAdapterForTesting(null);
  });

  test('escalates an interactive shell that ignores SIGTERM until its OS process is gone', async () => {
    handle = startPty({
      cmd: 'bash',
      args: ['--norc', '--noprofile', '-i'],
      kind: 'kill-contract',
      cols: 80,
      rows: 24,
    });
    const pid = handle.pid;
    expect(pid).toBeGreaterThan(0);
    expect(isProcessAlive(pid)).toBe(true);

    handle.kill();

    expect(await waitFor(() => !isProcessAlive(pid), 1_500)).toBe(true);
    expect(handle.isAlive()).toBe(false);
  });

  test('cancels escalation when the child exits during the grace period', async () => {
    const signals: string[] = [];
    let onExit: ((event: { exitCode: number | null; signal?: number }) => void) | undefined;
    setPtyAdapterForTesting(() => ({
      pid: process.pid,
      write() {},
      kill(signal?: string) { signals.push(signal ?? 'SIGTERM'); },
      onData: () => ({ dispose() {} }),
      onExit(callback) {
        onExit = callback;
        return { dispose() {} };
      },
    }));
    handle = startPty({ cmd: 'synthetic' });

    handle.kill();
    onExit?.({ exitCode: 0 });
    await Bun.sleep(1_100);

    expect(signals).toEqual(['SIGTERM']);
  });

  test('preserves an explicit signal without scheduling SIGKILL', async () => {
    const signals: string[] = [];
    setPtyAdapterForTesting(() => ({
      pid: process.pid,
      write() {},
      kill(signal?: string) { signals.push(signal ?? 'SIGTERM'); },
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
    }));
    handle = startPty({ cmd: 'synthetic' });

    handle.kill('SIGINT');
    await Bun.sleep(1_100);

    expect(signals).toEqual(['SIGINT']);
  });
});
