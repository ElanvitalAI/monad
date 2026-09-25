import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { attachStreamingKeys, onEscAbort } from './index.js';

type DataListener = (data: string | Buffer) => void;

interface FakeStdin {
  paused: boolean;
  listeners: DataListener[];
  pending: Array<string | Buffer>;
  resumeCalls: number;
  pauseCalls: number;
  removeCalls: number;
  write(data: string | Buffer): void;
}

function installFakeStdin(startPaused: boolean): FakeStdin {
  const fake: FakeStdin = {
    paused: startPaused,
    listeners: [],
    pending: [],
    resumeCalls: 0,
    pauseCalls: 0,
    removeCalls: 0,
    write(data) {
      if (fake.paused) {
        fake.pending.push(data);
        return;
      }
      for (const listener of fake.listeners.slice()) listener(data);
    },
  };
  (process.stdin as any).on = (event: string, listener: DataListener) => {
    if (event === 'data') fake.listeners.push(listener);
    return process.stdin;
  };
  (process.stdin as any).removeListener = (event: string, listener: DataListener) => {
    if (event === 'data') {
      fake.removeCalls++;
      fake.listeners = fake.listeners.filter((candidate) => candidate !== listener);
    }
    return process.stdin;
  };
  (process.stdin as any).isPaused = () => fake.paused;
  (process.stdin as any).resume = () => {
    fake.resumeCalls++;
    fake.paused = false;
    const pending = fake.pending.splice(0);
    for (const data of pending) fake.write(data);
    return process.stdin;
  };
  (process.stdin as any).pause = () => {
    fake.pauseCalls++;
    fake.paused = true;
    return process.stdin;
  };
  return fake;
}

describe('attachStreamingKeys stdin lifecycle', () => {
  let originalOn: typeof process.stdin.on;
  let originalRemoveListener: typeof process.stdin.removeListener;
  let originalIsPaused: typeof process.stdin.isPaused;
  let originalResume: typeof process.stdin.resume;
  let originalPause: typeof process.stdin.pause;

  beforeEach(() => {
    originalOn = process.stdin.on;
    originalRemoveListener = process.stdin.removeListener;
    originalIsPaused = process.stdin.isPaused;
    originalResume = process.stdin.resume;
    originalPause = process.stdin.pause;
  });

  afterEach(() => {
    (process.stdin as any).on = originalOn;
    (process.stdin as any).removeListener = originalRemoveListener;
    (process.stdin as any).isPaused = originalIsPaused;
    (process.stdin as any).resume = originalResume;
    (process.stdin as any).pause = originalPause;
  });

  test('resumes paused stdin and delivers buffered multi-key input', () => {
    const stdin = installFakeStdin(true);
    const seen: string[] = [];
    stdin.write('jk');

    const cleanup = attachStreamingKeys((key) => { seen.push(key.name); });

    expect(stdin.resumeCalls).toBe(1);
    expect(stdin.paused).toBe(false);
    expect(seen).toEqual(['j', 'k']);
    cleanup();
  });

  test('cleanup restores paused state, removes its listener, and is idempotent', () => {
    const stdin = installFakeStdin(true);
    const cleanup = attachStreamingKeys(() => {});

    cleanup();
    cleanup();

    expect(stdin.listeners).toEqual([]);
    expect(stdin.removeCalls).toBe(1);
    expect(stdin.pauseCalls).toBe(1);
    expect(stdin.paused).toBe(true);
  });

  test('cleanup preserves an already flowing stdin', () => {
    const stdin = installFakeStdin(false);
    const cleanup = attachStreamingKeys(() => {});

    cleanup();

    expect(stdin.removeCalls).toBe(1);
    expect(stdin.pauseCalls).toBe(0);
    expect(stdin.paused).toBe(false);
  });

  test('onEscAbort receives a lone Escape through the streaming listener', async () => {
    const stdin = installFakeStdin(true);
    const controller = new AbortController();
    const cleanup = onEscAbort(controller);

    stdin.write('\x1b');
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });
});
