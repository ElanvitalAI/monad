import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

export interface PosixShellDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (path: string) => boolean;
  gitExecPath?: () => string | undefined;
}

export type PosixShellResult = { found: true; path: string } | { found: false; reason: string };

const MISSING_SHELL = 'Git Bash not found: set ELANOUS_GIT_BASH_PATH or install Git for Windows.';
const POSIX_SH = '/bin/sh';

export function resolvePosixShell(deps: PosixShellDeps = {}): PosixShellResult {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  if (platform !== 'win32') return { found: true, path: env.SHELL ?? POSIX_SH };

  const exists = deps.existsSync ?? existsSync;
  const usable = (path: string | undefined): path is string =>
    !!path && win32.basename(path).toLowerCase() === 'bash.exe'
    && !/(?:^|[\\/])system32(?:[\\/]|$)/i.test(win32.normalize(path))
    && exists(path);
  if (usable(env.ELANOUS_GIT_BASH_PATH)) return { found: true, path: env.ELANOUS_GIT_BASH_PATH };

  const gitExecPath = deps.gitExecPath ?? (() => {
    const result = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : undefined;
  });
  let gitPath: string | undefined;
  try { gitPath = gitExecPath(); } catch { /* git may not be installed */ }
  const gitCore = gitPath ? win32.normalize(gitPath.trim()) : undefined;
  const gitRoot = gitCore && win32.basename(gitCore).toLowerCase() === 'git-core'
    && win32.basename(win32.dirname(gitCore)).toLowerCase() === 'libexec'
    ? win32.dirname(win32.dirname(win32.dirname(gitCore))) : undefined;
  const gitCandidate = gitRoot ? win32.join(gitRoot, 'bin', 'bash.exe') : undefined;
  const candidates = [
    gitCandidate,
    env.ProgramFiles ? win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe') : undefined,
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
  ];
  for (const path of candidates) {
    if (usable(path)) return { found: true, path };
  }
  return { found: false, reason: MISSING_SHELL };
}

/** Converts a missing Windows Git Bash into an actionable error before any spawn. */
export function requirePosixShell(fallback: '/bin/sh' | '/bin/bash' = '/bin/sh', deps: PosixShellDeps = {}): string {
  const result = resolvePosixShell(deps);
  if (!result.found) {
    const error = new Error(result.reason);
    error.stack = result.reason;
    throw error;
  }
  // Keep the historical fallback for callers that used /bin/bash rather than /bin/sh.
  const env = deps.env ?? process.env;
  return (deps.platform ?? process.platform) !== 'win32' && !env.SHELL ? fallback : result.path;
}

/** Non-executed fallback for remote and explicit-program transport contexts. */
export function posixShellHint(fallback: '/bin/sh' | '/bin/bash' = '/bin/bash', env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL ?? fallback;
}

/** Literal interpreter calls retain their exact POSIX executable and argv. */
export function requirePosixShellCommand(command: '/bin/sh' | 'sh' | 'bash', deps: PosixShellDeps = {}): string {
  return (deps.platform ?? process.platform) === 'win32' ? requirePosixShell('/bin/sh', deps) : command;
}
