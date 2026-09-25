// ── Chalk color-level adapter ──
//
// Ported pattern from claude-code-fork's `src/ink/colorize.ts`:
// chalk auto-detects terminal capability (via supports-color), but the
// auto-detection gets a few common environments WRONG in ways that
// degrade the code-display quality monad-agent's shiki + truecolor
// palette depends on.
//
// Concrete cases:
//
//   • VS Code integrated terminal (xterm.js) reports itself as
//     `xterm-256color`; chalk then clamps to level 2 (256 colours). But
//     xterm.js actually supports 24-bit truecolor — so we BOOST to 3
//     when we detect `TERM_PROGRAM=vscode`.
//
//   • tmux-inside-terminal inherits COLORTERM=truecolor from the outer
//     shell, chalk sets level 3, but tmux without `-2`/`default-terminal
//     "tmux-256color"` silently strips truecolor — we CLAMP to 2 when
//     `TMUX` env is set and tmux isn't known to pass truecolor.
//
//   • tests run under bun pipe stdout so chalk.level falls to 0 (no
//     colour). We never touch that case — no colour in tests is the
//     correct outcome.
//
// Call `applyChalkLevelAdapt()` once at process start (the dashboard
// boot path). Safe to call multiple times — idempotent.

import chalk from 'chalk';

let applied = false;

export function applyChalkLevelAdapt(): void {
  if (applied) return;
  applied = true;

  // Bun-piped-stdout case — chalk.level is 0 because no TTY. Leave
  // it alone; tests and CI depend on colour-free output.
  if (chalk.level === 0) return;

  const env = process.env;

  // VS Code integrated terminal reliably supports truecolor through
  // xterm.js even though $TERM advertises only 256 colours.
  if (env.TERM_PROGRAM === 'vscode' && chalk.level < 3) {
    chalk.level = 3;
    return;
  }

  // tmux: treat as 256-colour unless the user opted into a truecolor
  // tmux config. `tmux -2` sets TERM to `tmux-256color` but that still
  // allows truecolor only if the user set `terminal-features` on tmux
  // 3.2+ or `default-terminal 'tmux-256color'` plus `-Tc`. We can't
  // query that portably, so we clamp — the cost of missing truecolor
  // inside tmux is "slightly less saturated diffs", the cost of
  // emitting truecolor that tmux strips mid-sequence is "corrupted
  // ANSI in the user's scrollback".
  if (env.TMUX && chalk.level > 2) {
    const tmuxKnownTruecolor = env.COLORTERM === 'truecolor'
      && (env.TERM === 'tmux-direct' || env.TERM === 'screen-direct');
    if (!tmuxKnownTruecolor) {
      chalk.level = 2;
    }
    return;
  }

  // iTerm2 on macOS: always truecolor when the user hasn't forced
  // otherwise. chalk usually gets this right already, but boost if it
  // landed at 2 with no explicit downgrade env.
  if (env.TERM_PROGRAM === 'iTerm.app' && chalk.level < 3 && env.COLORTERM) {
    chalk.level = 3;
  }
}

/** Test-only: reset the idempotence guard so fixtures can re-exercise
 *  `applyChalkLevelAdapt` with different env snapshots. */
export function _resetChalkLevelAdaptForTest(): void {
  applied = false;
}
