// ── OSC 11 terminal background colour query ──
//
// Ported pattern from opencode's `packages/opencode/src/cli/cmd/tui/
// util/terminal.ts:37-102`. The terminal emits its background colour
// when asked with the OSC 11 sequence `\x1b]11;?\x07` (BEL terminator)
// or `\x1b]11;?\x1b\\` (ST terminator). Most modern terminals reply
// within milliseconds with a sequence of the form
// `\x1b]11;rgb:RRRR/GGGG/BBBB\x07` (16-bit channel values).
//
// We use this to derive a `dark` / `light` hint that downstream
// consumers (diff palette, chat markdown) can use to select between
// colour variants — matching what codex does via DSR query in
// `codex-rs/tui/src/terminal_palette.rs:49-70` and what opencode does
// for theme synchronisation.
//
// Design choices:
//
//   1. **Opt-in / lazy.** We never emit the query automatically during
//      render. Callers explicitly invoke `queryTerminalBg({timeoutMs})`
//      at boot. This keeps hot paths free of stdin races.
//   2. **Timeout.** Default 250 ms. Terminals that don't reply (tmux
//      without passthrough, CI, dumb pipes) should fall back instantly.
//   3. **Luminance formula.** `0.299R + 0.587G + 0.114B` — standard
//      Rec. 601 (matches opencode `terminal.ts:21-25`).
//   4. **No side effects.** Returns a value. Does NOT mutate a global
//      theme — theme integration is a separate concern that can sit on
//      top of this primitive.

const OSC11_REQUEST_BEL = '\x1b]11;?\x07';
const DEFAULT_TIMEOUT_MS = 250;
const LUMINANCE_DARK_THRESHOLD = 0.5;

export interface TerminalBgResult {
  /** "dark" / "light" if a response was parsed, `null` otherwise. */
  mode: 'dark' | 'light' | null;
  /** Parsed background colour (8-bit channels, 0–255). Present only
   *  when `mode` is non-null. */
  rgb: { r: number; g: number; b: number } | null;
  /** Rec. 601 luminance 0–1. Present only when `mode` is non-null. */
  luminance: number | null;
  /** "timeout" / "no-tty" / "parse-error" / "ok". Useful for debug
   *  logs when the caller wants to know why mode is null. */
  reason: 'ok' | 'timeout' | 'no-tty' | 'parse-error';
}

/** Query the terminal for its background colour via OSC 11. Returns
 *  a `TerminalBgResult`. Never throws — failures surface as
 *  `{ mode: null, reason: … }`. */
export async function queryTerminalBg(
  opts: { timeoutMs?: number; stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream } = {},
): Promise<TerminalBgResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;

  // No TTY ← tests, CI, bun-script pipes. Querying would block forever.
  if (!stdin.isTTY || !stdout.isTTY) {
    return { mode: null, rgb: null, luminance: null, reason: 'no-tty' };
  }

  const response = await readOsc11Response(stdin, stdout, timeoutMs);
  if (response === null) {
    return { mode: null, rgb: null, luminance: null, reason: 'timeout' };
  }

  const rgb = parseOsc11Response(response);
  if (!rgb) {
    return { mode: null, rgb: null, luminance: null, reason: 'parse-error' };
  }

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const mode: 'dark' | 'light' = luminance < LUMINANCE_DARK_THRESHOLD ? 'dark' : 'light';
  return { mode, rgb, luminance, reason: 'ok' };
}

/** Write the OSC 11 request to the terminal and await its reply (or
 *  timeout). Restores stdin raw-mode state when done. */
function readOsc11Response(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const prevRaw = stdin.isRaw;
    let buf = '';
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      try { stdin.off('data', onData); } catch { /* noop */ }
      try { stdin.setRawMode(prevRaw); } catch { /* noop */ }
      try { stdin.pause(); } catch { /* noop */ }
      clearTimeout(timer);
    };

    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Terminator can be BEL (\x07) or ST (\x1b\\).
      const bel = buf.indexOf('\x07');
      const st = buf.indexOf('\x1b\\');
      const end = bel >= 0 && (st < 0 || bel < st) ? bel : st;
      if (end >= 0 && buf.startsWith('\x1b]11;')) {
        cleanup();
        resolve(buf.slice(0, end));
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.on('data', onData);
    stdin.resume();
    stdout.write(OSC11_REQUEST_BEL);
  });
}

/** Parse a response of the form `\x1b]11;rgb:RRRR/GGGG/BBBB` into
 *  8-bit RGB channels. Returns null if the channel format does not
 *  match. Accepts 16-bit (standard) or 8-bit (xterm compat) channels. */
export function parseOsc11Response(response: string): { r: number; g: number; b: number } | null {
  const m = response.match(/\x1b\]11;rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/);
  if (!m) return null;
  const [, rs, gs, bs] = m;
  const r = scaleChannel(rs!);
  const g = scaleChannel(gs!);
  const b = scaleChannel(bs!);
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}

/** Scale a hex channel (1-4 hex digits, xterm allows "ff" or "ffff")
 *  down to 0–255. */
function scaleChannel(hex: string): number | null {
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const v = parseInt(hex, 16);
  if (!Number.isFinite(v)) return null;
  const maxForLen = Math.pow(16, hex.length) - 1;
  return Math.round((v / maxForLen) * 255);
}

/** Compute the dark/light mode from an already-parsed RGB triple.
 *  Exposed as a pure helper so the same logic can be re-used by
 *  callers that obtained the colour through a different channel
 *  (e.g. a user-provided hex in config). */
export function classifyBgMode(rgb: { r: number; g: number; b: number }): 'dark' | 'light' {
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum < LUMINANCE_DARK_THRESHOLD ? 'dark' : 'light';
}
