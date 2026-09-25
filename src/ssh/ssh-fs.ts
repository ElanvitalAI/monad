// SSH filesystem backend — T4-E2.
//
// Thin wrappers around `ssh <host> <cmd>` + `scp` invocations so
// the rest of the app can treat a remote machine like a read/write
// filesystem. No new npm deps — we shell out.
//
// Surface:
//
//   listRemoteDir(host, path)    ls -la with --time-style=+%s
//   readRemoteFile(host, path)   cat  (UTF-8 assumed)
//   statRemoteFile(host, path)   stat %s %Y %F (size, mtime, type)
//   writeRemoteFile(host, path, body)   tee  (stdin → body)
//   scpDownload(host, remote, local)    scp
//   scpUpload(host, local, remote)      scp
//
// All calls accept a 15s default timeout. Every return surfaces an
// `ok` discriminator so callers can branch without try/catch.
//
// Path quoting: the remote path is wrapped in single quotes at the
// shell-side; any single-quotes inside the path are escaped
// `'\''`-style. The host string is passed as a separate argv arg
// to `ssh` (not through the shell), so tailscale MagicDNS names
// with dashes/dots work.

import { spawn, type SpawnOptions } from 'node:child_process';
import type { SshHost } from './ssh-hosts.js';

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface SshFsDeps {
  /** Override spawn — tests substitute a fake. */
  spawnImpl?: typeof spawn;
  timeoutMs?: number;
}

export type SshResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'timeout' | 'spawn-failed' | 'exit-nonzero'; message: string; exitCode?: number };

export interface RemoteDirEntry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;     // unix seconds
  mode: string;      // raw `ls -l` perms column, e.g. "drwxr-xr-x"
}

export interface RemoteFileStat {
  size: number;
  mtime: number;
  kind: 'file' | 'directory' | 'symbolic link' | 'other';
}

/** Escape a remote shell argument for single-quote wrapping. */
export function shellQuoteRemote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Build the ssh target string (user@host or host). */
export function sshTarget(h: SshHost): string {
  return h.user ? `${h.user}@${h.host}` : h.host;
}

interface ExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function execSsh(
  argv: readonly string[],
  deps: SshFsDeps,
  stdin?: string,
): Promise<ExecOutput | { timeout: true }> {
  const spawner = deps.spawnImpl ?? spawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const opts: SpawnOptions = { stdio: ['pipe', 'pipe', 'pipe'] };
    const child = spawner(argv[0]!, argv.slice(1), opts);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ timeout: true });
    }, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf-8'); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf-8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + err.message, exitCode: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    if (typeof stdin === 'string') {
      try { child.stdin?.end(stdin); }
      catch { /* already closed */ }
    } else {
      try { child.stdin?.end(); }
      catch { /* ignore */ }
    }
  });
}

function wrapResult<T>(
  out: ExecOutput | { timeout: true },
  mapOk: (stdout: string) => T,
): SshResult<T> {
  if ('timeout' in out) {
    return { ok: false, reason: 'timeout', message: `ssh timed out after ${DEFAULT_TIMEOUT_MS}ms` };
  }
  if (out.exitCode === -1) {
    return { ok: false, reason: 'spawn-failed', message: out.stderr.trim() || 'spawn error' };
  }
  if (out.exitCode !== 0) {
    return {
      ok: false,
      reason: 'exit-nonzero',
      exitCode: out.exitCode,
      message: out.stderr.trim() || out.stdout.trim() || `exit ${out.exitCode}`,
    };
  }
  return { ok: true, value: mapOk(out.stdout) };
}

// ─── Directory listing ─────────────────────────────────────────────

/** Parse a single `ls -la --time-style=+%s` line into an entry.
 *  Accepts both GNU and BSD formats (which differ only in the
 *  trailing `name -> target` for symlinks). Returns null for blank
 *  or malformed lines. */
export function parseLsLine(line: string): RemoteDirEntry | null {
  const m = line.match(
    /^([dl\-][rwxstST\-]{9})\s*\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/,
  );
  if (!m) return null;
  const mode = m[1]!;
  const size = parseInt(m[2]!, 10);
  const mtime = parseInt(m[3]!, 10);
  let name = m[4]!;
  const isSymlink = mode.startsWith('l');
  const isDir = mode.startsWith('d');
  if (isSymlink) {
    // `name -> target` — drop the target for display
    const arrow = name.indexOf(' -> ');
    if (arrow >= 0) name = name.slice(0, arrow);
  }
  if (!name || name === '.' || name === '..') return null;
  return { name, isDir, isSymlink, size, mtime, mode };
}

export async function listRemoteDir(
  host: SshHost,
  path: string,
  deps: SshFsDeps = {},
): Promise<SshResult<RemoteDirEntry[]>> {
  const out = await execSsh(
    ['ssh', '-o', 'BatchMode=yes', sshTarget(host), `ls -la --time-style=+%s ${shellQuoteRemote(path)}`],
    deps,
  );
  return wrapResult(out, (stdout) => {
    const lines = stdout.split('\n');
    const entries: RemoteDirEntry[] = [];
    for (const line of lines) {
      const entry = parseLsLine(line);
      if (entry) entries.push(entry);
    }
    return entries;
  });
}

// ─── File read ────────────────────────────────────────────────────

export async function readRemoteFile(
  host: SshHost,
  path: string,
  deps: SshFsDeps = {},
): Promise<SshResult<string>> {
  const out = await execSsh(
    ['ssh', '-o', 'BatchMode=yes', sshTarget(host), `cat ${shellQuoteRemote(path)}`],
    deps,
  );
  return wrapResult(out, (stdout) => stdout);
}

// ─── Stat ─────────────────────────────────────────────────────────

export async function statRemoteFile(
  host: SshHost,
  path: string,
  deps: SshFsDeps = {},
): Promise<SshResult<RemoteFileStat>> {
  // Use GNU stat format fields — BSD `stat` requires -f/-t flags so
  // for macOS targets we detect at parse time. Both respond to
  // `stat -c`: GNU honors it; BSD errors. On BSD failure we retry
  // with BSD syntax.
  const gnuCmd = `stat -c '%s %Y %F' ${shellQuoteRemote(path)}`;
  const bsdCmd = `stat -f '%z %m %HT' ${shellQuoteRemote(path)}`;
  const combined = `${gnuCmd} 2>/dev/null || ${bsdCmd}`;
  const out = await execSsh(
    ['ssh', '-o', 'BatchMode=yes', sshTarget(host), combined],
    deps,
  );
  return wrapResult(out, (stdout) => {
    const line = stdout.trim().split('\n').pop() ?? '';
    const parts = line.split(/\s+/);
    const size = parseInt(parts[0] ?? '0', 10) || 0;
    const mtime = parseInt(parts[1] ?? '0', 10) || 0;
    const kindRaw = parts.slice(2).join(' ').toLowerCase();
    const kind: RemoteFileStat['kind'] =
      kindRaw.includes('directory') ? 'directory'
      : kindRaw.includes('symbolic') ? 'symbolic link'
      : kindRaw.includes('regular') || kindRaw.includes('file') ? 'file'
      : 'other';
    return { size, mtime, kind };
  });
}

// ─── Write ────────────────────────────────────────────────────────

export async function writeRemoteFile(
  host: SshHost,
  path: string,
  body: string,
  deps: SshFsDeps = {},
): Promise<SshResult<void>> {
  const out = await execSsh(
    ['ssh', '-o', 'BatchMode=yes', sshTarget(host), `tee ${shellQuoteRemote(path)} >/dev/null`],
    deps,
    body,
  );
  return wrapResult(out, () => undefined as void);
}

// ─── scp helpers ──────────────────────────────────────────────────

export async function scpDownload(
  host: SshHost,
  remotePath: string,
  localPath: string,
  deps: SshFsDeps = {},
): Promise<SshResult<void>> {
  const src = `${sshTarget(host)}:${remotePath.replace(/"/g, '\\"')}`;
  const out = await execSsh(
    ['scp', '-o', 'BatchMode=yes', src, localPath],
    deps,
  );
  return wrapResult(out, () => undefined as void);
}

export async function scpUpload(
  host: SshHost,
  localPath: string,
  remotePath: string,
  deps: SshFsDeps = {},
): Promise<SshResult<void>> {
  const dst = `${sshTarget(host)}:${remotePath.replace(/"/g, '\\"')}`;
  const out = await execSsh(
    ['scp', '-o', 'BatchMode=yes', localPath, dst],
    deps,
  );
  return wrapResult(out, () => undefined as void);
}
