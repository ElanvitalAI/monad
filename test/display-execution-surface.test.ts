import { describe, expect, test } from 'bun:test';
import {
  createDisplayEventBus,
  createExecutionSurface,
  keyEventToTerminalBytes,
  type DisplayCommand,
  type DisplayEvent,
  type DisplayHandle,
  type ExecutionTerminal,
} from '../src/display/index.js';
import type { PreviewTerminalOpts } from '../src/preview/terminal.js';

class FakeTerminal implements ExecutionTerminal {
  started = false;
  stopped = false;
  writes: string[] = [];
  sizes: Array<{ cols: number; rows: number }> = [];
  constructor(readonly opts: PreviewTerminalOpts) {}
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
  resize(cols: number, rows: number): void { this.sizes.push({ cols, rows }); }
  write(bytes: string): void { this.writes.push(bytes); }
  render(focused = false): string { return focused ? 'focused\nterm' : 'term'; }
  get isAlive(): boolean { return this.started && !this.stopped; }
}

function fakeDisplay(): DisplayHandle & { commands: DisplayCommand[]; renders: unknown[]; focuses: string[] } {
  const commands: DisplayCommand[] = [];
  const renders: unknown[] = [];
  const focuses: string[] = [];
  return {
    owner: 'plugin:demo',
    commands,
    renders,
    focuses,
    publish: (cmd) => { commands.push(cmd); },
    requestRender: (opts) => { renders.push(opts); },
    focus: (target) => { focuses.push(target); },
    currentFocus: () => null,
    cycleFocus: () => null,
    registerFocus: () => ({ dispose: () => {} }),
    registerKey: () => ({ dispose: () => {} }),
  };
}

describe('execution surface factory', () => {
  test('start publishes an execution surface and focuses it by default', () => {
    const display = fakeDisplay();
    let terminal: FakeTerminal | null = null;
    const handle = createExecutionSurface({
      id: 'execution:test',
      cwd: '/tmp',
      command: 'echo hello',
      cols: 40,
      rows: 8,
    }, {
      display,
      terminalFactory: (opts) => {
        terminal = new FakeTerminal(opts);
        return terminal;
      },
    });

    handle.start();

    expect(terminal?.started).toBe(true);
    expect(terminal?.writes).toEqual(['echo hello\r']);
    expect(display.commands[0]).toMatchObject({
      type: 'upsertSurface',
      surface: { id: 'execution:test', kind: 'execution', owner: 'plugin:demo' },
    });
    expect(display.focuses).toEqual(['execution:test']);
  });

  test('render resizes terminal and splits terminal output into lines', () => {
    const display = fakeDisplay();
    let terminal: FakeTerminal | null = null;
    const handle = createExecutionSurface({ id: 'execution:test', cwd: '/tmp' }, {
      display,
      terminalFactory: (opts) => {
        terminal = new FakeTerminal(opts);
        return terminal;
      },
    });

    expect(handle.render({ width: 12, height: 3, focused: true })).toEqual(['focused', 'term']);
    expect(terminal?.sizes).toEqual([{ cols: 12, rows: 3 }]);
  });

  test('surface key handler writes terminal bytes and requests refresh action', () => {
    const display = fakeDisplay();
    let terminal: FakeTerminal | null = null;
    const handle = createExecutionSurface({ id: 'execution:test', cwd: '/tmp' }, {
      display,
      terminalFactory: (opts) => {
        terminal = new FakeTerminal(opts);
        return terminal;
      },
    });

    expect(handle.surface.onKey?.({ name: 'enter' })).toEqual({ type: 'refresh' });
    expect(terminal?.writes).toEqual(['\r']);
  });

  test('surface key handler closes on execution stop chord', () => {
    const display = fakeDisplay();
    const handle = createExecutionSurface({ id: 'execution:test', cwd: '/tmp' }, {
      display,
      terminalFactory: (opts) => new FakeTerminal(opts),
    });

    expect(handle.surface.onKey?.({ name: 't', ctrl: true, shift: true })).toEqual({ type: 'refresh' });
    expect(display.commands.at(-1)).toEqual({ type: 'closeSurface', id: 'execution:test' });
  });

  test('stop closes the surface and disposes the terminal through coordinator', () => {
    const display = fakeDisplay();
    let terminal: FakeTerminal | null = null;
    const handle = createExecutionSurface({ id: 'execution:test', cwd: '/tmp' }, {
      display,
      terminalFactory: (opts) => {
        terminal = new FakeTerminal(opts);
        return terminal;
      },
    });

    handle.start();
    handle.stop();

    expect(display.commands.at(-1)).toEqual({ type: 'closeSurface', id: 'execution:test' });
    expect(terminal?.stopped).toBe(false);
    handle.surface.dispose?.();
    expect(terminal?.stopped).toBe(true);
  });

  test('keyEventToTerminalBytes maps common terminal input', () => {
    expect(keyEventToTerminalBytes({ name: 'enter' })).toBe('\r');
    expect(keyEventToTerminalBytes({ name: 'tab', shift: true })).toBe('\x1b[Z');
    expect(keyEventToTerminalBytes({ name: 'backspace' })).toBe('\x7f');
    expect(keyEventToTerminalBytes({ name: 'up' })).toBe('\x1b[A');
    expect(keyEventToTerminalBytes({ name: 'c', ctrl: true })).toBe('\x03');
    expect(keyEventToTerminalBytes({ name: 'x', shift: true })).toBe('X');
    expect(keyEventToTerminalBytes({ name: 'f1' })).toBeNull();
  });

  // Regression: an earlier version returned `ev.sequence` first if
  // it was set, which forwarded raw kitty CSI-u bytes (e.g.
  // `ESC[108;5u` for Ctrl+L on ghostty) to the spawned PTY. The
  // child shell does not have kitty mode enabled so it printed
  // `643;5u` / `108;5u` as text instead of clearing the screen.
  // Semantic translation (ctrl-letter → 0x01..0x1A) must win over
  // the raw sequence fallback.
  test('ctrl+letter prefers semantic byte even when sequence is set (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'l', ctrl: true, sequence: '\x1b[108;5u',
    })).toBe('\x0c');
    expect(keyEventToTerminalBytes({
      name: 'c', ctrl: true, sequence: '\x1b[99;5u',
    })).toBe('\x03');
    expect(keyEventToTerminalBytes({
      name: 'a', ctrl: true, sequence: '\x1b[97;5u',
    })).toBe('\x01');
  });

  test('arrow keys prefer semantic CSI even when sequence is set (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'up', sequence: '\x1b[1;1u',
    })).toBe('\x1b[A');
    expect(keyEventToTerminalBytes({
      name: 'enter', sequence: '\x1b[13u',
    })).toBe('\r');
  });

  test('falls back to raw sequence only when no semantic mapping', () => {
    // F-key / kitty-only key with no semantic translation — pass
    // the raw bytes through so the child can decide what to do.
    expect(keyEventToTerminalBytes({
      name: 'f5', sequence: '\x1b[15~',
    })).toBe('\x1b[15~');
  });

  // Regression: mouse events arrive at the modal's onKey via input-core
  // dispatch passthrough with `name: 'mouse'` and a raw SGR 1006
  // sequence on `ev.sequence` (e.g. `ESC[<0;55;36M` for a left
  // click). If we forwarded those bytes to a child shell that has
  // NOT enabled DECSET 1000/1002/1003, the bytes printed as text
  // (`[<0;55;36M`). Drop mouse events here; proper mouse forwarding
  // is a separate path that gates on `tterm.wantsMouse`.
  test('mouse events are dropped (no raw SGR leak to child PTY) (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'mouse', sequence: '\x1b[<0;55;36M',
    })).toBeNull();
    expect(keyEventToTerminalBytes({
      name: 'mouse', sequence: '\x1b[<64;38;46M',  // scroll-up
    })).toBeNull();
    expect(keyEventToTerminalBytes({
      name: 'mouse', sequence: '\x1b[<0;1;1m',  // release
    })).toBeNull();
  });

  // Regression: tui.parseKey() returns K('') (empty name, no
  // mouse field) for some SGR mouse events it doesn't model
  // explicitly — observed for right-click release
  // (`ESC[<2;col;rowm`) and drag-end variants. These slip past
  // the `name === 'mouse'` early-return and would leak via the
  // raw-sequence fallback. The SGR 1006 mouse-shape regex catches
  // them.
  test('empty-named SGR mouse sequences are dropped (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: '', sequence: '\x1b[<2;74;31m',  // right-click release
    })).toBeNull();
    expect(keyEventToTerminalBytes({
      name: '', sequence: '\x1b[<2;74;31M',  // right-click press w/ no name (defensive)
    })).toBeNull();
    expect(keyEventToTerminalBytes({
      name: '', sequence: '\x1b[<34;48;32M',  // drag-motion variant
    })).toBeNull();
  });

  test('non-mouse sequences with empty name still pass through', () => {
    // Defensive: ensure the SGR-mouse drop regex doesn't over-match.
    // F-keys / arbitrary CSI sequences must still flow through as
    // raw bytes when there's no semantic mapping.
    expect(keyEventToTerminalBytes({
      name: '', sequence: '\x1b[15~',  // F5
    })).toBe('\x1b[15~');
    expect(keyEventToTerminalBytes({
      name: '', sequence: '\x1b[1;5A',  // Ctrl+Up (modifyOtherKeys legacy)
    })).toBe('\x1b[1;5A');
  });

  // Regression: ghostty `macos-option-as-alt = left` (or any setting
  // that enables alt-as-esc-prefix) produces Alt+letter as either
  // kitty CSI-u (`\x1b[97;3u` for Alt+a) or legacy ESC-prefix
  // (`\x1b a`). elanous's tui.parseKey now decodes both into a Key with
  // alt=true; the encoder must turn that back into the canonical
  // ESC+<letter> sequence so non-kitty PTY children (claude / codex /
  // plain shell readline) see Alt as expected. Previously the alt bit
  // was dropped at decodeModifier, so Alt+letter just emitted the
  // bare letter — Alt+f / Alt+b (readline word motion), Alt+. (last
  // arg) silently broke.
  test('alt+letter emits ESC+<letter> (regression — ghostty alt-esc-prefix)', () => {
    expect(keyEventToTerminalBytes({
      name: 'a', alt: true, sequence: '\x1b[97;3u',
    })).toBe('\x1ba');
    expect(keyEventToTerminalBytes({
      name: 'f', alt: true, sequence: '\x1b[102;3u',
    })).toBe('\x1bf');
    expect(keyEventToTerminalBytes({
      name: 'b', alt: true, sequence: '\x1b[98;3u',
    })).toBe('\x1bb');
    // Alt+Shift+letter — emit ESC + uppercase.
    expect(keyEventToTerminalBytes({
      name: 'a', alt: true, shift: true, sequence: '\x1b[97;4u',
    })).toBe('\x1bA');
    // Alt+digit / Alt+symbol — same encoding pattern.
    expect(keyEventToTerminalBytes({
      name: '5', alt: true, sequence: '\x1b[53;3u',
    })).toBe('\x1b5');
    expect(keyEventToTerminalBytes({
      name: '.', alt: true, sequence: '\x1b[46;3u',
    })).toBe('\x1b.');
  });

  // Regression: Ctrl+Alt+letter — ESC + ctrl-byte (legacy encoding).
  // Without the alt-aware branch added next to the ctrl-letter
  // decode, the ctrl-letter return would emit just the ctrl byte
  // (\x06 for Ctrl+Alt+f), losing the alt info. Children that bind
  // Ctrl+Alt+f (some readline variants, tmux configs) wouldn't see it.
  test('ctrl+alt+letter emits ESC + ctrl-byte (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'f', ctrl: true, alt: true, sequence: '\x1b[102;7u',
    })).toBe('\x1b\x06');
    expect(keyEventToTerminalBytes({
      name: 'a', ctrl: true, alt: true, sequence: '\x1b[97;7u',
    })).toBe('\x1b\x01');
  });

  // Regression: pasting uppercase text via Cmd+V into the popup
  // terminal modal forwarded lowercase letters to the child PTY.
  // tui.splitKeys() shreds the paste body into per-char Keys; for
  // 'A', tui.parseKey()'s plain-text branch (`return K(s)`) yields
  // `{ name: 'A', shift: false }` because the clipboard is not a
  // keyboard and no shift bit is synthesized. Line 232's
  // `name.toLowerCase()` then clobbers the case, and the
  // shift-or-lower emit forwards 'a'. Bug observed as `isTTY`
  // pasting as `istty`. Fix: when ev.sequence carries the original
  // byte and differs from `name` only by case, prefer it.
  test('paste of uppercase letter preserves case (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'A', shift: false, sequence: 'A',
    })).toBe('A');
    expect(keyEventToTerminalBytes({
      name: 'B', shift: false, sequence: 'B',
    })).toBe('B');
    // Lowercase paste — sequence equals name, the guard's `!==`
    // arm short-circuits, falls through to the normal emit.
    expect(keyEventToTerminalBytes({
      name: 'a', shift: false, sequence: 'a',
    })).toBe('a');
    // Digits / symbols (case-insensitive codepoints) — guard's
    // `toLowerCase === name` check resolves to equality, but
    // `!==` arm rejects, falls through.
    expect(keyEventToTerminalBytes({
      name: '5', shift: false, sequence: '5',
    })).toBe('5');
  });

  // Regression: Korean IME jamo must NOT be rerouted by the
  // case-preserve guard. tui.parseKey() rewrites 'ㅂ' (Hangul
  // Compatibility Jamo) to K('q', false, false) and stashes the
  // original 'ㅂ' on key.raw → ev.sequence. The Korean→English
  // remap is the WHOLE POINT of that branch — we must keep
  // forwarding 'q' to the child PTY, not 'ㅂ'. Guard rejects
  // because `'ㅂ'.toLowerCase() !== 'q'`.
  test('korean IME remap keeps forwarding english key (regression)', () => {
    expect(keyEventToTerminalBytes({
      name: 'q', shift: false, sequence: 'ㅂ',
    })).toBe('q');
    expect(keyEventToTerminalBytes({
      name: 'a', shift: false, sequence: 'ㅁ',
    })).toBe('a');
    // Shifted Korean: K('q', false, true) with raw='ㅃ'. Guard's
    // `sequence.toLowerCase() !== name` arm rejects → falls
    // through to shift-or-lower emit → 'Q'.
    expect(keyEventToTerminalBytes({
      name: 'q', shift: true, sequence: 'ㅃ',
    })).toBe('Q');
  });

  // Defensive: kitty CSI-u Shift+A arrives as
  // K('A', false, true) with raw='\x1b[65;2u'. The case-preserve
  // guard checks sequence.length === 1, which the multi-char
  // kitty bytes fail, so the path falls through to the normal
  // shift-or-lower emit → 'A'. This test ensures the guard
  // doesn't accidentally re-fire for kitty paths.
  test('kitty Shift+letter still emits via shift bit, not sequence', () => {
    expect(keyEventToTerminalBytes({
      name: 'A', shift: true, sequence: '\x1b[65;2u',
    })).toBe('A');
  });

  test('emits execution:update lifecycle events', () => {
    const display = fakeDisplay();
    const events = createDisplayEventBus();
    const seen: DisplayEvent[] = [];
    events.subscribe('execution:update', event => seen.push(event));
    let terminal: FakeTerminal | null = null;
    const handle = createExecutionSurface({
      id: 'execution:test',
      cwd: '/tmp',
      command: 'echo hi',
      placement: 'preview',
    }, {
      display,
      events,
      terminalFactory: (opts) => {
        terminal = new FakeTerminal(opts);
        return terminal;
      },
    });

    handle.start();
    terminal?.opts.onUpdate?.();
    handle.write('x');
    handle.resize(20, 5);
    terminal?.opts.onExit?.(7);
    handle.stop();

    expect(seen.map(event => event.status)).toEqual([
      'running',
      'output',
      'input',
      'resized',
      'exited',
      'stopped',
    ]);
    expect(seen[0]).toMatchObject({
      type: 'execution:update',
      id: 'execution:test',
      payload: { cwd: '/tmp', command: 'echo hi', placement: 'preview' },
    });
    expect(seen[4]).toMatchObject({ payload: { code: 7 } });
  });
});
