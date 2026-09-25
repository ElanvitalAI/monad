// macOS SSH keychain-unlock preamble for spawned `claude` CLI.
//
// On macOS, the `claude` binary stores its OAuth credentials in the
// login keychain. When the user `ssh`'s into a Mac and the login
// keychain hasn't been unlocked since boot, `claude` reports
// "Not logged in · Run /login" because it can't read its credentials.
//
// The cure is a one-time `security unlock-keychain` invocation in
// the same TTY where claude will run, which prompts for the macOS
// account password. Once unlocked, the keychain stays unlocked for
// the rest of the SSH session (until the system relocks it on
// idle), so subsequent `security unlock-keychain` calls return
// silently — making it safe to wrap unconditionally.
//
// Codex CLI does not use the keychain, so callers must gate this
// helper on `brand === 'claude-code'`.
//
// Scope: PTY-spawn paths only (`/claude` terminal-modal,
// `/claude-vw` virtual-window). ACP protocol clients talk to the
// CLI over stdio rather than spawning a new TTY, so they are
// unaffected by keychain lock state.

/**
 * True iff we should prepend `security unlock-keychain` before
 * spawning `claude`. We require:
 *   • macOS (`process.platform === 'darwin'`)
 *   • an SSH session (any of SSH_CONNECTION / SSH_CLIENT / SSH_TTY)
 *
 * The local Mac console session does not need this because the
 * login keychain is already unlocked by macOS at login time.
 */
export function shouldWrapForKeychainUnlock(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== 'darwin') return false;
  const ssh = env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY;
  return Boolean(ssh && ssh.length > 0);
}

/**
 * Wrap `command` so the spawned PTY first runs the keychain-unlock
 * preamble (which prompts for the macOS password on first SSH
 * spawn) and then `exec`s the original command. Returns `command`
 * unchanged when not on darwin / not in SSH.
 *
 * Caller is responsible for gating on `brand === 'claude-code'`.
 */
export function wrapCommandForKeychainUnlock(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!shouldWrapForKeychainUnlock(env)) return command;
  const escaped = command.replace(/'/g, `'\\''`);
  // The preamble must avoid embedded single quotes — the whole
  // command is passed as a single-quoted argument to `sh -c`, and
  // any inner `'` would close the outer string and let the shell
  // glob-expand the rest (zsh: "bad pattern" on `\033[…`). Plain
  // double-quoted echo is robust and macOS's own `security` prompt
  // ("password to unlock /Users/…/login.keychain-db:") is already
  // self-explanatory, so we skip ANSI coloring here.
  //
  // `&&` (not `;`) between unlock and exec — if the user mistypes
  // the password, `security` exits non-zero and we want the wrapper
  // to abort BEFORE `exec claude` clears the screen and hides the
  // error. With `&&`, sh exits with security's status and the
  // "incorrect passphrase" line stays visible so the user can
  // re-spawn and retry.
  const preamble =
    `echo "[monad] SSH session — unlocking login keychain (enter macOS password)"; ` +
    `security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"`;
  return `sh -c '${preamble} && exec ${escaped}'`;
}
