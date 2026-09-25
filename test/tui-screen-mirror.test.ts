// Full-fidelity TUI screen mirror (PLAN P1b-2). Taps a write stream,
// feeds an @xterm/headless emulator, renders the composited grid. The
// critical contract: the tap NEVER corrupts/drops the real write, and
// stop() restores the original write.

import { describe, expect, test } from 'bun:test';
import { createTuiScreenMirror } from '../src/capture/tui-screen-mirror.js';

/** A fake stdout-ish stream that records what the real write received. */
function fakeStream() {
  const written: string[] = [];
  return {
    written,
    write: (...args: unknown[]): boolean => {
      const c = args[0];
      written.push(typeof c === 'string' ? c : String(c));
      return true;
    },
  };
}

describe('createTuiScreenMirror · tap fidelity', () => {
  test('every write still reaches the ORIGINAL stream (tap never drops output)', () => {
    const stream = fakeStream();
    const m = createTuiScreenMirror({ cols: 40, rows: 10, stream })!;
    stream.write('hello');
    stream.write(' world');
    expect(stream.written).toEqual(['hello', ' world']);   // real output intact
    m.stop();
  });

  test('renderScreen reflects composited bytes (base + later overwrite)', async () => {
    const stream = fakeStream();
    const m = createTuiScreenMirror({ cols: 20, rows: 5, stream })!;
    // Write a base line, then position + overwrite (an "overlay") — the
    // emulator composites them exactly like a real terminal.
    stream.write('\x1b[H');            // cursor home
    stream.write('base line here');
    stream.write('\x1b[1;1H');         // back to row1 col1
    stream.write('OVL');               // overwrite first 3 cells
    await m.flush();                   // drain xterm's async parse queue
    const screen = m.renderScreen();
    expect(screen.split('\n')[0]).toBe('OVLe line here');   // overlay composited over base
    m.stop();
  });

  test('stop() restores the original write + is idempotent', () => {
    const stream = fakeStream();
    const original = stream.write;
    const m = createTuiScreenMirror({ cols: 10, rows: 3, stream })!;
    expect(stream.write).not.toBe(original);   // tapped
    m.stop();
    expect(stream.write).toBe(original);       // restored
    m.stop();                                  // idempotent — no throw
  });

  test('a feed error never breaks the real write', () => {
    const stream = fakeStream();
    const m = createTuiScreenMirror({ cols: 10, rows: 3, stream })!;
    // Even a pathological chunk (object w/o toString-to-string) must not throw.
    expect(() => stream.write({ weird: true } as unknown as string)).not.toThrow();
    m.stop();
  });

  test('resize changes emulator dims', () => {
    const stream = fakeStream();
    const m = createTuiScreenMirror({ cols: 10, rows: 3, stream })!;
    m.resize(80, 24);
    expect(m.dims()).toEqual({ cols: 80, rows: 24 });
    m.stop();
  });
});
