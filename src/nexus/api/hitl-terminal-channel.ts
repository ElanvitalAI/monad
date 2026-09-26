// NEXUS · terminal HITL confirm channel (β-1d · 2026-05-08).
//
// Reuses `createTerminalConfirmChannel` from src/hitl/confirm.ts +
// supplies the show/clear/awaitAnswer hooks against process.stdin /
// process.stdout. Active only when NEXUS runs in headless mode AND
// the controlling stdin is a TTY — the TUI mode owns stdin
// (raw-mode + alt-screen via runNexusTui), so registering the
// channel there would steal keystrokes from the TUI loop.
//
// When the activation gates fail (TUI mode · piped stdin · launchd /
// nohup detach), the factory returns null and the runtime simply
// skips registration. Sibling channels (Pushcut, PWA, Telegram,
// Discord) still race independently.
//
// Why β-1d ships last in the cascade: PLAN §4.1 listed terminal as
// β-1 because of the lowest LOC estimate (~80), but in dogfood
// terminal is the niche surface — useful for the dev who runs
// `elanous nexus --headless` in a foreground terminal but NOT for
// the typical PWA-Showroom user. β-1a/b/c covered the higher-
// value surfaces first; β-1d closes the cascade.

import readline from 'node:readline';
import {
  createTerminalConfirmChannel,
  type ConfirmChannel,
  type ConfirmRequest,
  type HitlAnswer,
  type TerminalConfirmDeps,
} from '../../hitl/confirm.js';

export interface NexusTerminalHitlOpts {
  /** Override stdin for tests. Production uses `process.stdin`. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Override stdout for tests. Production uses `process.stdout`. */
  stdout?: NodeJS.WritableStream;
  /** Force-enable the channel even when isTTY is false. Tests pass
   *  `true` so the deps factory returns a working hooks object on
   *  fake streams. Production never sets this — non-TTY → null. */
  forceEnable?: boolean;
  /** β-1 dismiss polish (2026-05-08) — disable the ANSI cursor-up +
   *  line-erase emitted by clear(). Production normally leaves this
   *  undefined so the dismiss looks clean on a real TTY. Tests use
   *  `true` to assert clear() doesn't write escape bytes; legitimate
   *  use is rare (piped stdout auto-disables via the isTTY check). */
  disableAnsiErase?: boolean;
  /** Optional logger. Not used today; kept symmetric with the
   *  other channels for future debug instrumentation. */
  log?: (msg: string) => void;
}

/** Build the show/clear/awaitAnswer hooks that
 *  `createTerminalConfirmChannel` accepts. Returns null when the
 *  activation gates fail (no isTTY + no forceEnable). The returned
 *  hooks own a single `readline.Interface` per awaitAnswer call;
 *  cancel() / clear() destroy it so the next request starts fresh.
 *
 *  β-1 dismiss polish (2026-05-08): on a real TTY, clear() also
 *  emits ANSI cursor-up + line-erase escapes to take down the
 *  prompt block when a sibling channel won the race. The
 *  `disableAnsiErase` opt opts out (also auto-disabled on
 *  non-TTY stdouts so logs / pipes don't get raw escape bytes). */
export function createNexusTerminalHitlDeps(opts: NexusTerminalHitlOpts = {}): TerminalConfirmDeps | null {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const isTTY = Boolean((stdin as { isTTY?: boolean }).isTTY);
  if (!isTTY && !opts.forceEnable) return null;

  // ANSI erase only when stdout is a real TTY (or tests force it).
  // `disableAnsiErase: true` honors a piped/file stdout cleanly.
  const stdoutIsTTY = Boolean((stdout as { isTTY?: boolean }).isTTY);
  const ansiErase = opts.disableAnsiErase
    ? false
    : (stdoutIsTTY || Boolean(opts.forceEnable));

  let pendingResolve: ((a: HitlAnswer | null) => void) | null = null;
  let rl: readline.Interface | null = null;
  /** Number of lines the most-recent `show()` painted, so `clear()`
   *  can roll back precisely when ANSI erase is enabled. Includes
   *  the leading blank line + prompt header + prompt + optional
   *  detail + the input-line trailer (no \n at end). */
  let lastShowLineCount = 0;

  const cleanup = (): void => {
    if (rl) {
      try { rl.close(); } catch { /* swallow */ }
      rl = null;
    }
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      try { r(null); } catch { /* swallow */ }
    }
  };

  /** Emit ANSI to take down the previously-painted prompt block.
   *  Sequence per line: `\r` (carriage return to col 0) + `\x1b[2K`
   *  (erase entire line) + `\x1b[1A` (cursor up one row), repeated.
   *  After the loop one final `\r\x1b[2K` clears the row we landed
   *  back on. Fallback to plain newline when erase disabled. */
  const ansiEraseBlock = (): void => {
    if (!ansiErase || lastShowLineCount <= 0) {
      stdout.write('\n');
      return;
    }
    // The prompt's last line ends without `\n` (it's the input row
    // the user types into), so we don't have to skip past a final
    // newline before erasing. Walk up `lastShowLineCount - 1` rows,
    // erasing each. The starting row is erased without an
    // accompanying cursor-up at the end.
    let out = '\r\x1b[2K';
    for (let i = 0; i < lastShowLineCount - 1; i += 1) {
      out += '\x1b[1A\r\x1b[2K';
    }
    stdout.write(out);
  };

  return {
    show(req: ConfirmRequest): void {
      const lines: string[] = [
        '',
        '─── monad-agent · HITL approval request ─────',
        req.prompt,
      ];
      if (req.detail) lines.push(req.detail);
      lines.push(`[${req.yesLabel ?? 'Yes'} (y) / ${req.noLabel ?? 'No'} (n)]: `);
      lastShowLineCount = lines.length;
      stdout.write(lines.join('\n'));
    },
    clear(): void {
      cleanup();
      ansiEraseBlock();
      lastShowLineCount = 0;
    },
    awaitAnswer(): Promise<HitlAnswer | null> {
      return new Promise<HitlAnswer | null>((resolve) => {
        pendingResolve = resolve;
        rl = readline.createInterface({
          input: stdin as NodeJS.ReadableStream,
          output: stdout,
          terminal: false,
        });
        rl.once('line', (line: string) => {
          const trimmed = line.trim().toLowerCase();
          const answer: HitlAnswer | null =
            trimmed === 'y' || trimmed === 'yes' ? true
            : trimmed === 'n' || trimmed === 'no' ? false
            : null;
          pendingResolve = null;
          if (rl) { try { rl.close(); } catch { /* swallow */ } rl = null; }
          resolve(answer);
        });
        // close without a `line` event = stdin closed (e.g. shell
        // detach) → resolve null so the channel opts out and other
        // channels keep racing.
        rl.once('close', () => {
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r(null);
          }
        });
      });
    },
  };
}

/** Higher-level factory: returns the ConfirmChannel ready to push
 *  into the default channel registry. Null on activation-gate
 *  failure. */
export function createNexusTerminalHitlChannel(opts: NexusTerminalHitlOpts = {}): ConfirmChannel | null {
  const deps = createNexusTerminalHitlDeps(opts);
  if (!deps) return null;
  return createTerminalConfirmChannel(deps);
}
