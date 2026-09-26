// ── macOS clipboard image capture ──
//
// Grab an image from the macOS clipboard by invoking `osascript` to coerce
// the clipboard contents to PNG bytes and save them to `/tmp`. Non-macOS
// platforms return null; callers should degrade gracefully.
//
// Why osascript: avoids a native module dependency. Claude Code's fork has
// a native `readClipboardImage` for speed, but the osascript route is the
// fallback path they also keep — and it's plenty fast for a TUI paste flow.

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

/** Stable prefix so `pruneOldPastes` can find files to sweep. */
export const PASTE_FILENAME_PREFIX = 'elanous-paste-';

/** Default TTL for /tmp paste files — 24h (PLAN §6 Phase 10). */
export const PASTE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Run `osascript -e <script>` and resolve with stdout text. We use
 * child_process rather than Bun's `$` so the module imports cleanly on
 * platforms where `$` isn't available (tests, non-Bun runtimes).
 */
function runOsascript(script: string, timeoutMs = 5000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`osascript timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // osascript writes real failures to stderr with non-zero exit; surface both.
      if (code !== 0 && stderr) stdout += stderr;
      resolve({ stdout: stdout.trim(), code: code ?? 0 });
    });
  });
}

/**
 * True iff the current platform supports `grabClipboardImage`. Separate
 * function so callers can probe without actually invoking osascript.
 */
export function isClipboardSupported(): boolean {
  return process.platform === 'darwin';
}

/**
 * Read an image off the macOS clipboard, save it to `/tmp/<prefix><ts>.png`,
 * and return the path. Returns `null` on non-macOS, missing image, or any
 * osascript failure — callers are expected to render a friendly message
 * rather than throw.
 */
export async function grabClipboardImage(): Promise<string | null> {
  if (!isClipboardSupported()) return null;

  const outPath = join(tmpdir(), `${PASTE_FILENAME_PREFIX}${Date.now()}.png`);
  // Try every common image clipboard flavor — screenshots land as PNGf,
  // copies from Preview/apps often land as TIFF, and some web copies
  // land as JPEG. We coerce each to PNGf so the saved file is always
  // a real .png the extractors can read. Returns "ok" on success,
  // or a short diagnostic string so attachClipboardImage can surface
  // a useful hint instead of silently failing.
  const script = `
    set outPath to "${outPath}"
    set imgData to missing value
    set flavor to "none"
    try
      set imgData to (the clipboard as «class PNGf»)
      set flavor to "PNG"
    on error
      try
        set imgData to (the clipboard as TIFF picture)
        set flavor to "TIFF"
      on error
        try
          set imgData to (the clipboard as JPEG picture)
          set flavor to "JPEG"
        end try
      end try
    end try
    if imgData is missing value then return "no-image"
    try
      set fileRef to open for access POSIX file outPath with write permission
      write imgData to fileRef
      close access fileRef
      return "ok:" & flavor
    on error errMsg
      try
        close access POSIX file outPath
      end try
      return "write-error: " & errMsg
    end try
  `.trim();

  try {
    const { stdout } = await runOsascript(script);
    if (stdout.startsWith('ok') && existsSync(outPath) && statSync(outPath).size > 0) {
      return outPath;
    }
    // Expose the reason back to the caller via a thrown Error — the
    // dashboard wrapper already catches and logs it.
    if (stdout.startsWith('no-image')) throw new Error(stdout);
  } catch (err) {
    try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* ignore */ }
    throw err;
  }

  try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* ignore */ }
  return null;
}

/**
 * Cheap probe — does the macOS clipboard currently hold an image? Doesn't
 * materialize the bytes. Used to surface a "📎 image on clipboard" hint
 * before the user pastes, and to gate the auto-attach branch in onPaste.
 * Returns false on non-macOS and on any osascript failure (conservative).
 */
export async function hasClipboardImage(): Promise<boolean> {
  if (!isClipboardSupported()) return false;
  const script = `
    try
      get the clipboard as «class PNGf»
      return "yes"
    on error
      try
        get the clipboard as TIFF picture
        return "yes"
      on error
        try
          get the clipboard as JPEG picture
          return "yes"
        on error
          return "no"
        end try
      end try
    end try
  `.trim();
  try {
    const { stdout, code } = await runOsascript(script, 2000);
    return code === 0 && stdout === 'yes';
  } catch {
    return false;
  }
}

// ── Writing text to the clipboard ──────────────────────────
//
// Cross-platform: macOS pbcopy, Linux xclip/wl-copy, Windows clip.exe.
// Returns true when the clipboard tool exits 0. Swallows spawn errors
// (missing binary) and returns false so callers can show a friendly
// fallback message instead of a stack trace.
//
// Remote / SSH path (NEW): when running over SSH, pbcopy/xclip write
// to the *remote* machine's clipboard — useless to the user. We route
// through OSC 52, an ANSI escape the local terminal emulator inter-
// cepts and lands on the *local* clipboard. Works across SSH + tmux
// without any client/server identification. Size is bounded (terminals
// reject very large payloads) — we fall back to /tmp/<file> when the
// base64 text exceeds a conservative threshold.
//
// Terminals with OSC 52 write support (April 2026): iTerm2, Ghostty,
// kitty, WezTerm, Alacritty (0.13+). Terminal.app does NOT.
// tmux passthrough requires `set -s set-clipboard on` + for nested
// sessions `set -s allow-passthrough on`; we additionally DCS-wrap
// when inside tmux so passthrough isn't strictly required.

type ClipboardTool = { cmd: string; args: string[] };

function pickClipboardTool(): ClipboardTool | null {
  if (process.platform === 'darwin') return { cmd: 'pbcopy', args: [] };
  if (process.platform === 'win32')  return { cmd: 'clip',   args: [] };
  // Linux — prefer wl-copy on Wayland, fall back to xclip.
  if (process.env.WAYLAND_DISPLAY) return { cmd: 'wl-copy', args: [] };
  return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
}

export function isClipboardWriteSupported(): boolean {
  return pickClipboardTool() !== null;
}

// ── OSC 52 primitives ──────────────────────────────────────

/** Text length threshold above which OSC 52 is skipped (payload gets
 *  large after base64 × DCS wrap). Kitty supports 512MB but most
 *  terminals cap lower; 75KB is the widely-safe practical cap. */
export const OSC52_TEXT_BYTE_LIMIT = 75_000;

export interface ClipboardEnv {
  /** Running inside an SSH session (SSH_CLIENT / SSH_CONNECTION set). */
  readonly ssh: boolean;
  /** Running inside tmux ($TMUX set). OSC 52 needs DCS-wrap here
   *  unless allow-passthrough is on — wrap is cheap so we always
   *  apply it when tmux is present. */
  readonly tmux: boolean;
  /** $TERM_PROGRAM when available (iTerm.app / ghostty / kitty / ...). */
  readonly termProgram: string | undefined;
}

export function detectClipboardEnv(): ClipboardEnv {
  return {
    ssh: !!(process.env['SSH_CLIENT'] || process.env['SSH_CONNECTION'] || process.env['SSH_TTY']),
    tmux: !!process.env['TMUX'],
    termProgram: process.env['TERM_PROGRAM'],
  };
}

/** Encode text as an OSC 52 clipboard-write escape sequence. Pure fn.
 *  - `selection` defaults to 'c' (system clipboard).
 *  - `tmuxWrap` forces DCS wrapping so tmux forwards the payload
 *    instead of swallowing it.
 *  - Returns `null` when the payload would exceed the practical
 *    size cap — callers should fall back to file.                 */
export function encodeOsc52(
  text: string,
  opts: { selection?: 'c' | 'p'; tmuxWrap?: boolean; maxBytes?: number } = {},
): string | null {
  const sel = opts.selection ?? 'c';
  const max = opts.maxBytes ?? OSC52_TEXT_BYTE_LIMIT;
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes > max) return null;
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  // BEL-terminated — widely compatible. ST (\x1b\\) also works but
  // some older terminals handle BEL more reliably.
  const core = `\x1b]52;${sel};${b64}\x07`;
  if (!opts.tmuxWrap) return core;
  // tmux DCS passthrough — wraps the sequence so tmux forwards
  // verbatim to the outer terminal. Escape inner ESC bytes.
  const inner = core.replace(/\x1b/g, '\x1b\x1b');
  return `\x1bPtmux;${inner}\x1b\\`;
}

/** Write an OSC 52 escape for `text` to stdout. Returns false when
 *  the payload is too large. TUI-safe: the terminal intercepts the
 *  escape without visible rendering. */
export function writeOsc52ToStdout(text: string, opts: { selection?: 'c' | 'p' } = {}): boolean {
  const env = detectClipboardEnv();
  const seq = encodeOsc52(text, { selection: opts.selection, tmuxWrap: env.tmux });
  if (seq === null) return false;
  try {
    process.stdout.write(seq);
    return true;
  } catch {
    return false;
  }
}

// ── Routed write with rich result ──────────────────────────

export type ClipboardWriteRoute = 'local' | 'osc52' | 'file' | 'none';

export interface ClipboardWriteResult {
  readonly ok: boolean;
  /** Which path delivered the payload. 'none' on total failure. */
  readonly via: ClipboardWriteRoute;
  /** Set when route === 'file' — absolute path on the server. */
  readonly path?: string;
  /** Human-friendly note a caller can surface (e.g. why a fallback
   *  kicked in). */
  readonly note?: string;
}

/** User override via env var. Values:
 *  - `auto`   (default) SSH → OSC 52, else local tool
 *  - `local`  force pbcopy / xclip / wl-copy (legacy behavior)
 *  - `osc52`  always emit OSC 52 regardless of SSH
 *  - `file`   always write to /tmp/<file>
 *  - `off`    never touch the clipboard (returns ok=false) */
function readClipboardMode(): 'auto' | 'local' | 'osc52' | 'file' | 'off' {
  const raw = (process.env['ELANOUS_CLIPBOARD_MODE'] ?? '').toLowerCase().trim();
  if (raw === 'local' || raw === 'osc52' || raw === 'file' || raw === 'off') return raw;
  return 'auto';
}

async function writeLocalTool(text: string): Promise<boolean> {
  const tool = pickClipboardTool();
  if (!tool) return false;
  try {
    const proc = Bun.spawn([tool.cmd, ...tool.args], {
      stdin: 'pipe',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    proc.stdin.write(text);
    await proc.stdin.end();
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function writeToFile(text: string): Promise<string | null> {
  try {
    const { writeFileSync } = await import('node:fs');
    const outPath = join(tmpdir(), `elanous-clip-${Date.now()}.txt`);
    writeFileSync(outPath, text, { encoding: 'utf-8' });
    return outPath;
  } catch {
    return null;
  }
}

/** Rich-return clipboard write — callers surface `via` to the user so
 *  they know whether the payload went to the local clipboard, through
 *  OSC 52 to their terminal, or fell back to a file. */
export async function writeClipboardDetailed(text: string): Promise<ClipboardWriteResult> {
  const mode = readClipboardMode();
  const env = detectClipboardEnv();

  if (mode === 'off') return { ok: false, via: 'none', note: 'ELANOUS_CLIPBOARD_MODE=off' };

  if (mode === 'file') {
    const path = await writeToFile(text);
    return path
      ? { ok: true, via: 'file', path, note: 'ELANOUS_CLIPBOARD_MODE=file' }
      : { ok: false, via: 'none', note: 'file-write-failed' };
  }

  if (mode === 'osc52') {
    if (writeOsc52ToStdout(text)) return { ok: true, via: 'osc52' };
    const path = await writeToFile(text);
    return path
      ? { ok: true, via: 'file', path, note: 'osc52 payload too large — wrote file' }
      : { ok: false, via: 'none', note: 'osc52-too-large-and-file-write-failed' };
  }

  if (mode === 'local') {
    const ok = await writeLocalTool(text);
    return ok ? { ok: true, via: 'local' } : { ok: false, via: 'none', note: 'local-tool-failed' };
  }

  // mode === 'auto' — the useful default.
  // SSH session: the local tool writes to the remote clipboard, which
  // is useless — prefer OSC 52.
  if (env.ssh) {
    if (writeOsc52ToStdout(text)) return { ok: true, via: 'osc52' };
    // Payload too large for OSC 52 — fall back to file on the remote
    // so the user can at least `scp` / `rsync` it out.
    const path = await writeToFile(text);
    if (path) return { ok: true, via: 'file', path, note: 'payload too large for OSC 52' };
    // Last resort — try the remote tool anyway so at least SOMETHING
    // is captured on the remote side.
    const ok = await writeLocalTool(text);
    return ok
      ? { ok: true, via: 'local', note: 'remote clipboard (OSC 52 + file both failed)' }
      : { ok: false, via: 'none', note: 'all-routes-failed' };
  }

  // Local machine — use the native tool; no benefit from OSC 52 and
  // we avoid writing escape noise to stdout.
  const ok = await writeLocalTool(text);
  return ok ? { ok: true, via: 'local' } : { ok: false, via: 'none', note: 'local-tool-failed' };
}

/** Back-compat wrapper — returns only the ok flag. Most call sites
 *  don't need the routing info; callers that want to tell the user
 *  "copied via OSC 52 to your terminal" should use
 *  `writeClipboardDetailed` instead. */
export async function writeClipboard(text: string): Promise<boolean> {
  const result = await writeClipboardDetailed(text);
  return result.ok;
}

// ── Reading text from the clipboard ────────────────────────
//
// macOS: pbpaste. Linux: xclip / wl-paste depending on session.
// Windows: PowerShell Get-Clipboard. Returns null on any failure
// (no clipboard tool, image-only content, etc.) — callers expect
// to skip when the clipboard isn't text.

function pickClipboardReader(): { cmd: string; args: string[] } | null {
  if (process.platform === 'darwin') return { cmd: 'pbpaste', args: [] };
  if (process.platform === 'win32')  return { cmd: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] };
  if (process.env.WAYLAND_DISPLAY) return { cmd: 'wl-paste', args: ['--no-newline'] };
  return { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] };
}

export async function readClipboardText(timeoutMs = 1500): Promise<string | null> {
  const tool = pickClipboardReader();
  if (!tool) return null;
  return new Promise((resolve) => {
    try {
      const child = spawn(tool.cmd, tool.args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(null); }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => { buf += d.toString(); });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? buf : null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ── Temp-file housekeeping ────────────────────────────────

/**
 * Delete clipboard paste files older than `ttlMs` from the given directory
 * (default `/tmp` + our prefix). Returns the count removed.
 *
 * Called at dashboard startup so a long-running machine doesn't accumulate
 * screenshot bytes in /tmp indefinitely.
 */
export function pruneOldPastes(
  ttlMs: number = PASTE_TTL_MS,
  dir: string = tmpdir(),
): number {
  let removed = 0;
  const cutoff = Date.now() - ttlMs;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return 0; }

  for (const name of entries) {
    if (!name.startsWith(PASTE_FILENAME_PREFIX)) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoff) {
        unlinkSync(full);
        removed++;
      }
    } catch {
      /* ignore — could be a race with another process */
    }
  }
  return removed;
}
