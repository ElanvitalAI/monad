// Remote file edit — T4-E5.
//
// Round-trips a remote file through a local temp copy so the user
// can edit it with `$EDITOR` (or the mini-vi fallback) and the
// result is scp'd back on save. Mirrors the shell pattern:
//
//   scp host:path /tmp/monad-ssh-XXXXXX
//   $EDITOR /tmp/monad-ssh-XXXXXX
//   scp /tmp/monad-ssh-XXXXXX host:path
//
// Safety guard: before uploading, we compare the ORIGINAL file's
// checksum against the remote's current checksum. If someone else
// changed the remote while we were editing, we refuse the upload
// and surface a warning. User can force via `force: true`.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  readRemoteFile,
  scpDownload,
  scpUpload,
  type SshFsDeps,
  type SshResult,
} from './ssh-fs.js';
import type { SshHost } from './ssh-hosts.js';

export interface RemoteEditHandle {
  /** Local path the editor sees. Remove after use. */
  localPath: string;
  /** Original content checksum (sha1 hex) at download time. */
  originalChecksum: string;
  /** Remote absolute path the content came from. */
  remotePath: string;
  /** Host. */
  host: SshHost;
}

export type RemoteEditPrepResult =
  | { ok: true; handle: RemoteEditHandle }
  | { ok: false; reason: string; message: string };

export type RemoteEditSaveResult =
  | { ok: true; uploadedBytes: number }
  | { ok: false; reason: 'remote-drift' | 'upload-failed' | 'read-local-failed'; message: string };

function sha1Hex(body: string): string {
  return createHash('sha1').update(body).digest('hex');
}

function makeTempPath(remotePath: string): string {
  const dir = mkdtempSync(joinPath(tmpdir(), 'monad-ssh-'));
  const basename = remotePath.split('/').pop() || 'file';
  return joinPath(dir, basename);
}

/** Download a remote file to a local temp path. Caller launches
 *  `$EDITOR localPath`; on save, call completeRemoteEdit(). */
export async function prepareRemoteEdit(
  host: SshHost,
  remotePath: string,
  deps: SshFsDeps = {},
): Promise<RemoteEditPrepResult> {
  // Use readRemoteFile (not scp) for the checksum so we avoid a
  // second network roundtrip. The file body becomes both the
  // original-checksum source AND what we write to the temp file.
  const readRes = await readRemoteFile(host, remotePath, deps);
  if (!readRes.ok) {
    return {
      ok: false,
      reason: readRes.reason,
      message: readRes.message,
    };
  }
  const body = readRes.value;
  const localPath = makeTempPath(remotePath);
  try {
    writeFileSync(localPath, body, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      reason: 'local-write-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    ok: true,
    handle: {
      localPath,
      originalChecksum: sha1Hex(body),
      remotePath,
      host,
    },
  };
}

/** Upload the edited local file back to the remote path. Verifies
 *  the remote checksum still matches what we originally downloaded.
 *  Pass `force: true` to skip the drift check (discards remote
 *  side-writes). Returns the uploaded byte count on success. */
export async function completeRemoteEdit(
  handle: RemoteEditHandle,
  opts: { force?: boolean } = {},
  deps: SshFsDeps = {},
): Promise<RemoteEditSaveResult> {
  let editedBody: string;
  try {
    editedBody = readFileSync(handle.localPath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      reason: 'read-local-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!opts.force) {
    const currentRemote = await readRemoteFile(handle.host, handle.remotePath, deps);
    if (currentRemote.ok) {
      const currentChecksum = sha1Hex(currentRemote.value);
      if (currentChecksum !== handle.originalChecksum) {
        return {
          ok: false,
          reason: 'remote-drift',
          message: `remote changed since download (checksum mismatch). Re-download or pass force:true to overwrite.`,
        };
      }
    }
    // If we couldn't re-read the remote, fall through — the upload
    // will surface the real error below.
  }

  const upload = await uploadLocalToRemote(handle.host, handle.localPath, handle.remotePath, editedBody, deps);
  if (!upload.ok) {
    return {
      ok: false,
      reason: 'upload-failed',
      message: upload.reason + ': ' + upload.message,
    };
  }
  return { ok: true, uploadedBytes: Buffer.byteLength(editedBody, 'utf-8') };
}

async function uploadLocalToRemote(
  host: SshHost,
  localPath: string,
  remotePath: string,
  _editedBody: string,
  deps: SshFsDeps,
): Promise<SshResult<void>> {
  return scpUpload(host, localPath, remotePath, deps);
}

/** Best-effort cleanup of the local temp file. Errors are
 *  swallowed — we don't want an unlink failure to eat a successful
 *  save result. */
export function cleanupRemoteEdit(handle: RemoteEditHandle): void {
  try { unlinkSync(handle.localPath); } catch { /* ignore */ }
}

/** Convenience: does prepare + launchEditor + complete + cleanup
 *  in one call. The caller provides a launcher that takes the
 *  local path and returns whether the edit was successful. */
export async function editRemoteFile(
  host: SshHost,
  remotePath: string,
  launch: (localPath: string) => Promise<{ ok: boolean; message?: string }>,
  deps: SshFsDeps = {},
): Promise<
  | { ok: true; uploadedBytes: number }
  | { ok: false; reason: string; message: string }
> {
  const prep = await prepareRemoteEdit(host, remotePath, deps);
  if (!prep.ok) return prep;
  try {
    const launched = await launch(prep.handle.localPath);
    if (!launched.ok) {
      return { ok: false, reason: 'editor-failed', message: launched.message ?? 'editor exited without saving' };
    }
    const save = await completeRemoteEdit(prep.handle, {}, deps);
    if (!save.ok) return { ok: false, reason: save.reason, message: save.message };
    return { ok: true, uploadedBytes: save.uploadedBytes };
  } finally {
    cleanupRemoteEdit(prep.handle);
  }
}

// Silence unused-export lint — scpDownload stays in the module
// surface in case callers want to skip the readRemoteFile path
// (binary files, large files).
export { scpDownload };
