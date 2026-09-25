import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { attachStreamingKeys, textInput } from '../src/chat/index.js';
import { debug } from '../src/debug/log.js';
import { closeTui, initTui, readKey, setKeyTracer, traceKey, type Key, type KeyTraceSource } from '../src/tui.js';

type Trace = { source: KeyTraceSource; name: string };

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
let resumeCalls: number;
let pauseCalls: number;

function installTracer(traces: Trace[]): void {
  setKeyTracer((key, source) => {
    traces.push({ source, name: key.name });
  });
}

async function waitForListener(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (listeners.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('stdin listener did not attach');
}

beforeEach(() => {
  debug.setKeyTraceEnabled(true);
  listeners = [];
  resumeCalls = 0;
  pauseCalls = 0;
  originalOn = process.stdin.on.bind(process.stdin);
  originalRemoveListener = process.stdin.removeListener.bind(process.stdin);
  originalResume = process.stdin.resume.bind(process.stdin);
  originalPause = process.stdin.pause.bind(process.stdin);
  originalSetRawMode = stdin.setRawMode;
  originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  originalFlowing = stdin.readableFlowing;
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  stdin.setRawMode = () => stdin;
  (process.stdin as any).on = (event: string, listener: (data: string | Buffer) => void) => {
    if (event === 'data') listeners.push(listener);
    return process.stdin;
  };
  (process.stdin as any).removeListener = (event: string, listener: (data: string | Buffer) => void) => {
    if (event === 'data') listeners = listeners.filter((candidate) => candidate !== listener);
    return process.stdin;
  };
  (process.stdin as any).resume = () => { resumeCalls++; stdin.readableFlowing = true; return process.stdin; };
  (process.stdin as any).pause = () => { pauseCalls++; stdin.readableFlowing = false; return process.stdin; };
  stdin.readableFlowing = false;
  initTui(false);
  stdin.readableFlowing = false;
  resumeCalls = 0;
});

afterEach(() => {
  debug.setKeyTraceEnabled(false);
  setKeyTracer(null);
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

describe('key path tracing', () => {
  test('records main and textInput reader attach, key, and detach lifecycles in order', async () => {
    const traces: Trace[] = [];
    installTracer(traces);

    const main = readKey();
    await waitForListener();
    listeners[0]!('m');
    expect((await main).name).toBe('m');

    const input = textInput({ row: 1, col: 1, width: 20 });
    await waitForListener();
    listeners[0]!('i');
    await waitForListener();
    listeners[0]!('\r');
    expect((await input).text).toBe('i');

    expect(traces).toEqual([
      { source: 'main', name: 'listener-attach-paused' },
      { source: 'main', name: 'listener-detach-flowing' },
      { source: 'main', name: 'm' },
      { source: 'input', name: 'listener-attach-paused' },
      { source: 'input', name: 'listener-detach-flowing' },
      { source: 'input', name: 'i' },
      { source: 'input', name: 'listener-attach-paused' },
      { source: 'input', name: 'listener-detach-flowing' },
      { source: 'input', name: 'enter' },
    ]);
  });

  test('records streaming attach, key, and detach while leaving paused stdin paused', () => {
    const traces: Trace[] = [];
    const received: string[] = [];
    installTracer(traces);

    const cleanup = attachStreamingKeys((key) => { received.push(key.name); });
    expect(resumeCalls).toBe(1);
    expect(stdin.readableFlowing).toBe(true);
    expect(traces).toEqual([{ source: 'stream', name: 'listener-attach-flowing' }]);

    listeners[0]!('s');
    cleanup();

    expect(received).toEqual(['s']);
    expect(traces).toEqual([
      { source: 'stream', name: 'listener-attach-flowing' },
      { source: 'stream', name: 's' },
      { source: 'stream', name: 'listener-detach-flowing' },
    ]);
    expect(pauseCalls).toBe(1);
    expect(stdin.readableFlowing).toBe(false);

    const negativeTwinListener = () => {};
    const negativeTwinCleanup = () => {
      process.stdin.removeListener('data', negativeTwinListener);
    };
    process.stdin.on('data', negativeTwinListener);
    process.stdin.resume();
    negativeTwinCleanup();
    expect(() => expect(stdin.readableFlowing).toBe(false)).toThrow();
  });

  test('does not allocate lifecycle traces when a tracer is installed but keytrace is disabled', async () => {
    const traces: Trace[] = [];
    installTracer(traces);
    debug.setKeyTraceEnabled(false);

    const pending = readKey();
    await waitForListener();
    listeners[0]!('x');
    expect((await pending).name).toBe('x');
    expect(traces).toEqual([{ source: 'main', name: 'x' }]);
  });

  test('does not invoke a removed tracer and swallows a throwing tracer without blocking keys', async () => {
    const key: Key = { name: 'x', ctrl: false, shift: false };
    let calls = 0;
    setKeyTracer(() => { calls++; throw new Error('diagnostic failure'); });
    traceKey(key, 'main');
    expect(calls).toBe(1);

    const pending = readKey();
    await waitForListener();
    listeners[0]!('x');
    expect((await pending).name).toBe('x');
    expect(calls).toBeGreaterThan(1);

    setKeyTracer(null);
    const callsBeforeDisabledTrace = calls;
    traceKey(key, 'main');
    expect(calls).toBe(callsBeforeDisabledTrace);
  });
});
