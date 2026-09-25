import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

import { splitKeys, setKeyTracer, traceKey } from '../src/tui.js';
import type { Key } from '../src/tui.js';

// ── splitKeys ────────────────────────────────────────────────────
describe('splitKeys', () => {
  test('parses a single printable char', () => {
    const keys = splitKeys('j');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('j');
  });

  test('parses two printable chars in one chunk', () => {
    const keys = splitKeys('jk');
    expect(keys.map(k => k.name)).toEqual(['j', 'k']);
  });

  test('splits CSI arrow from printable suffix', () => {
    // ESC [ B  +  g
    const keys = splitKeys('\x1b[Bg');
    expect(keys.length).toBe(2);
    expect(keys[0]!.name).toBe('down');
    expect(keys[1]!.name).toBe('g');
  });

  test('isolates a bare ESC', () => {
    const keys = splitKeys('\x1b');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('escape');
  });

  test('parses Ctrl+D as ctrl=true name=d', () => {
    const keys = splitKeys('\x04');
    expect(keys.length).toBe(1);
    expect(keys[0]!.ctrl).toBe(true);
    expect(keys[0]!.name).toBe('d');
  });

  test('parses PageUp', () => {
    const keys = splitKeys('\x1b[5~');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('pageup');
  });

  test('handles multi-byte UTF-8 (emoji → codepoint > 0xFFFF)', () => {
    // 🙂 → 2-unit surrogate in JS string; splitKeys treats it as one key
    const keys = splitKeys('🙂');
    expect(keys.length).toBe(1);
  });

  // Regression: ghostty's macos-option-as-alt mode emits Alt+letter as
  // legacy `\x1b<letter>` (alt-as-esc-prefix). Previously splitKeys+parseKey
  // returned a Key with name='\x1ba' (2-char raw) and no alt bit, making
  // Alt+letter invisible everywhere downstream — readline word motion
  // (Alt+f / Alt+b / Alt+d / Alt+.) silently broke for users on the
  // default macOS layout. tui.parseKey now recognises the 2-char
  // ESC+printable pattern as Alt+<char>.
  test('parses Alt+letter (ghostty alt-esc-prefix)', () => {
    const keys = splitKeys('\x1ba');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('a');
    expect(keys[0]!.alt).toBe(true);
    expect(keys[0]!.ctrl).toBe(false);
    expect(keys[0]!.shift).toBe(false);
  });

  test('parses Alt+Shift+letter (uppercase via alt-esc-prefix)', () => {
    const keys = splitKeys('\x1bA');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('a');
    expect(keys[0]!.alt).toBe(true);
    expect(keys[0]!.shift).toBe(true);
  });

  test('parses Alt+digit and Alt+symbol', () => {
    expect(splitKeys('\x1b5')[0]!.alt).toBe(true);
    expect(splitKeys('\x1b5')[0]!.name).toBe('5');
    expect(splitKeys('\x1b.')[0]!.alt).toBe(true);
    expect(splitKeys('\x1b.')[0]!.name).toBe('.');
  });

  test('parses Alt+Space as space + alt:true', () => {
    const keys = splitKeys('\x1b ');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('space');
    expect(keys[0]!.alt).toBe(true);
  });

  // Regression: Alt+letter via kitty CSI-u (`\x1b[<code>;3u` for mod=3)
  // — modifier 3 = m=2 = alt bit only. decodeModifier previously dropped
  // alt entirely; now it sets alt=true.
  test('parses Alt+a via kitty CSI-u', () => {
    const keys = splitKeys('\x1b[97;3u');
    expect(keys.length).toBe(1);
    expect(keys[0]!.name).toBe('a');
    expect(keys[0]!.alt).toBe(true);
    expect(keys[0]!.ctrl).toBe(false);
    expect(keys[0]!.shift).toBe(false);
  });

  test('parses Ctrl+Alt+a via kitty CSI-u (mod=7 = ctrl+alt)', () => {
    const keys = splitKeys('\x1b[97;7u');
    expect(keys[0]!.name).toBe('a');
    expect(keys[0]!.ctrl).toBe(true);
    expect(keys[0]!.alt).toBe(true);
  });

  // Defensive: bare ESC stays as escape key, NOT Alt+something. This
  // is the boundary case for the new alt-esc-prefix branch — slice
  // length must be exactly 2 to trigger Alt detection.
  test('bare ESC remains escape (not Alt detected)', () => {
    const keys = splitKeys('\x1b');
    expect(keys[0]!.name).toBe('escape');
    expect(keys[0]!.alt).toBeFalsy();
  });
});

// ── attachStreamingKeys ─────────────────────────────────────────
describe('attachStreamingKeys', () => {
  // The helper wires into process.stdin. We only need to verify the
  // chunk-splitter path fans each key out to the handler in order.
  // We stub process.stdin's event emitter with a minimal local one so
  // tests don't touch real TTY state.
  let originalOn: typeof process.stdin.on;
  let originalRemoveListener: typeof process.stdin.removeListener;
  let listeners: Array<(data: string | Buffer) => void> = [];

  beforeEach(() => {
    listeners = [];
    originalOn = process.stdin.on.bind(process.stdin);
    originalRemoveListener = process.stdin.removeListener.bind(process.stdin);
    (process.stdin as any).on = (event: string, h: any) => {
      if (event === 'data') listeners.push(h);
      return process.stdin;
    };
    (process.stdin as any).removeListener = (event: string, h: any) => {
      if (event === 'data') listeners = listeners.filter(l => l !== h);
      return process.stdin;
    };
  });

  afterEach(() => {
    (process.stdin as any).on = originalOn;
    (process.stdin as any).removeListener = originalRemoveListener;
  });

  // ⛔⭐ 리뷰 must-fix(2026-07-30) — 파서가 상태를 갖게 되면서 **lone ESC 가 pending 에 머문다**.
  //    `readKey` 에는 25ms 조용창이 있었는데 이 스트리밍 경로만 없어서 Escape 가 다음 입력까지
  //    전달되지 않고 그때 Alt 조합으로 오인될 수 있었다(main 의 무상태 splitKeys 는 즉시 냈다).
  test('delivers a lone ESC after the quiet window (streaming path)', async () => {
    const { attachStreamingKeys } = await import('../src/chat/index.js');
    const seen: string[] = [];
    const detach = attachStreamingKeys((k) => { seen.push(k.name); });
    listeners[0]!('\x1b');
    expect(seen).toEqual([]);                                   // 아직 판정 불가(Alt 조합일 수 있다)
    await new Promise((r) => setTimeout(r, 40));                // 조용창 경과
    expect(seen).toEqual(['escape']);                           // ⭐ 이제 Escape 로 전달된다
    detach();
  });

  test('a byte inside the quiet window makes it an Alt combo, not Escape', async () => {
    const { attachStreamingKeys } = await import('../src/chat/index.js');
    const seen: Array<{ name: string; alt?: boolean }> = [];
    const detach = attachStreamingKeys((k) => { seen.push({ name: k.name, ...(k.alt ? { alt: true } : {}) }); });
    listeners[0]!('\x1b');
    listeners[0]!('x');                                          // 창 안에 도착
    await new Promise((r) => setTimeout(r, 40));
    expect(seen).toEqual([{ name: 'x', alt: true }]);            // ⭐ Escape 가 새지 않았다
    detach();
  });

  test('dispatches each key from a multi-key chunk in order', async () => {
    const { attachStreamingKeys } = await import('../src/chat/index.js');
    const seen: string[] = [];
    const cleanup = attachStreamingKeys((key) => { seen.push(key.name); });
    expect(listeners.length).toBe(1);

    listeners[0]!('jk');
    expect(seen).toEqual(['j', 'k']);

    listeners[0]!('\x1b[Bg'); // Down + g
    expect(seen).toEqual(['j', 'k', 'down', 'g']);

    cleanup();
    expect(listeners.length).toBe(0);
  });

  test('cleanup detaches the listener', async () => {
    const { attachStreamingKeys } = await import('../src/chat/index.js');
    const fn = mock(() => {});
    const cleanup = attachStreamingKeys(fn);
    cleanup();
    // Emitting after cleanup should not call the handler
    listeners.forEach(l => l('j'));
    expect(fn).not.toHaveBeenCalled();
  });

  test('swallows handler exceptions and continues with next key', async () => {
    const { attachStreamingKeys } = await import('../src/chat/index.js');
    const seen: string[] = [];
    const cleanup = attachStreamingKeys((key) => {
      if (key.name === 'j') throw new Error('boom');
      seen.push(key.name);
    });

    listeners[0]!('jk');
    expect(seen).toEqual(['k']); // 'j' threw, 'k' still dispatched
    cleanup();
  });
});

// ── setKeyTracer / traceKey ─────────────────────────────────────
describe('setKeyTracer', () => {
  test('traceKey is a noop when no tracer is installed', () => {
    setKeyTracer(null);
    // Should not throw
    traceKey({ name: 'j', ctrl: false, shift: false }, 'main');
  });

  test('installed tracer receives each key with source label', () => {
    const calls: Array<{ key: Key; source: string }> = [];
    setKeyTracer((key, source) => { calls.push({ key, source }); });
    traceKey({ name: 'j', ctrl: false, shift: false }, 'main');
    traceKey({ name: 'k', ctrl: false, shift: false }, 'stream');
    traceKey({ name: 'escape', ctrl: false, shift: false }, 'input');
    setKeyTracer(null);
    expect(calls.length).toBe(3);
    expect(calls[0]!.source).toBe('main');
    expect(calls[1]!.source).toBe('stream');
    expect(calls[2]!.source).toBe('input');
    expect(calls.map(c => c.key.name)).toEqual(['j', 'k', 'escape']);
  });

  test('tracer exceptions are swallowed', () => {
    setKeyTracer(() => { throw new Error('boom'); });
    expect(() => traceKey({ name: 'a', ctrl: false, shift: false }, 'main')).not.toThrow();
    setKeyTracer(null);
  });

  test('setKeyTracer(null) detaches', () => {
    const seen: string[] = [];
    setKeyTracer((key) => { seen.push(key.name); });
    traceKey({ name: 'a', ctrl: false, shift: false }, 'main');
    setKeyTracer(null);
    traceKey({ name: 'b', ctrl: false, shift: false }, 'main');
    expect(seen).toEqual(['a']);
  });
});

// ── onEscAbort (back-compat wrapper) ────────────────────────────
describe('onEscAbort back-compat', () => {
  let originalOn: typeof process.stdin.on;
  let originalRemoveListener: typeof process.stdin.removeListener;
  let listeners: Array<(data: string | Buffer) => void> = [];

  beforeEach(() => {
    listeners = [];
    originalOn = process.stdin.on.bind(process.stdin);
    originalRemoveListener = process.stdin.removeListener.bind(process.stdin);
    (process.stdin as any).on = (event: string, h: any) => {
      if (event === 'data') listeners.push(h);
      return process.stdin;
    };
    (process.stdin as any).removeListener = (event: string, h: any) => {
      if (event === 'data') listeners = listeners.filter(l => l !== h);
      return process.stdin;
    };
  });

  afterEach(() => {
    (process.stdin as any).on = originalOn;
    (process.stdin as any).removeListener = originalRemoveListener;
  });

  test('Esc byte triggers abort; other keys do not', async () => {
    const { onEscAbort } = await import('../src/chat/index.js');
    const ctrl = new AbortController();
    const cleanup = onEscAbort(ctrl);

    listeners[0]!('j');
    expect(ctrl.signal.aborted).toBe(false);

    // ⚠️ **동기 → 25ms 조용창 뒤**로 바뀐다(2026-07-30) — 상태 있는 파서에서는 도착 시점에
    //    `\x1b` 가 Escape 인지 **Alt 조합의 선두 바이트**인지 알 수 없다. 즉시 abort 하면
    //    `Alt+x` 가 **거짓 중단**을 낸다. ⇒ 창을 기다리는 쪽이 옳고, 25ms 는 사람이 못 느낀다.
    listeners[0]!('\x1b');
    expect(ctrl.signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(ctrl.signal.aborted).toBe(true);

    cleanup();
  });
});
