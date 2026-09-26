// ── KGP terminal capability detection ──
//
// Port of yazi-emulator/src/brand.rs:46-89 + yazi-adapter/src/adapters.rs:22-49.
// Detects whether the host terminal speaks the Kitty Graphics Protocol
// (KGP). We use this to route the image-preview pipeline through the
// native KGP encoder (crisp pixel-accurate render via unicode
// placeholders) instead of the chafa/viu block-art fallback.
//
// Detection is env-based because we're running inside the terminal and
// can't query its feature matrix synchronously. The heuristics below
// match Yazi's — validated against Ghostty, Kitty, Konsole, WezTerm.

export type KgpMode =
  | 'kgp'      // Full modern protocol (Kitty, Ghostty). Use U=1 unicode placeholders.
  | 'kgp-old'  // Legacy protocol (Konsole, Warp). Same APC, fewer features. Same writer here.
  | null;      // Not supported — fall back to chafa/viu block art.

let cached: KgpMode | undefined;

/** Manual override (test/benchmark/debug):
 *  - `ELANOUS_KGP=0`   → force null (disable KGP even on supported terminals)
 *  - `ELANOUS_KGP=1`   → force 'kgp' (useful when env-detection fails but you know it works)
 *  - `ELANOUS_KGP=old` → force 'kgp-old' */
function readOverride(): KgpMode | 'unset' {
  const v = process.env.ELANOUS_KGP;
  if (v === undefined || v === '') return 'unset';
  if (v === '0' || v.toLowerCase() === 'off' || v.toLowerCase() === 'false') return null;
  if (v === '1' || v.toLowerCase() === 'on'  || v.toLowerCase() === 'true' ) return 'kgp';
  if (v.toLowerCase() === 'old') return 'kgp-old';
  return 'unset';
}

export function detectKgpSupport(): KgpMode {
  if (cached !== undefined) return cached;

  const override = readOverride();
  if (override !== 'unset') { cached = override; return cached; }

  const env = process.env;
  const term = (env.TERM ?? '').toLowerCase();
  const program = env.TERM_PROGRAM ?? '';

  // TERM exact-match first (fast path for Kitty + Ghostty on xterm-* aliases).
  if (term === 'xterm-kitty') { cached = 'kgp'; return cached; }
  if (term === 'xterm-ghostty') { cached = 'kgp'; return cached; }

  // TERM_PROGRAM match (iTerm2 and WezTerm publish this; Ghostty sometimes).
  if (program === 'ghostty')   { cached = 'kgp'; return cached; }
  if (program === 'WezTerm')   { cached = 'kgp'; return cached; } // iip/sixel in yazi — still supports kgp in newer builds; safest route here is chafa fallback, but user can force on.
  if (program === 'iTerm.app') { cached = null; return cached; }  // iTerm uses IIP not KGP — chafa fallback.

  // Env-var presence (yazi brand.rs:48-58).
  if (env.KITTY_WINDOW_ID !== undefined)       { cached = 'kgp';     return cached; }
  if (env.GHOSTTY_RESOURCES_DIR !== undefined) { cached = 'kgp';     return cached; }
  if (env.KONSOLE_VERSION !== undefined)       { cached = 'kgp-old'; return cached; }
  if (env.WEZTERM_EXECUTABLE !== undefined)    { cached = null;      return cached; } // prefer iip; chafa fallback for now

  // Substring fallback on TERM for extra safety.
  if (term.includes('kitty'))   { cached = 'kgp'; return cached; }
  if (term.includes('ghostty')) { cached = 'kgp'; return cached; }

  cached = null;
  return cached;
}

/** True when KGP (either variant) is usable. */
export function isKgpTerminal(): boolean {
  return detectKgpSupport() !== null;
}

/** Test-only — reset the memoized result so env-var flips are picked up. */
export function _resetForTest(): void {
  cached = undefined;
}
