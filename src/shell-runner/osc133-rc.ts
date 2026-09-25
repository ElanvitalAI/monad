// ── OSC 133 rc injection (NT-C1b-5) ──
//
// When the runner PTY spawns a bash or zsh, we wrap it with a temp
// rcfile that:
//   1. Sources the user's real rc (so aliases / prompt / env stay
//      intact).
//   2. Adds a precmd / PROMPT_COMMAND hook that emits the OSC 133
//      semantic-prompt sequence:
//        \e]133;A\a  — prompt-start (fires right before the prompt
//                       is drawn).
//        \e]133;B;$?\a — command-end with the previous command's
//                         exit code (fires in a way that the detector
//                         reads BEFORE the prompt-start of the next
//                         iteration; see shell-specific timing below).
//
// This lets PtyCaptureEngine pin the true exit code without having
// to parse prompt regex. Idempotent: if the user's own rc already
// emits OSC 133, the detector's state machine handles the duplicate
// without emitting a double boundary.
//
// Shell-specific timing
// ─────────────────────
// bash: PROMPT_COMMAND runs AFTER the previous command and BEFORE
//       PS1 renders. We emit 133;B (with $?) then 133;A in that
//       single hook. The engine's detector treats 133;B as the
//       boundary, 133;A as informational (prompt-start).
// zsh:  precmd runs in the same slot (before prompt). preexec runs
//       right before a user-submitted command. We install a precmd
//       that emits 133;B;$?. preexec is optional (we skip it for
//       now — the engine doesn't need command-start).
//
// File layout
// ───────────
// makeBashRcFile() → returns { path, cleanup }. Caller must call
// cleanup() once the PTY dies to remove the tmp file. The path
// should be passed via `--rcfile <path>` when spawning bash. For
// zsh we create a whole tmp directory because `ZDOTDIR` points at
// a directory, not a file.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RcFileHandle {
  /** Absolute path to the rcfile (bash) or rc dir (zsh). */
  path: string;
  /** Spawn argv injection: bash → `['--rcfile', path]`, zsh → `[]` +
   *  env `{ ZDOTDIR: path }`. */
  spawnArgs: readonly string[];
  /** Env additions merged into the child. */
  env: Record<string, string>;
  /** Delete the tmp file/dir. Safe to call twice. */
  cleanup: () => void;
}

const BASH_RC = `
# NT-C1b-5 OSC 133 injection (monad-agent shell-runner).
# Source the user's real rc so aliases / prompt / env stay intact.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
# Emit OSC 133;B on every prompt redraw (captures previous exit code)
# followed by OSC 133;A (prompt-start). Prepend rather than replace
# so any existing PROMPT_COMMAND logic keeps working.
__monad_osc133_prompt() {
  local __monad_last=$?
  printf '\\033]133;B;%s\\007' "$__monad_last"
  printf '\\033]133;A\\007'
  return $__monad_last
}
if [ -z "\${PROMPT_COMMAND-}" ]; then
  PROMPT_COMMAND='__monad_osc133_prompt'
else
  case "$PROMPT_COMMAND" in
    *__monad_osc133_prompt*) ;;
    *) PROMPT_COMMAND='__monad_osc133_prompt; '"$PROMPT_COMMAND" ;;
  esac
fi
`.trimStart();

const ZSH_RC = `
# NT-C1b-5 OSC 133 injection (monad-agent shell-runner).
# Source the user's real rc from $HOME so aliases / prompt / env
# stay intact. ZDOTDIR override would otherwise skip these.
if [ -f "$HOME/.zshenv" ]; then . "$HOME/.zshenv"; fi
if [ -f "$HOME/.zprofile" ]; then . "$HOME/.zprofile"; fi
if [ -f "$HOME/.zshrc" ]; then . "$HOME/.zshrc"; fi
if [ -f "$HOME/.zlogin" ]; then . "$HOME/.zlogin"; fi
# Emit OSC 133;B (with exit code) + OSC 133;A on precmd. Runs
# between the previous command finishing and the next prompt.
__monad_osc133_prompt() {
  local __monad_last=$?
  printf '\\033]133;B;%s\\007' "$__monad_last"
  printf '\\033]133;A\\007'
  return $__monad_last
}
autoload -Uz add-zsh-hook 2>/dev/null
if typeset -f add-zsh-hook >/dev/null; then
  add-zsh-hook precmd __monad_osc133_prompt
else
  precmd_functions=( __monad_osc133_prompt "\${precmd_functions[@]}" )
fi
`.trimStart();

export type SupportedShell = 'bash' | 'zsh';

export function detectShellKind(shell: string | undefined): SupportedShell | null {
  if (!shell) return null;
  const base = shell.split('/').filter(Boolean).pop() ?? '';
  if (base === 'bash') return 'bash';
  if (base === 'zsh') return 'zsh';
  return null;
}

/** Create a temp rc (bash) or rc-dir (zsh) containing the OSC 133
 *  hook. Returns a handle with the spawn arg + env injection the
 *  caller should apply. Returns null for unsupported shells. */
export function makeOsc133RcFile(shell: SupportedShell): RcFileHandle | null {
  if (shell === 'bash') {
    const dir = mkdtempSync(join(tmpdir(), 'monad-rcbash-'));
    const path = join(dir, 'bashrc');
    writeFileSync(path, BASH_RC, { encoding: 'utf8', mode: 0o600 });
    return {
      path,
      spawnArgs: ['--rcfile', path],
      env: { MONAD_OSC133: '1' },
      cleanup: () => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      },
    };
  }
  if (shell === 'zsh') {
    const dir = mkdtempSync(join(tmpdir(), 'monad-rczsh-'));
    writeFileSync(join(dir, '.zshrc'), ZSH_RC, { encoding: 'utf8', mode: 0o600 });
    return {
      path: dir,
      spawnArgs: [],
      env: { ZDOTDIR: dir, MONAD_OSC133: '1' },
      cleanup: () => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      },
    };
  }
  return null;
}
