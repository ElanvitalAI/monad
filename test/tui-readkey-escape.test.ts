import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { closeTui, initTui, KeyStreamParser, readKey, splitKeys, type Key } from '../src/tui.js';
import { routeStreamingEscapeKey } from '../src/esc-abort-gate.js';
import { simEscGate } from '../src/ux-sim/interaction.js';

// These tests drive the REAL `readKey` path (stdin 'data' events through
// the module-level parser + escape-flush timer), not `KeyStreamParser`
// in isolation. The 2026-07-29 regression lived entirely in readKey's
// timer wiring: it cleared the escape-flush timer on each data event
// but never re-armed it, so a lone ESC that splitKeys left pending was
// swallowed (resolved as an empty key) and the ESC lingered in the
// shared parser, mis-combining with the next byte into a phantom Alt
// chord. flush()/flushEscape() called directly bypass that wiring, so
// only a stdin-driven test can guard it.

function waitForStdinReader(): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tick = () => {
      if (process.stdin.listenerCount('data') > 0) { resolve(); return; }
      if (attempt++ > 200) { reject(new Error('readKey did not attach a stdin data listener')); return; }
      setTimeout(tick, 1);
    };
    tick();
  });
}

describe('KeyStreamParser repeated Escape boundaries', () => {
  const names = (keys: Key[]) => keys.map((key) => key.name);

  test('emits each same-chunk Escape separately and keeps the final Escape pending', () => {
    const parser = new KeyStreamParser();
    expect(names(parser.push('\x1b\x1b'))).toEqual(['escape']);
    expect(names(parser.flushEscape())).toEqual(['escape']);
    expect(names(splitKeys('\x1b\x1b'))).toEqual(['escape', 'escape']);
  });

  test('emits repeated Escape across chunks without a quiet-window flush', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b')).toEqual([]);
    expect(names(parser.push('\x1b'))).toEqual(['escape']);
    expect(names(parser.flushEscape())).toEqual(['escape']);
  });

  test('preserves CSI after an Escape run and keeps single Escape, CSI, and Alt parsing', () => {
    const parser = new KeyStreamParser();
    expect(names(parser.push('\x1b\x1b[A'))).toEqual(['escape', 'up']);
    expect(names(splitKeys('\x1b\x1b[A'))).toEqual(['escape', 'up']);

    const loneEscape = new KeyStreamParser();
    loneEscape.push('\x1b');
    expect(names(loneEscape.flushEscape())).toEqual(['escape']);
    expect(names(new KeyStreamParser().push('\x1b[A'))).toEqual(['up']);
    const [altA] = new KeyStreamParser().push('\x1ba');
    expect(altA).toMatchObject({ name: 'a', alt: true });
  });

  for (const presses of [2, 4]) {
    test(`routes ${presses} parsed Escape presses through the real abort gate`, async () => {
      const parser = new KeyStreamParser();
      const sim = simEscGate({ runningChildren: 1 });
      const keys = [...parser.push('\x1b'.repeat(presses)), ...parser.flushEscape()];

      for (const key of keys) {
        await routeStreamingEscapeKey(key, sim.gate, { name: key.name } as never, async () => false);
      }
      await sim.settle();
      expect(sim.abortCtrl.signal.aborted).toBe(true);
    });
  }
});

describe('readKey standalone Escape (real stdin path)', () => {
  let stdin: { setRawMode?: (mode: boolean) => unknown };
  let originalIsTTY: PropertyDescriptor | undefined;
  let originalSetRawMode: ((mode: boolean) => unknown) | undefined;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => unknown };
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    originalSetRawMode = stdin.setRawMode;
    originalWrite = process.stdout.write.bind(process.stdout);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (() => true) as typeof process.stdout.write;
    initTui(false);
  });

  afterEach(() => {
    closeTui();
    (process.stdout.write as typeof process.stdout.write) = originalWrite;
    if (originalSetRawMode) stdin.setRawMode = originalSetRawMode;
    else Reflect.deleteProperty(stdin, 'setRawMode');
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  test('resolves a lone ESC as Escape within the quiet window', async () => {
    const pending = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('\x1b'));

    const key = await pending;
    expect(key.name).toBe('escape');
  });

  test('closeTui discards a pending stdin CSI before the next TUI session', async () => {
    const pending = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('\x1b['));

    closeTui();
    initTui(false);
    const next = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('x'));

    expect(await pending).toEqual({ name: '', ctrl: false, shift: false });
    const key = await next;
    expect(key.name).toBe('x');
    expect(key.alt).toBeFalsy();
  });

  test('a lone ESC does not stall the NEXT readKey — the next key is delivered clean', async () => {
    const first = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('\x1b'));
    expect((await first).name).toBe('escape');

    // A plain key arriving AFTER the ESC has flushed must be itself,
    // never a delayed Alt combo (the regression's second symptom).
    const second = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('x'));
    const key = await second;
    expect(key.name).toBe('x');
    expect(key.alt).toBeFalsy();
  });

  test('ESC immediately followed by a byte is one Alt combo, not two keys', async () => {
    const pending = readKey();
    await waitForStdinReader();
    // Both bytes in the same chunk — a genuine Alt+x, must not flush ESC.
    process.stdin.emit('data', Buffer.from('\x1bx'));

    const key = await pending;
    expect(key.name).toBe('x');
    expect(key.alt).toBe(true);
  });

  test('a CSI arrow split across chunks is not misread as Escape', async () => {
    const pending = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('\x1b'));
    // The remainder lands within the quiet window — must complete the
    // arrow, never flush a spurious Escape.
    process.stdin.emit('data', Buffer.from('[A'));

    const key = await pending;
    expect(key.name).toBe('up');
  });

  test('bracketed paste through readKey is a single paste key, no Enter', async () => {
    const traced: Key[] = [];
    const pending = readKey();
    await waitForStdinReader();
    process.stdin.emit('data', Buffer.from('\x1b[200~L1\nL2\x1b[201~'));

    const key = await pending;
    traced.push(key);
    expect(key.name).toBe('paste');
    expect(key.paste).toBe('L1\nL2');
    expect(traced.filter((k) => k.name === 'enter')).toHaveLength(0);
  });
});
