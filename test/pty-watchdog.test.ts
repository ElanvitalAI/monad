// ── V5 watchdog tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  startPtyWatchdog, stopPtyWatchdog, onPtyCompletion, resetPtyWatchdogForTesting,
  formatPtyCompletion, isPtyWatchdogActive, type PtyCompletion,
} from '../src/pty-shell/watchdog';
import {
  startPty, onPtyEvent, emitPtyEvent,
  setPtyAdapterForTesting, resetForTesting,
} from '../src/pty-shell/registry';

type FakePty = {
  pid: number;
  write: (s: string) => void;
  kill: (signal?: string) => void;
  onData: (cb: (d: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  _emit: (chunk: string) => void;
  _exit: (code: number, sig?: number) => void;
};

function installFakeAdapter(): () => FakePty[] {
  const handles: FakePty[] = [];
  setPtyAdapterForTesting(() => {
    let onData: ((d: string) => void) | null = null;
    let onExit: ((e: { exitCode: number; signal?: number }) => void) | null = null;
    const fake: FakePty = {
      pid: Math.floor(Math.random() * 1e6),
      write: () => {},
      kill: () => { onExit?.({ exitCode: 0 }); },
      onData(cb) { onData = cb; return { dispose: () => { onData = null; } }; },
      onExit(cb) { onExit = cb; return { dispose: () => { onExit = null; } }; },
      _emit: (c) => onData?.(c),
      _exit: (code, sig) => onExit?.({ exitCode: code, signal: sig }),
    };
    handles.push(fake);
    return fake;
  });
  return () => handles;
}

describe('PTY watchdog (V5)', () => {
  let adapters: () => FakePty[];

  beforeEach(() => {
    resetForTesting();
    resetPtyWatchdogForTesting();
    adapters = installFakeAdapter();
  });

  afterEach(() => {
    stopPtyWatchdog();
    resetForTesting();
    setPtyAdapterForTesting(null);
    resetPtyWatchdogForTesting();
  });

  test('isPtyWatchdogActive flips on start/stop', () => {
    expect(isPtyWatchdogActive()).toBe(false);
    const stop = startPtyWatchdog({ tickMs: 10000, stallMs: 60000 });
    expect(isPtyWatchdogActive()).toBe(true);
    stop();
    expect(isPtyWatchdogActive()).toBe(false);
  });

  test('completion listener fires with exitCode + signal + duration', () => {
    const completions: PtyCompletion[] = [];
    onPtyCompletion(info => completions.push(info));
    startPtyWatchdog({ tickMs: 100000 });
    const h = startPty({ cmd: 'sleep 1' });
    adapters()[0]!._exit(7, 15);
    expect(completions).toHaveLength(1);
    expect(completions[0]!.id).toBe(h.id);
    expect(completions[0]!.exitCode).toBe(7);
    expect(completions[0]!.signal).toBe(15);
    expect(completions[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(completions[0]!.stalledBefore).toBe(false);
  });

  test('completion reflects stalledBefore when watchdog fired stall first', async () => {
    const completions: PtyCompletion[] = [];
    onPtyCompletion(info => completions.push(info));
    startPtyWatchdog({ tickMs: 10, stallMs: 20 });
    startPty({ cmd: 'sleep 99' });
    // Wait longer than stallMs + one tick so the watchdog fires stalled.
    await new Promise(r => setTimeout(r, 60));
    adapters()[0]!._exit(0);
    expect(completions).toHaveLength(1);
    expect(completions[0]!.stalledBefore).toBe(true);
  });

  test('stalled event resets when output arrives', async () => {
    const stalledEvents: Array<{ id: string; silentMs: number }> = [];
    onPtyEvent(ev => { if (ev.type === 'stalled') stalledEvents.push({ id: ev.id, silentMs: ev.silentMs }); });
    startPtyWatchdog({ tickMs: 10, stallMs: 20 });
    startPty({ cmd: 'sleep 99' });
    await new Promise(r => setTimeout(r, 60));
    expect(stalledEvents).toHaveLength(1);

    // Output bumps lastOutputAt and clears the stall debounce.
    adapters()[0]!._emit('tick\n');
    // Now wait past the stall window again → second stalled event.
    await new Promise(r => setTimeout(r, 60));
    expect(stalledEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('stalled does NOT fire for exited PTYs', async () => {
    const stalledEvents: string[] = [];
    onPtyEvent(ev => { if (ev.type === 'stalled') stalledEvents.push(ev.id); });
    startPtyWatchdog({ tickMs: 10, stallMs: 20 });
    startPty({ cmd: 'sleep 1' });
    adapters()[0]!._exit(0);
    await new Promise(r => setTimeout(r, 80));
    expect(stalledEvents).toHaveLength(0);
  });

  test('stopPtyWatchdog stops ticks', async () => {
    const stalledEvents: string[] = [];
    onPtyEvent(ev => { if (ev.type === 'stalled') stalledEvents.push(ev.id); });
    startPtyWatchdog({ tickMs: 10, stallMs: 20 });
    startPty({ cmd: 'sleep 99' });
    stopPtyWatchdog();
    await new Promise(r => setTimeout(r, 80));
    expect(stalledEvents).toHaveLength(0);
  });

  test('startPtyWatchdog called twice keeps the listener wiring coherent', async () => {
    const completions: PtyCompletion[] = [];
    onPtyCompletion(info => completions.push(info));
    startPtyWatchdog({ tickMs: 10000 });
    startPtyWatchdog({ tickMs: 10000 }); // restart
    const h = startPty({ cmd: 'true' });
    adapters()[0]!._exit(0);
    expect(completions).toHaveLength(1);
    expect(completions[0]!.id).toBe(h.id);
  });

  test('throwing completion listener does not break others', () => {
    const delivered: string[] = [];
    onPtyCompletion(() => { throw new Error('boom'); });
    onPtyCompletion(info => delivered.push(info.id));
    startPtyWatchdog({ tickMs: 10000 });
    const h = startPty({ cmd: 'true' });
    adapters()[0]!._exit(0);
    expect(delivered).toEqual([h.id]);
  });

  test('formatPtyCompletion wording', () => {
    const now = Date.now();
    expect(formatPtyCompletion({
      id: 'pty_abc', exitCode: 0, signal: undefined,
      durationMs: 12_000, stalledBefore: false,
    })).toBe('⚡ pty_abc exited (code 0) after 12s');
    expect(formatPtyCompletion({
      id: 'pty_xyz', exitCode: null, signal: 15,
      durationMs: 125_000, stalledBefore: true,
    })).toBe('⚡ pty_xyz exited (signal SIGTERM) after 2m5s — was stalled');
    // ensure now is used elsewhere to keep linter happy
    void now;
  });

  test('emitPtyEvent from outside still reaches the watchdog tracker', () => {
    // This simulates what happens if some other code (tests, manual
    // fire) synthesizes a stalled event. The watchdog should NOT
    // barf — its listener only reacts to spawned/output/exit/unreg.
    startPtyWatchdog({ tickMs: 10000 });
    expect(() => {
      emitPtyEvent({ type: 'stalled', id: 'pty_fake', silentMs: 999 });
    }).not.toThrow();
  });
});
