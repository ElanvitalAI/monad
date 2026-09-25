import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { showSyncSelector } from '../src/selector.js';
import { closeTui } from '../src/tui.js';

const stdin = process.stdin as NodeJS.ReadStream & {
  setRawMode?: (mode: boolean) => unknown;
  readableFlowing: boolean | null;
};
let originalOn: typeof process.stdin.on;
let originalRemoveListener: typeof process.stdin.removeListener;
let originalResume: typeof process.stdin.resume;
let originalPause: typeof process.stdin.pause;
let originalSetRawMode: typeof stdin.setRawMode;
let originalIsTTY: PropertyDescriptor | undefined;
let originalFlowing: boolean | null;
let listeners: Array<(data: string | Buffer) => void>;
let rawModeCalls: boolean[];

async function waitForListener(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (listeners.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('stdin listener did not attach');
}

function setIsTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}

beforeEach(() => {
  listeners = [];
  rawModeCalls = [];
  originalOn = process.stdin.on.bind(process.stdin);
  originalRemoveListener = process.stdin.removeListener.bind(process.stdin);
  originalResume = process.stdin.resume.bind(process.stdin);
  originalPause = process.stdin.pause.bind(process.stdin);
  originalSetRawMode = stdin.setRawMode;
  originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  originalFlowing = stdin.readableFlowing;
  stdin.setRawMode = (mode: boolean) => {
    rawModeCalls.push(mode);
    return stdin;
  };
  (process.stdin as any).on = (event: string, listener: (data: string | Buffer) => void) => {
    if (event === 'data') listeners.push(listener);
    return process.stdin;
  };
  (process.stdin as any).removeListener = (event: string, listener: (data: string | Buffer) => void) => {
    if (event === 'data') listeners = listeners.filter((candidate) => candidate !== listener);
    return process.stdin;
  };
  (process.stdin as any).resume = () => {
    stdin.readableFlowing = true;
    return process.stdin;
  };
  (process.stdin as any).pause = () => {
    stdin.readableFlowing = false;
    return process.stdin;
  };
  stdin.readableFlowing = false;
});

afterEach(() => {
  closeTui();
  (process.stdin as any).on = originalOn;
  (process.stdin as any).removeListener = originalRemoveListener;
  (process.stdin as any).resume = originalResume;
  (process.stdin as any).pause = originalPause;
  if (originalSetRawMode) stdin.setRawMode = originalSetRawMode;
  else Reflect.deleteProperty(stdin, 'setRawMode');
  if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  stdin.readableFlowing = originalFlowing;
});

describe('showSyncSelector TTY guard', () => {
  test('refuses non-TTY stdin before starting selection', async () => {
    setIsTTY(false);

    let message = '';
    try {
      await showSyncSelector();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('stdin TTY가 있는 자리에서만');
    expect(message).toContain('monad ask');
    expect(message).not.toContain('    at ');
    expect(rawModeCalls).toEqual([]);
    expect(listeners).toEqual([]);
  });

  test('starts the existing selection loop when stdin is a TTY', async () => {
    setIsTTY(true);

    const selection = showSyncSelector();
    await waitForListener();
    listeners[0]!('q');

    await expect(selection).resolves.toEqual({
      cancelled: true,
      skills: [],
      servers: [],
      services: [],
      mode: 'merge',
    });
    expect(rawModeCalls).toEqual([true]);
  });
});
