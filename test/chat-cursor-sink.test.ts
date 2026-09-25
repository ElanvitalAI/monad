// P2.2.c — assert that textInput, when given a cursorSink, routes
// caret placement through it instead of writing raw `\x1b[r;cH` to
// stdout. Foundation test: a fake CursorSink replaces the
// coordinator and we observe the call.

import { describe, expect, test } from 'bun:test';
import type { CursorState } from '../src/display/cursor-state.js';
import type { CursorSink } from '../src/chat/index.js';
import { beginTextInputCursor, endTextInputCursor, hideTextInputCursor, textInput } from '../src/chat/index.js';
import { stripAnsi, visibleWidth } from '../src/tui.js';

// We don't drive the full TTY loop here — that requires a real
// terminal. Instead we exercise the small structural contract:
// CursorSink is a 1-method interface; if a coordinator implements
// setCursor(state | null), the textInput uses it. The full
// integration is covered by display-coordinator tests + a
// behavior-flag mock here.

describe('CursorSink — structural contract', () => {
  test('DisplayCoordinator implements the CursorSink shape', async () => {
    const { DisplayCoordinator } = await import('../src/display/coordinator.js');
    const c = new DisplayCoordinator({ frameMs: 16, schedule: (fn) => { fn(); return 0 as any; } });
    // Compile-time: the assignment below would fail typecheck if
    // DisplayCoordinator weren't a CursorSink.
    const sink: CursorSink = c;
    sink.setCursor({ row: 5, col: 5, visible: true });
    expect(c.getCursor()).toEqual({ row: 5, col: 5, visible: true });
    sink.setCursor(null);
    expect(c.getCursor()).toBeNull();
  });
});

describe('cursorSink wiring — captured calls', () => {
  test('a fake sink records every setCursor call', () => {
    const calls: Array<CursorState | null> = [];
    const sink: CursorSink = {
      setCursor: (s) => { calls.push(s ? { ...s } : null); },
    };
    sink.setCursor({ row: 1, col: 1, visible: true });
    sink.setCursor({ row: 2, col: 8, visible: true });
    sink.setCursor(null);
    expect(calls).toEqual([
      { row: 1, col: 1, visible: true },
      { row: 2, col: 8, visible: true },
      null,
    ]);
  });

  test('chat.ts re-exports CursorSink so dashboard can compose without circular import', async () => {
    // Sanity: CursorSink is a value/type re-exportable from chat.ts.
    // The import at the top of this file proves the type is exported;
    // here we also exercise the runtime side (no value, type-only).
    const mod = await import('../src/chat/index.js');
    expect(typeof mod.textInput).toBe('function');
  });

  test('text input re-reads its row for resized input and cursor paints', async () => {
    const calls: Array<CursorState | null> = [];
    let row = 40;
    const keys = [
      { name: 'a', ctrl: false, shift: false },
      { name: 'b', ctrl: false, shift: false },
      { name: 'enter', ctrl: false, shift: false },
    ];
    const result = await textInput({
      row,
      getRow: () => row,
      col: 1,
      width: 40,
      cursorSink: { setCursor: (state) => calls.push(state ? { ...state } : null) },
      readKey: async () => {
        const key = keys.shift()!;
        if (key.name === 'a') row = 28;
        if (key.name === 'b') row = 40;
        return key;
      },
    });

    expect(result).toEqual({ text: 'ab', submitted: true });
    expect(calls).toContainEqual({ row: 28, col: 4, visible: true });
    expect(calls).toContainEqual({ row: 40, col: 5, visible: true });
  });

  test('clips an ANSI-styled placeholder to a narrow input line without moving the empty cursor', async () => {
    const writes: string[] = [];
    const calls: Array<CursorState | null> = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const keys = [{ name: 'enter', ctrl: false, shift: false }];
    (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await expect(textInput({
        row: 3,
        col: 1,
        width: 8,
        placeholder: '한글 placeholder that must not wrap',
        cursorSink: { setCursor: (state) => calls.push(state ? { ...state } : null) },
        readKey: async () => keys.shift()!,
      })).resolves.toEqual({ text: '', submitted: true });
    } finally {
      (process.stdout.write as typeof process.stdout.write) = originalWrite;
    }

    const inputRow = writes.find((write) => write.includes('\x1b[3;1H'))!;
    const rendered = inputRow.slice(inputRow.indexOf('\x1b[2K') + 4);
    expect(visibleWidth(rendered)).toBeLessThanOrEqual(7);
    expect(stripAnsi(rendered)).toBe('❯ 한글…');
    expect(rendered).toContain('\x1b[0m');
    expect(calls).toContainEqual({ row: 3, col: 3, visible: true });
  });

  test('text input cursor helpers defer show/hide ownership to sink', () => {
    const calls: Array<CursorState | null> = [];
    const sink: CursorSink = {
      setCursor: (s) => { calls.push(s ? { ...s } : null); },
    };

    expect(beginTextInputCursor(sink)).toBe('\x1b[>1u\x1b[>4;2m');
    expect(calls).toEqual([]);

    expect(hideTextInputCursor(sink)).toBe('');
    expect(calls).toEqual([null]);

    expect(endTextInputCursor(sink)).toBe('\x1b[<u\x1b[>4;0m');
    expect(calls).toEqual([null, null]);
  });

  test('text input cursor helpers preserve legacy direct-write escapes without a sink', () => {
    expect(beginTextInputCursor()).toBe('\x1b[?25h\x1b[>1u\x1b[>4;2m');
    expect(hideTextInputCursor()).toBe('\x1b[?25l');
    expect(endTextInputCursor()).toBe('\x1b[?25l\x1b[<u\x1b[>4;0m');
  });
});

describe('coordinator emits cursor on first setCursor (no scheduled frame)', () => {
  test('writeCursor sees the ANSI byte sequence immediately', async () => {
    const { DisplayCoordinator } = await import('../src/display/coordinator.js');
    const written: string[] = [];
    const scheduled: Array<() => void> = [];
    const c = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      writeCursor: (s) => written.push(s),
    });
    const sink: CursorSink = c;
    sink.setCursor({ row: 12, col: 3, visible: true });
    expect(written).toEqual(['\x1b[12;3H\x1b[?25h']);
    expect(scheduled.length).toBe(0);  // bypassed batch
  });

  test('with a frame scheduled, cursor defers to flush — single combined emit', async () => {
    const { DisplayCoordinator } = await import('../src/display/coordinator.js');
    const written: string[] = [];
    const scheduled: Array<() => void> = [];
    const c = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      onRender: () => {},
      writeCursor: (s) => written.push(s),
    });
    c.publish({ type: 'requestRender', region: 'pane:log' });
    (c as unknown as CursorSink).setCursor({ row: 3, col: 3, visible: true });
    expect(written).toEqual([]);    // deferred
    scheduled.forEach(fn => fn());
    expect(written).toEqual(['\x1b[3;3H\x1b[?25h']);
  });

  test('dirty cursor claim with no scheduled frame schedules a flush instead of stranding the caret', async () => {
    const { DisplayCoordinator } = await import('../src/display/coordinator.js');
    const written: string[] = [];
    const scheduled: Array<() => void> = [];
    const c = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      onRender: () => {},
      writeCursor: (s) => written.push(s),
    });

    ((c as unknown as { dirty: Set<string> }).dirty).add('all');
    (c as unknown as CursorSink).setCursor({ row: 50, col: 3, visible: true });

    expect(written).toEqual([]);
    expect(scheduled.length).toBe(1);

    scheduled.forEach(fn => fn());
    expect(written).toEqual(['\x1b[50;3H\x1b[?25h']);
  });
});
