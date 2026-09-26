// ── Terminal Matrix — transport resolution (Phase T6) ──
//
// A TerminalTransport describes WHERE the PTY runs. The matrix only
// cares about the transport at spawn time: it resolves transport →
// concrete (shell, args) pair and hands it to the existing SpawnFn
// in PreviewTerminal. Once the PTY is running, transport is
// immutable on the TerminalInstance — matrix doesn't migrate running
// PTYs across hosts.
//
// Supported kinds:
//   local      — node-pty spawn of the user's $SHELL (or spec.shell)
//   tailscale  — `tailscale ssh <user@>host -- <shell>` wrapper
//   ssh        — raw `ssh <user@>host -p <port> -- <shell>` wrapper
//
// Remote transports honor the same PTY cols/rows via node-pty's
// resize() — the wrapper process forwards SIGWINCH to the remote
// PTY. Initial size is also communicated via `stty rows/cols` on
// first output, which mitigates a handful of older OpenSSH builds
// that don't forward SIGWINCH correctly.

import type { TerminalTransport, TerminalCharacter } from './types.js';

export interface ResolvedTransport {
  readonly shell: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface TransportResolveContext {
  character: TerminalCharacter;
  /** Fallback shell from user env — usually `process.env.SHELL` or
   *  `/bin/bash`. Caller passes it in rather than having transport.ts
   *  touch process.env, so tests stay deterministic. */
  defaultShell: string;
}

/** Pick the concrete command + args + env supplements for a given
 *  transport. The returned `env` is merged *over* the spawn env by
 *  the caller — it's additions only, not a full env set. */
export function resolveTransport(
  transport: TerminalTransport,
  ctx: TransportResolveContext,
): ResolvedTransport {
  switch (transport.kind) {
    case 'local':
      return resolveLocal(ctx);
    case 'tailscale':
      return resolveTailscale(transport, ctx);
    case 'ssh':
      return resolveSsh(transport, ctx);
  }
}

function resolveLocal(ctx: TransportResolveContext): ResolvedTransport {
  // Character-specific local programs — `claude-code` / `codex`
  // replace the shell entirely. Custom with spawnArgs passes
  // through verbatim. Plain shell uses defaultShell as login.
  switch (ctx.character.kind) {
    case 'claude-code':
      return { shell: 'claude-code', args: [], env: {} };
    case 'codex':
      return { shell: 'codex', args: [], env: {} };
    case 'custom':
      return { shell: ctx.character.name, args: [...(ctx.character.spawnArgs ?? [])], env: {} };
    case 'shell':
    default:
      return {
        shell: ctx.character.kind === 'shell' ? (ctx.character.shell ?? ctx.defaultShell) : ctx.defaultShell,
        args: [],
        env: {},
      };
  }
}

function resolveTailscale(
  t: Extract<TerminalTransport, { kind: 'tailscale' }>,
  ctx: TransportResolveContext,
): ResolvedTransport {
  const userHost = t.user ? `${t.user}@${t.host}` : t.host;
  const remoteShell = pickRemoteShellCommand(ctx);
  // `tailscale ssh` already bundles auth + host resolution. We pass
  // `--` so any flags intended for the remote shell don't get eaten
  // by the tailscale binary's own option parser.
  return {
    shell: 'tailscale',
    args: ['ssh', userHost, '--', ...remoteShell],
    env: { ELANOUS_REMOTE_HOST: t.host, ELANOUS_REMOTE_TRANSPORT: 'tailscale' },
  };
}

function resolveSsh(
  t: Extract<TerminalTransport, { kind: 'ssh' }>,
  ctx: TransportResolveContext,
): ResolvedTransport {
  const userHost = t.user ? `${t.user}@${t.host}` : t.host;
  const remoteShell = pickRemoteShellCommand(ctx);
  const portArgs = t.port ? ['-p', String(t.port)] : [];
  return {
    shell: 'ssh',
    // -t forces TTY allocation even when ssh is spawned inside a pipe.
    // Without it remote programs get "Pseudo-terminal not allocated" +
    // line-buffered behaviour.
    args: ['-t', ...portArgs, userHost, '--', ...remoteShell],
    env: { ELANOUS_REMOTE_HOST: t.host, ELANOUS_REMOTE_TRANSPORT: 'ssh' },
  };
}

/** Remote character dispatch. Mirrors resolveLocal but the binary
 *  lives on the remote host — we `exec` it (via login shell) so
 *  rc files run, PATH is populated, etc. */
function pickRemoteShellCommand(ctx: TransportResolveContext): string[] {
  switch (ctx.character.kind) {
    case 'claude-code':
      return ['bash', '-lc', 'exec claude-code'];
    case 'codex':
      return ['bash', '-lc', 'exec codex'];
    case 'custom':
      return ['bash', '-lc', `exec ${quoteForShell(ctx.character.name)} ${(ctx.character.spawnArgs ?? []).map(quoteForShell).join(' ')}`];
    case 'shell':
    default:
      // No command → ssh opens the user's default login shell
      // naturally. We still need *an* argv entry so the `--`
      // separator is meaningful; pass an empty exec that the
      // remote login shell swallows.
      return [];
  }
}

function quoteForShell(s: string): string {
  // Minimal shell quoting — wraps in single quotes and escapes any
  // embedded ones. Used only for remote command construction.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Short human label for a transport — used by UI badges + tool
 *  output. Keeps display code out of the data types. */
export function transportLabel(t: TerminalTransport): string {
  switch (t.kind) {
    case 'local':     return 'local';
    case 'tailscale': return `tailscale:${t.host}`;
    case 'ssh':       return `ssh:${t.user ? t.user + '@' : ''}${t.host}${t.port ? `:${t.port}` : ''}`;
  }
}
