// ── Sandbox wrapper (X3) ──
//
// Optional wrapper layer around the argv produced by runShell. When
// sandbox is 'auto' and we're on a platform with a viable sandbox
// tool, we rewrite `command` to invoke the sandbox binary with a
// policy derived from the ShellRequest's network/fs intents.
//
// Design:
//   • macOS → `sandbox-exec -p '<SBPL>'` (deprecated but still
//     shipping in /usr/bin; same tool codex uses).
//   • Linux → placeholder. landlock/bwrap integration lives in a
//     future PR so we don't ship half-broken Linux paths.
//   • Other OS → sandbox: 'off' forced; caller gets a warning.
//
// The sandbox module is OPT-IN at the request level (`sandbox` field
// on ShellRequest, defaulting to 'off' for now so the X3 landing
// doesn't change existing caller behaviour). runShell reads the
// field and calls applySandbox() when it's 'auto' or 'strict'.
//
// Policy tiers:
//   off    — return argv unchanged; sandbox:false on result
//   auto   — wrap when platform supports it; passthrough otherwise
//   strict — wrap; error out if platform doesn't support it
//
// Keeping the SBPL profile short + conservative so the default
// doesn't accidentally break tools that read, say, ~/.gitconfig.
// The profile permits:
//   • read everywhere (git/rg/fd need this)
//   • fs write ONLY under cwd and /tmp
//   • network BLOCKED when network='off'; permitted when 'inherit'
//   • spawning child processes ALLOWED (rg spawns grep, git spawns
//     git-credential-*; blocking this cripples normal dev tooling)
//
// Callers who need tighter policies supply sandbox:'strict' and
// accept the error surface when the platform can't enforce.

import { getSessionCwd } from '../session/working-dir.js';
import type { ShellRequest } from './types.js';

export type SandboxMode = 'off' | 'auto' | 'strict';
export type NetworkMode = 'inherit' | 'off';

export type SandboxTool = 'sandbox-exec' | 'bwrap' | 'none';

export interface SandboxDecision {
  /** True if the argv was rewritten to go through a sandbox. */
  sandboxed: boolean;
  /** Final argv the runtime should spawn. */
  command: string[];
  /** Platform tool used (informational; shows in audit). */
  tool: SandboxTool;
  /** Reason we couldn't sandbox, when sandboxed=false + strict. */
  reason?: string;
}

export class SandboxUnavailableError extends Error {
  constructor(public readonly platform: NodeJS.Platform, reason: string) {
    super(`sandbox unavailable on ${platform}: ${reason}`);
    this.name = 'SandboxUnavailableError';
  }
}

/** Build an SBPL profile string for macOS sandbox-exec. The profile
 *  is a Scheme-like S-expression consumed by the kernel; we keep
 *  ours minimal to avoid unexpected denials. Exported for tests +
 *  visibility — `auditEntry.sandboxProfile = buildMacOsProfile(...)`
 *  lets an operator see exactly what was in effect. */
export function buildMacOsProfile(opts: {
  cwd: string;
  network: NetworkMode;
}): string {
  const networkClause = opts.network === 'off'
    ? '(deny network*)'
    : '(allow network*)';
  // `(import "system.sb")` brings in the baseline darwin policy
  // (libSystem, dyld, …). Without it even `echo` fails because the
  // child can't open dyld shared cache.
  return [
    '(version 1)',
    '(import "system.sb")',
    '(allow default)',                // start permissive, then narrow
    '(deny file-write*)',
    `(allow file-write* (subpath "${escapeSbpl(opts.cwd)}"))`,
    '(allow file-write* (subpath "/tmp"))',
    '(allow file-write* (subpath "/private/tmp"))',
    '(allow file-write* (subpath "/private/var/folders"))',
    '(allow file-read*)',
    networkClause,
    '(allow process-exec)',
    '(allow process-fork)',
  ].join('\n');
}

function escapeSbpl(s: string): string {
  // SBPL strings are double-quoted; the only escape we worry about
  // is the quote itself + backslash. Paths with newlines are not a
  // real concern on macOS filesystems.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build the argv + clause list for bwrap (bubblewrap, Linux).
 *  Exported for tests so the argv shape is verified without invoking
 *  the actual binary. Conservative profile mirrors the macOS SBPL:
 *
 *    bwrap
 *      --ro-bind /        /        ; read-only root
 *      --bind   <cwd>     <cwd>    ; writable project
 *      --tmpfs  /tmp               ; scratch writes
 *      --proc   /proc
 *      --dev    /dev
 *      --die-with-parent
 *      --new-session
 *      [--unshare-net]              ; when network='off'
 *      <argv...>
 *
 *  We deliberately do NOT chroot — developer tooling relies on being
 *  able to read ~/.gitconfig, shared PATH binaries, etc. */
export function buildLinuxBwrapArgs(opts: {
  bwrapBinary: string;
  cwd: string;
  network: NetworkMode;
  command: string[];
}): string[] {
  const argv: string[] = [opts.bwrapBinary];
  argv.push('--ro-bind', '/', '/');
  argv.push('--bind', opts.cwd, opts.cwd);
  argv.push('--tmpfs', '/tmp');
  argv.push('--proc', '/proc');
  argv.push('--dev', '/dev');
  argv.push('--die-with-parent');
  argv.push('--new-session');
  if (opts.network === 'off') {
    argv.push('--unshare-net');
  }
  argv.push(...opts.command);
  return argv;
}

/** Platform-agnostic check for bwrap availability. Returns the
 *  resolved path, or null when absent. Cached — repeated sandbox
 *  calls shouldn't re-stat PATH on every invocation. */
let _bwrapPathCache: string | null | undefined = undefined;
export function resolveBwrapPath(): string | null {
  if (_bwrapPathCache !== undefined) return _bwrapPathCache;
  const candidates = ['/usr/bin/bwrap', '/usr/local/bin/bwrap'];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    for (const p of candidates) {
      try { if (fs.statSync(p).isFile()) { _bwrapPathCache = p; return p; } }
      catch { /* not there */ }
    }
  } catch { /* ignore */ }
  _bwrapPathCache = null;
  return null;
}

/** Test seam — reset the cache so platform-emulation tests can flip
 *  the bwrap-present answer. Also accepts an override string for
 *  unit tests that want to simulate a present binary. */
export function _resetBwrapPathCacheForTesting(override?: string | null): void {
  _bwrapPathCache = override === undefined ? undefined : override;
}

/** Decide whether + how to wrap a command in a sandbox. Platform-
 *  dispatch lives here so the runtime stays OS-agnostic. */
export function applySandbox(
  req: Pick<ShellRequest, 'command' | 'cwd' | 'network'> & { sandbox?: SandboxMode },
  options: {
    platform?: NodeJS.Platform;
    resolveBwrap?: typeof resolveBwrapPath;
  } = {},
): SandboxDecision {
  const mode: SandboxMode = req.sandbox ?? 'off';
  // WD5 — read from session-working-dir so sandbox profiles (macOS
  // sandbox-exec file-write-subpath) are scoped to the active
  // project root, not the boot cwd.
  const cwd = req.cwd ?? getSessionCwd();
  const network: NetworkMode = req.network ?? 'inherit';

  if (mode === 'off') {
    return { sandboxed: false, command: req.command, tool: 'none' };
  }

  const platform = options.platform ?? process.platform;
  const resolveBwrap = options.resolveBwrap ?? resolveBwrapPath;
  if (platform === 'darwin') {
    const profile = buildMacOsProfile({ cwd, network });
    return {
      sandboxed: true,
      tool: 'sandbox-exec',
      command: ['/usr/bin/sandbox-exec', '-p', profile, ...req.command],
    };
  }

  if (platform === 'linux') {
    const bwrap = resolveBwrap();
    if (bwrap) {
      const argv = buildLinuxBwrapArgs({
        bwrapBinary: bwrap,
        cwd, network, command: req.command,
      });
      return { sandboxed: true, tool: 'bwrap', command: argv };
    }
    if (mode === 'strict') {
      throw new SandboxUnavailableError(
        platform,
        'bwrap not found on PATH — install bubblewrap (`apt install bubblewrap` / `dnf install bubblewrap`)',
      );
    }
    return {
      sandboxed: false,
      command: req.command,
      tool: 'none',
      reason: 'linux sandbox requires bwrap (bubblewrap); not installed',
    };
  }

  // Unsupported platform — soft-fail under auto, hard-fail under strict.
  if (mode === 'strict') {
    throw new SandboxUnavailableError(
      platform,
      'no sandbox tool implemented for this platform',
    );
  }
  return {
    sandboxed: false,
    command: req.command,
    tool: 'none',
    reason: `sandbox mode=${mode} requested but ${platform} has no implementation yet`,
  };
}
