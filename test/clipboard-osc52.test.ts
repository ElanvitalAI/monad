// OSC 52 + SSH-routing tests for src/clipboard.ts.
//
// We exercise the PURE parts directly (encodeOsc52, detectClipboardEnv,
// writeClipboardDetailed). The local-tool path (pbcopy / xclip) is
// platform-specific and spawns an external process — covered by the
// existing integration layer, not repeated here.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  detectClipboardEnv,
  encodeOsc52,
  OSC52_TEXT_BYTE_LIMIT,
  writeClipboardDetailed,
} from '../src/clipboard/index.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env['SSH_CLIENT'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_TTY'];
  delete process.env['TMUX'];
  delete process.env['TERM_PROGRAM'];
  delete process.env['MONAD_CLIPBOARD_MODE'];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
});

describe('encodeOsc52', () => {
  test('emits BEL-terminated ESC]52;c;<b64>', () => {
    const out = encodeOsc52('hello');
    expect(out).toBe('\x1b]52;c;' + Buffer.from('hello').toString('base64') + '\x07');
  });

  test('respects selection override', () => {
    const out = encodeOsc52('x', { selection: 'p' });
    expect(out).toBe('\x1b]52;p;' + Buffer.from('x').toString('base64') + '\x07');
  });

  test('DCS-wraps for tmux passthrough', () => {
    const out = encodeOsc52('yo', { tmuxWrap: true });
    // Must start with tmux DCS prefix and end with String Terminator.
    expect(out?.startsWith('\x1bPtmux;')).toBe(true);
    expect(out?.endsWith('\x1b\\')).toBe(true);
    // Inner ESC bytes are doubled so tmux forwards them verbatim.
    expect(out).toContain('\x1b\x1b]52;c;');
  });

  test('UTF-8 payload base64 round-trips', () => {
    const korean = '복사 테스트 🎉';
    const out = encodeOsc52(korean);
    const b64 = Buffer.from(korean, 'utf-8').toString('base64');
    expect(out).toContain(';c;' + b64);
  });

  test('returns null when payload exceeds limit', () => {
    const huge = 'a'.repeat(OSC52_TEXT_BYTE_LIMIT + 1);
    expect(encodeOsc52(huge)).toBeNull();
  });

  test('custom maxBytes enforces a tighter cap', () => {
    expect(encodeOsc52('hello', { maxBytes: 3 })).toBeNull();
    expect(encodeOsc52('hi', { maxBytes: 3 })).not.toBeNull();
  });
});

describe('detectClipboardEnv', () => {
  test('no env → local, non-tmux', () => {
    const env = detectClipboardEnv();
    expect(env.ssh).toBe(false);
    expect(env.tmux).toBe(false);
  });

  test('SSH_CLIENT flips ssh=true', () => {
    process.env['SSH_CLIENT'] = '10.0.0.1 22';
    expect(detectClipboardEnv().ssh).toBe(true);
  });

  test('SSH_TTY alone also counts', () => {
    process.env['SSH_TTY'] = '/dev/pts/0';
    expect(detectClipboardEnv().ssh).toBe(true);
  });

  test('TMUX set → tmux=true', () => {
    process.env['TMUX'] = '/tmp/tmux-501/default,12345,0';
    expect(detectClipboardEnv().tmux).toBe(true);
  });

  test('TERM_PROGRAM surfaced', () => {
    process.env['TERM_PROGRAM'] = 'ghostty';
    expect(detectClipboardEnv().termProgram).toBe('ghostty');
  });
});

describe('writeClipboardDetailed — routing', () => {
  test('MODE=off returns ok=false with reason', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'off';
    const r = await writeClipboardDetailed('x');
    expect(r.ok).toBe(false);
    expect(r.via).toBe('none');
    expect(r.note).toContain('off');
  });

  test('MODE=file always writes a file', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'file';
    const r = await writeClipboardDetailed('hi');
    expect(r.ok).toBe(true);
    expect(r.via).toBe('file');
    expect(r.path).toMatch(/monad-clip-\d+\.txt$/);
  });

  test('MODE=osc52 + small payload → ok via osc52', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'osc52';
    // Suppress the actual stdout write from the test harness — we
    // replace process.stdout.write with a spy so the escape doesn't
    // bleed into test output.
    const orig = process.stdout.write.bind(process.stdout);
    const captured: string[] = [];
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      captured.push(s);
      return true;
    };
    try {
      const r = await writeClipboardDetailed('small');
      expect(r.ok).toBe(true);
      expect(r.via).toBe('osc52');
      expect(captured.length).toBe(1);
      expect(captured[0]).toContain(']52;c;');
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
  });

  test('MODE=osc52 + oversized → falls back to file', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'osc52';
    const huge = 'a'.repeat(OSC52_TEXT_BYTE_LIMIT + 1);
    const r = await writeClipboardDetailed(huge);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('file');
    expect(r.note).toContain('too large');
  });

  test('MODE=auto + SSH + small payload → osc52', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'auto';
    process.env['SSH_CLIENT'] = '10.0.0.1 22';
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = () => true;
    try {
      const r = await writeClipboardDetailed('hi');
      expect(r.ok).toBe(true);
      expect(r.via).toBe('osc52');
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
  });

  test('MODE=auto + SSH + oversized → file fallback', async () => {
    process.env['MONAD_CLIPBOARD_MODE'] = 'auto';
    process.env['SSH_CONNECTION'] = '10.0.0.1 49152 10.0.0.2 22';
    const r = await writeClipboardDetailed('a'.repeat(OSC52_TEXT_BYTE_LIMIT + 1));
    expect(r.ok).toBe(true);
    expect(r.via).toBe('file');
  });
});
