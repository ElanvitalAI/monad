// ── Full-fidelity TUI screen mirror (PLAN P1b-2) ──
//
// P1b captured render()'s base layer only — modals / pickers / cursor
// are written DIRECTLY to process.stdout (writeOverlay / writeCursor /
// input echo · NOT through render()'s `lines`), so they were missing
// from the self-reported frame.
//
// The only complete + robust seam for "what the user actually sees" is
// the same one the registry PTYs use: feed the real output byte stream
// through an @xterm/headless emulator and read its grid. Here that
// stream is THIS process's own stdout — so we tap process.stdout.write,
// mirror every chunk into a headless Terminal, and render its grid on
// demand. The grid reflects base + overlay + cursor exactly, because it
// is literally reconstructed from the bytes the terminal received.
//
// ⚠️ HIGHEST-STAKES seam in this arc — it wraps the interactive TUI's
// output path. Bulletproof fail-soft: the mirror feed is try/catch'd and
// the ORIGINAL write is always delegated with its exact args/return, so
// a mirror bug can never corrupt or drop real output. `MONAD_TUI_SELF_REPORT=0`
// disables the whole thing. cf. REPORT §5 (S2), registry.ts:349 (renderScreen).

import { Terminal as XtermHeadless } from '@xterm/headless';

export interface TuiScreenMirror {
  /** Render the current composited screen (base + overlay + cursor) as
   *  text — the same grid-walk registry.ts renderScreen() uses. Reads the
   *  CURRENT grid synchronously; in production the throttled read (~1.5s
   *  after any write) always sees a fully-parsed grid. For immediate
   *  accuracy right after a write, `await flush()` first (tests do). */
  renderScreen(): string;
  /** Drain the emulator's async write queue so the grid reflects every
   *  byte fed so far. registry.ts renderScreen() uses the same idiom. */
  flush(): Promise<void>;
  /** Current emulator dims. */
  dims(): { cols: number; rows: number };
  /** Resize the emulator (on SIGWINCH / termSize change). */
  resize(cols: number, rows: number): void;
  /** Restore the original stdout.write + drop the emulator. Idempotent. */
  stop(): void;
}

export interface TuiScreenMirrorDeps {
  cols: number;
  rows: number;
  /** Test seam — the stream to tap (defaults to process.stdout). */
  stream?: { write: (...args: unknown[]) => boolean };
}

/** Walk an @xterm/headless grid → screen text. Mirrors registry.ts:349
 *  renderScreen() (no header — consumers want just the screen). */
function renderXtermGrid(t: XtermHeadless): string {
  const active = t.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < t.rows; y++) {
    const line = active.getLine(active.viewportY + y);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Create the screen mirror: tap the stream's write, feed a headless
 *  emulator, expose renderScreen(). Returns null if the emulator can't
 *  be created (self-report then simply stays on the P1b base layer). */
export function createTuiScreenMirror(deps: TuiScreenMirrorDeps): TuiScreenMirror | null {
  let term: XtermHeadless;
  try {
    term = new XtermHeadless({ cols: Math.max(2, deps.cols), rows: Math.max(2, deps.rows), scrollback: 200, allowProposedApi: true });
  } catch {
    return null;   // no emulator → caller keeps the base-layer path
  }

  const stream = deps.stream ?? (process.stdout as unknown as { write: (...args: unknown[]) => boolean });
  // Save the ORIGINAL (unbound) write so stop() restores the exact same
  // reference the caller had — and delegate via .apply(stream, args) to
  // preserve `this` + the full arg list (encoding / callback).
  const originalWrite = stream.write;
  let stopped = false;

  // The tap: mirror into the emulator, then ALWAYS delegate to the real
  // write with the exact args (preserving return value + callback). The
  // mirror is best-effort — a feed error must never touch real output.
  const tappedWrite = (...args: unknown[]): boolean => {
    try {
      if (stopped) return originalWrite.apply(stream, args) as boolean;   // post-stop: skip disposed-term feed
      const chunk = args[0];
      if (typeof chunk === 'string') term.write(chunk);
      else if (typeof chunk === 'object' && chunk !== null && typeof (chunk as { toString?: unknown }).toString === 'function') {
        const s = (chunk as Buffer).toString('utf-8');
        if (typeof s === 'string') term.write(s);
      }
    } catch { /* mirror feed is best-effort — never affect real output */ }
    return originalWrite.apply(stream, args) as boolean;
  };
  try {
    (stream as { write: unknown }).write = tappedWrite;
  } catch {
    return null;   // couldn't install tap → bail cleanly (no emulator kept)
  }

  return {
    renderScreen(): string {
      try { return renderXtermGrid(term); } catch { return ''; }
    },
    flush(): Promise<void> {
      // xterm parses writes asynchronously; an empty write's callback
      // fires after the queue drains (registry.ts uses the same idiom).
      return new Promise<void>((resolve) => {
        try { term.write('', () => resolve()); } catch { resolve(); }
      });
    },
    dims(): { cols: number; rows: number } {
      return { cols: term.cols, rows: term.rows };
    },
    resize(cols: number, rows: number): void {
      try { term.resize(Math.max(2, cols), Math.max(2, rows)); } catch { /* fail-soft */ }
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      try { (stream as { write: unknown }).write = originalWrite; } catch { /* fail-soft */ }
      try { term.dispose(); } catch { /* fail-soft */ }
    },
  };
}
