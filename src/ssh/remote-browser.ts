// Remote browser pane helpers — T4-E3.
//
// Bridges WorkingDirState.remote to the ssh-fs backend. When the
// dashboard's workingDir has `remote = { host, cwd }`, these helpers
// populate the browser pane's `entries` and a caller-owned preview
// state by calling listRemoteDir / readRemoteFile instead of touching
// the local fs.
//
// Kept standalone (no dashboard.ts import) so tests can drive a
// WorkingDirState + a fake ssh-fs pair.
//
// Contract:
//
//   await refreshRemoteWorkingDir(ws, {}, preview)
//     Reads the remote dir at ws.remote.cwd and hydrates ws.entries
//     + ws.cursor + ws.offset while clearing preview.
//
//   await refreshRemoteWorkingDirPreview(ws, {}, preview)
//     Reads the file or child dir under the cursor into
//     preview.previewLines (first 64KB; no binary detection — remote
//     stat reports size only).
//
// On SSH error the helpers fall back to a single "[ssh: <reason>]"
// entry so the browser pane doesn't silently blank out.

import type { WorkingDirState, FsEntry } from '../working-dir/index.js';
import type { FileSortMode } from '../workspace-types.js';
import type { SshHost } from './ssh-hosts.js';
import {
  listRemoteDir,
  readRemoteFile,
  type SshFsDeps,
  type RemoteDirEntry,
  type SshResult,
} from './ssh-fs.js';
import { basename as pathBasename, join as pathJoin } from 'node:path';

export const REMOTE_PREVIEW_MAX_BYTES = 64 * 1024;

export interface RemotePreviewState {
  previewPath: string | null;
  previewLines: string[];
  previewOffset: number;
}

function mapEntry(e: RemoteDirEntry, parentDir: string): FsEntry {
  const ext = e.isDir ? '' : (() => {
    const dot = e.name.lastIndexOf('.');
    return dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
  })();
  return {
    name: e.name,
    absPath: pathJoin(parentDir, e.name),
    isDir: e.isDir,
    size: e.size,
    mtime: e.mtime * 1000,
    ext,
  };
}

function sortEntries(entries: FsEntry[], mode: FileSortMode): FsEntry[] {
  const dirs = entries.filter(e => e.isDir);
  const files = entries.filter(e => !e.isDir);
  const cmpName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name);
  const cmpMtime = (a: FsEntry, b: FsEntry) => b.mtime - a.mtime;
  const cmpSize = (a: FsEntry, b: FsEntry) => b.size - a.size;
  const cmp =
    mode === 'mtime' ? cmpMtime
    : mode === 'size' ? cmpSize
    : cmpName;
  dirs.sort(cmpName);
  files.sort(cmp);
  return [...dirs, ...files];
}

function parentDir(path: string): string | null {
  if (path === '/' || path === '') return null;
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return '/';
  return path.slice(0, idx);
}

export async function refreshRemoteWorkingDir(
  ws: WorkingDirState,
  deps: SshFsDeps = {},
  preview: RemotePreviewState,
): Promise<void> {
  if (!ws.remote) return;
  const host = ws.remote.host;
  const cwd = ws.remote.cwd || '/';
  const r = await listRemoteDir(host, cwd, deps);
  if (!r.ok) {
    ws.entries = [errorEntry(r, cwd)];
    ws.cursor = 0;
    ws.offset = 0;
    preview.previewPath = null;
    preview.previewLines = [`[ssh ${host.name}] ${r.reason}: ${r.message}`];
    return;
  }
  const mapped = r.value
    .filter(e => ws.showHidden || !e.name.startsWith('.'))
    .map(e => mapEntry(e, cwd));
  // Prepend `..` sentinel if there's a parent dir.
  const pd = parentDir(cwd);
  const entries: FsEntry[] = [];
  if (pd !== null) {
    entries.push({
      name: '..',
      absPath: pd,
      isDir: true,
      size: 0,
      mtime: 0,
      ext: '',
    });
  }
  entries.push(...sortEntries(mapped, ws.sortMode));
  ws.entries = entries;
  ws.cursor = Math.min(ws.cursor, Math.max(0, entries.length - 1));
  ws.offset = Math.min(ws.offset, ws.cursor);
  preview.previewPath = null;
  preview.previewLines = [];
  preview.previewOffset = 0;
}

export async function refreshRemoteWorkingDirPreview(
  ws: WorkingDirState,
  deps: SshFsDeps = {},
  preview: RemotePreviewState,
): Promise<void> {
  if (!ws.remote) return;
  const focused = ws.entries[ws.cursor];
  if (!focused) {
    preview.previewPath = null;
    preview.previewLines = [];
    return;
  }
  if (focused.isDir) {
    // Children of the focused directory.
    const r = await listRemoteDir(ws.remote.host, focused.absPath, deps);
    preview.previewPath = focused.absPath;
    if (!r.ok) {
      preview.previewLines = [`[ssh] ${r.reason}: ${r.message}`];
    } else {
      preview.previewLines = r.value
        .filter(e => ws.showHidden || !e.name.startsWith('.'))
        .map(e => (e.isDir ? '📁 ' : '   ') + e.name);
    }
    return;
  }
  // File preview — refuse to read files > preview cap (remote size
  // comes from the ls line so we have it without a second call).
  preview.previewPath = focused.absPath;
  if (focused.size > REMOTE_PREVIEW_MAX_BYTES) {
    preview.previewLines = [
      `[remote file ${focused.size} bytes — exceeds preview cap ${REMOTE_PREVIEW_MAX_BYTES}]`,
      'Use `e` to open in the editor.',
    ];
    return;
  }
  const r = await readRemoteFile(ws.remote.host, focused.absPath, deps);
  if (!r.ok) {
    preview.previewLines = [`[ssh] ${r.reason}: ${r.message}`];
    return;
  }
  preview.previewLines = r.value.split('\n');
}

function errorEntry(r: SshResult<unknown> & { ok: false }, cwd: string): FsEntry {
  return {
    name: `[ssh ${r.reason}]`,
    absPath: cwd,
    isDir: false,
    size: 0,
    mtime: 0,
    ext: '',
  };
}

/** Enter a remote directory (used by Enter on a dir entry or
 *  left-arrow to go up). Does NOT refresh — caller should follow
 *  up with refreshRemoteWorkingDir. */
export function enterRemoteDirectory(ws: WorkingDirState, absPath: string): void {
  if (!ws.remote) return;
  ws.remote = { host: ws.remote.host, cwd: absPath };
  ws.cursor = 0;
  ws.offset = 0;
}

/** Start remote mode: seed ws.remote with the host + starting cwd. */
export function startRemoteMode(
  ws: WorkingDirState,
  host: SshHost,
  cwd: string = '~',
  preview: RemotePreviewState,
): void {
  ws.remote = { host, cwd };
  ws.cursor = 0;
  ws.offset = 0;
  ws.selected.clear();
  preview.previewPath = null;
  preview.previewLines = [];
  preview.previewOffset = 0;
}

/** End remote mode. Caller restores local cwd + refreshes. */
export function endRemoteMode(
  ws: WorkingDirState,
  preview: RemotePreviewState,
): void {
  ws.remote = null;
  ws.cursor = 0;
  ws.offset = 0;
  ws.selected.clear();
  preview.previewPath = null;
  preview.previewLines = [];
  preview.previewOffset = 0;
}

/** Human-friendly badge shown in the HUD when remote mode is on. */
export function remoteBadge(ws: WorkingDirState): string | null {
  if (!ws.remote) return null;
  return `@${ws.remote.host.name}:${ws.remote.cwd}`;
}

export const _testing = { mapEntry, parentDir, sortEntries };
