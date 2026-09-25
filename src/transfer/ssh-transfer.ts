// SSH transfer backend — T5-J3.
//
// Given a list of local file paths + a transfer destination
// (TransferTarget kind=ssh), scp the files into the configured
// remote directory. Reports per-file progress via a caller-supplied
// callback so the dashboard can stream "1/3 foo.jpg done" updates
// into the log pane.
//
// Rules:
//   • Serial transfers (one scp per file). The alternative — a
//     single scp call with multiple args — works but we lose
//     per-file progress + per-file error surfacing.
//   • Creates the remote dir first with `ssh host 'mkdir -p <dir>'`
//     so a missing ~/Downloads/ doesn't cascade-fail.
//   • Each file inherits scpUpload's 15s timeout from ssh-fs.
//
// No overwrite prompt — scp overwrites silently. Users who want
// safer semantics should use the remote-edit flow (T4-E5) which
// has drift detection.

import { basename } from 'node:path';
import { scpUpload, type SshFsDeps, type SshResult } from '../ssh/ssh-fs.js';
import type { SshHost } from '../ssh/ssh-hosts.js';
import { spawn } from 'node:child_process';

export interface SshTransferFile {
  /** Absolute local path. */
  localPath: string;
  /** Optional size for progress UX. */
  size?: number;
}

export interface SshTransferOpts {
  host: SshHost;
  remoteDir: string;
  files: SshTransferFile[];
  onProgress?: (evt: SshTransferProgress) => void;
  /** When false (default), abort the rest of the batch as soon as
   *  one file fails. Pass `true` to keep going. */
  continueOnError?: boolean;
  /** When true, skip the `ssh mkdir -p` prelude (tests). */
  skipMkdir?: boolean;
}

export type SshTransferProgress =
  | { phase: 'mkdir'; remoteDir: string }
  | { phase: 'start'; index: number; total: number; localPath: string }
  | { phase: 'done';  index: number; total: number; localPath: string }
  | { phase: 'error'; index: number; total: number; localPath: string; reason: string; message: string };

export interface SshTransferResult {
  uploaded: string[];
  failed: Array<{ localPath: string; reason: string; message: string }>;
  remoteDir: string;
  host: string;
}

function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

function remoteDestinationForFile(remoteDir: string, localPath: string): string {
  return ensureTrailingSlash(remoteDir) + basename(localPath);
}

function execMkdir(
  host: SshHost,
  remoteDir: string,
  deps: SshFsDeps,
): Promise<SshResult<void>> {
  const spawner = deps.spawnImpl ?? spawn;
  return new Promise((resolve) => {
    const child = spawner('ssh', [
      '-o', 'BatchMode=yes', host.user ? `${host.user}@${host.host}` : host.host,
      `mkdir -p ${shellQuote(remoteDir)}`,
    ]);
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf-8'); });
    child.on('error', (err) => resolve({
      ok: false, reason: 'spawn-failed', message: err.message,
    }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, value: undefined as void });
      else resolve({
        ok: false, reason: 'exit-nonzero', exitCode: code ?? 1,
        message: stderr.trim() || `mkdir exited ${code}`,
      });
    });
  });
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export async function sshTransfer(
  opts: SshTransferOpts,
  deps: SshFsDeps = {},
): Promise<SshTransferResult> {
  const uploaded: string[] = [];
  const failed: Array<{ localPath: string; reason: string; message: string }> = [];

  if (!opts.skipMkdir) {
    opts.onProgress?.({ phase: 'mkdir', remoteDir: opts.remoteDir });
    const mk = await execMkdir(opts.host, opts.remoteDir, deps);
    if (!mk.ok && !opts.continueOnError) {
      // Can't create destination — surface as an error for every
      // file so the caller sees the full batch failed.
      for (let i = 0; i < opts.files.length; i++) {
        const f = opts.files[i]!;
        failed.push({ localPath: f.localPath, reason: mk.reason, message: mk.message });
        opts.onProgress?.({
          phase: 'error', index: i, total: opts.files.length,
          localPath: f.localPath, reason: mk.reason, message: mk.message,
        });
      }
      return { uploaded, failed, remoteDir: opts.remoteDir, host: opts.host.name };
    }
  }

  for (let i = 0; i < opts.files.length; i++) {
    const f = opts.files[i]!;
    opts.onProgress?.({ phase: 'start', index: i, total: opts.files.length, localPath: f.localPath });
    const dest = remoteDestinationForFile(opts.remoteDir, f.localPath);
    const r = await scpUpload(opts.host, f.localPath, dest, deps);
    if (r.ok) {
      uploaded.push(f.localPath);
      opts.onProgress?.({ phase: 'done', index: i, total: opts.files.length, localPath: f.localPath });
    } else {
      failed.push({ localPath: f.localPath, reason: r.reason, message: r.message });
      opts.onProgress?.({
        phase: 'error', index: i, total: opts.files.length,
        localPath: f.localPath, reason: r.reason, message: r.message,
      });
      if (!opts.continueOnError) break;
    }
  }

  return { uploaded, failed, remoteDir: opts.remoteDir, host: opts.host.name };
}
