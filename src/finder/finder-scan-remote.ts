// Remote finder scan — T5-I1.
//
// Sibling of finder-scan.ts. Runs `ssh <host> fd/find` and streams
// the result back. Same 50k cap, same newline-split parsing, same
// streaming semantics.
//
// Backend probe: one-shot `ssh host 'command -v fd'` at first call
// per host. Result is cached in-memory for the session so we don't
// pay an extra round-trip on every scan.

import { spawn, type ChildProcess } from 'node:child_process';
import type { SshHost } from '../ssh/ssh-hosts.js';
import { sshTarget, shellQuoteRemote, DEFAULT_TIMEOUT_MS } from '../ssh/ssh-fs.js';

export const DEFAULT_REMOTE_MAX = 50_000;

export interface RemoteFinderScanOpts {
  host: SshHost;
  /** Remote root to scan. Defaults to '~'. Single-quote escaped
   *  by shellQuoteRemote so paths with spaces work. */
  root?: string;
  maxFiles?: number;
  includeHidden?: boolean;
  /** Override the resolved backend. When unset, we probe. */
  backend?: 'fd' | 'find';
}

export interface RemoteFinderScanResult {
  paths: string[];
  truncated: boolean;
  backend: 'fd' | 'find';
  durationMs: number;
  host: string;
}

export interface RemoteFinderScanDeps {
  spawnImpl?: typeof spawn;
  /** When provided, skips the `command -v fd` probe. */
  probeBackend?: (host: SshHost) => Promise<'fd' | 'find'>;
  now?: () => number;
  /** Per-call timeout. Default 15s same as ssh-fs. */
  timeoutMs?: number;
}

// Per-host backend cache. Cleared between sessions via
// _resetRemoteFinderCacheForTesting().
const backendCache = new Map<string, 'fd' | 'find'>();

export function _resetRemoteFinderCacheForTesting(): void {
  backendCache.clear();
}

async function probeRemoteBackend(
  host: SshHost,
  deps: RemoteFinderScanDeps,
): Promise<'fd' | 'find'> {
  const cacheKey = `${host.name}:${host.host}`;
  const cached = backendCache.get(cacheKey);
  if (cached) return cached;
  if (deps.probeBackend) {
    const r = await deps.probeBackend(host);
    backendCache.set(cacheKey, r);
    return r;
  }
  // `command -v fd` prints the path on success (exit 0), nothing
  // on failure (exit 1). We use the exit code.
  const spawner = deps.spawnImpl ?? spawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const code = await new Promise<number>((resolve) => {
    const child = spawner('ssh', [
      '-o', 'BatchMode=yes', sshTarget(host),
      'command -v fd >/dev/null 2>&1',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(-1);
    }, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    child.on('error', () => { clearTimeout(timer); resolve(-1); });
    child.on('close', (c) => { clearTimeout(timer); resolve(c ?? 1); });
  });
  const backend: 'fd' | 'find' = code === 0 ? 'fd' : 'find';
  backendCache.set(cacheKey, backend);
  return backend;
}

/** Build the REMOTE shell command for fd/find. Quoting matters
 *  because the whole string travels through `ssh host <cmd>`. */
function buildRemoteCmd(backend: 'fd' | 'find', root: string, hidden: boolean): string {
  const q = shellQuoteRemote(root);
  if (backend === 'fd') {
    const flags = ['--type f', '--color never'];
    if (hidden) flags.push('--hidden');
    flags.push('--exclude .git', '--exclude node_modules');
    return `fd ${flags.join(' ')} . ${q}`;
  }
  const parts = [`find ${q} -type f`];
  parts.push(`-not -path '*/.git/*'`);
  parts.push(`-not -path '*/node_modules/*'`);
  if (!hidden) parts.push(`-not -path '*/.*'`);
  return parts.join(' ');
}

export async function scanRemoteFinder(
  opts: RemoteFinderScanOpts,
  deps: RemoteFinderScanDeps = {},
): Promise<RemoteFinderScanResult> {
  const root = opts.root ?? '~';
  const max = opts.maxFiles ?? DEFAULT_REMOTE_MAX;
  const hidden = opts.includeHidden ?? true;
  const backend = opts.backend ?? (await probeRemoteBackend(opts.host, deps));
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawner = deps.spawnImpl ?? spawn;
  const startedAt = now();

  const paths: string[] = [];
  let truncated = false;

  const remoteCmd = buildRemoteCmd(backend, root, hidden);

  await new Promise<void>((resolve) => {
    const child: ChildProcess = spawner('ssh', [
      '-o', 'BatchMode=yes', sshTarget(opts.host), remoteCmd,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve();
    }, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      buf += chunk.toString('utf-8');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) {
          paths.push(line);
          if (paths.length >= max) {
            truncated = true;
            try { child.kill('SIGTERM'); } catch { /* ignore */ }
            clearTimeout(timer);
            resolve();
            return;
          }
        }
        idx = buf.indexOf('\n');
      }
    });
    child.on('error', () => { clearTimeout(timer); resolve(); });
    child.on('close', () => {
      clearTimeout(timer);
      if (!truncated && buf) {
        paths.push(buf);
        if (paths.length > max) { paths.length = max; truncated = true; }
      }
      resolve();
    });
  });

  return {
    paths,
    truncated,
    backend,
    host: opts.host.name,
    durationMs: now() - startedAt,
  };
}

/** Strip a remote root prefix (absolute or ~-prefixed) so the
 *  picker shows bare relative paths. */
export function relativizeRemoteResults(paths: string[], root: string): string[] {
  // Expand `~` → $HOME on the local side for path trimming only.
  // The remote output uses the same literal we sent as root so
  // comparison is safe.
  const withSlash = root.endsWith('/') ? root : root + '/';
  return paths.map(p => {
    if (p === root) return '.';
    if (p.startsWith(withSlash)) return p.slice(withSlash.length);
    return p;
  });
}
