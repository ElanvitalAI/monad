// AXON P3.1 — Terminal image capability detection.
//
// Wraps `src/kgp/capabilities.ts` (KGP detect, already shipping) and
// extends with iTerm2 (OSC 1337 IIP) + Sixel (DA1 prober deferred —
// today: chafa fallback) + chafa-symbol fallback (PATH probe). Hosts
// pick the protocol once at boot and route every image through the
// matching `image-emit` writer.
//
// Detection is env-based + PATH-based. Async DA1 query (CSI <0c)
// for true Sixel detection is left as a P3.x follow-up — today chafa
// is the universal fallback for both Sixel-capable and non-image
// terminals.

import { existsSync } from 'node:fs';
import { detectKgpSupport } from '../kgp/capabilities.js';

export type ImageProtocol =
  | 'kitty'           // Kitty Graphics Protocol — Kitty, Ghostty, Konsole-old
  | 'iterm2'          // OSC 1337 inline image — iTerm2, WezTerm (newer), Tabby
  | 'sixel'           // Sixel via chafa CLI (until DA1 prober lands)
  | 'chafa-fallback'  // chafa --format symbols block-art (any terminal with chafa on PATH)
  | 'none';           // No image support — alt-text only

export interface TerminalImageCapability {
  protocol: ImageProtocol;
  /** Approximate terminal cell pixel size — used by callers to size
   *  images proportionally. Conservative defaults; precise values
   *  require a CSI 14t / 16t query (deferred). */
  cellPx: { w: number; h: number };
  /** Friendly description for /preview slash output + debug logs. */
  description: string;
}

const DEFAULT_CELL_PX = { w: 8, h: 16 };

let cached: TerminalImageCapability | undefined;

/** Manual override (test/debug):
 *  - `ELANOUS_IMAGE=kitty|iterm2|sixel|chafa|none` — force a protocol
 *  - unset → auto-detect via env + chafa probe */
function readOverride(): ImageProtocol | null {
  const v = process.env.ELANOUS_IMAGE;
  if (!v) return null;
  switch (v.toLowerCase()) {
    case 'kitty':           return 'kitty';
    case 'iterm2':          return 'iterm2';
    case 'sixel':           return 'sixel';
    case 'chafa':
    case 'chafa-fallback':  return 'chafa-fallback';
    case 'none':
    case 'off':
    case '0':               return 'none';
    default:                return null;
  }
}

/** PATH probe for the chafa CLI. Cached for the process lifetime —
 *  the binary doesn't appear/disappear at runtime. Tests can reset
 *  via `_resetForTest()`. */
let chafaCached: boolean | undefined;
function chafaAvailable(): boolean {
  if (chafaCached !== undefined) return chafaCached;
  // Only probe a handful of common paths — full PATH walk is overkill
  // for a UI capability probe. Homebrew (Apple Silicon + Intel) +
  // /usr/bin + /usr/local/bin covers ~all desktops; users with custom
  // installs can set ELANOUS_IMAGE=chafa explicitly.
  const candidates = [
    '/opt/homebrew/bin/chafa',
    '/usr/local/bin/chafa',
    '/usr/bin/chafa',
  ];
  chafaCached = candidates.some((p) => {
    try { return existsSync(p); } catch { return false; }
  });
  return chafaCached;
}

/** Resolve which image protocol the host terminal supports. Result is
 *  memoised for the process lifetime; call `_resetForTest()` between
 *  cases to flip env vars. */
export function detectImageCapability(): TerminalImageCapability {
  if (cached) return cached;

  const override = readOverride();
  if (override) {
    cached = makeCapability(override);
    return cached;
  }

  // iTerm2 / WezTerm first — they publish TERM_PROGRAM and the IIP
  // path is more widely supported than KGP on these terminals. We
  // explicitly route them before the KGP env heuristic so e.g.
  // WezTerm with KGP-on builds still picks IIP (the default mode).
  // Users who prefer KGP on these terminals can set ELANOUS_IMAGE=kitty.
  const program = process.env.TERM_PROGRAM ?? '';
  if (program === 'iTerm.app') { cached = makeCapability('iterm2'); return cached; }
  if (program === 'WezTerm')   { cached = makeCapability('iterm2'); return cached; }

  // KGP next — fastest path + crispest output for Kitty/Ghostty/Konsole.
  // Reuses the existing kgp/capabilities env heuristics.
  if (detectKgpSupport() !== null) {
    cached = makeCapability('kitty');
    return cached;
  }

  // Sixel — proper detection requires DA1 query. Today: detect known
  // sixel-capable env hints; fall through to chafa otherwise.
  const term = (process.env.TERM ?? '').toLowerCase();
  if (term.includes('xterm-256color') && process.env.XTERM_VERSION !== undefined) {
    // xterm with sixel build — many distros ship without sixel,
    // but when XTERM_VERSION is set we lean toward sixel via chafa
    // (chafa --format sixel emits valid sequences regardless).
    if (chafaAvailable()) {
      cached = makeCapability('sixel');
      return cached;
    }
  }
  if (term.includes('mlterm') || term.includes('mintty')) {
    if (chafaAvailable()) {
      cached = makeCapability('sixel');
      return cached;
    }
  }

  // chafa fallback — widely available, terminal-agnostic block art.
  if (chafaAvailable()) {
    cached = makeCapability('chafa-fallback');
    return cached;
  }

  // No image support at all — alt-text only.
  cached = makeCapability('none');
  return cached;
}

/** True when any non-text protocol is available. */
export function hasImageSupport(): boolean {
  return detectImageCapability().protocol !== 'none';
}

/** Test-only — reset memoised result + chafa probe cache so env
 *  flips are picked up. */
export function _resetForTest(): void {
  cached = undefined;
  chafaCached = undefined;
}

function makeCapability(protocol: ImageProtocol): TerminalImageCapability {
  switch (protocol) {
    case 'kitty':
      return { protocol, cellPx: DEFAULT_CELL_PX, description: 'Kitty Graphics Protocol' };
    case 'iterm2':
      return { protocol, cellPx: DEFAULT_CELL_PX, description: 'iTerm2 inline image (OSC 1337 IIP)' };
    case 'sixel':
      return { protocol, cellPx: DEFAULT_CELL_PX, description: 'Sixel via chafa' };
    case 'chafa-fallback':
      return { protocol, cellPx: DEFAULT_CELL_PX, description: 'chafa block-art fallback' };
    case 'none':
      return { protocol, cellPx: DEFAULT_CELL_PX, description: 'No image support — alt-text only' };
  }
}
