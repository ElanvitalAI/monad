// WT-N-1 — file attachment store for PWA uploads.
//
// Receives multipart uploads (camera capture, file picker) and writes
// them to `/tmp/elanous-attachments/<id>-<safe-filename>` so subsequent
// chat / agent turns can reference them by id.
//
// Path lives under /tmp because (a) these are intentionally ephemeral
// (clipboard-equivalents from a phone or quick file drops), (b) macOS
// reaps /tmp on reboot so we don't accumulate user-data forever, and
// (c) it matches the Raycast `ctr.sh` workflow this feature mirrors.
//
// Scope kept narrow:
//   - Single endpoint ingest (multipart/form-data with `file` field)
//   - Filename sanitised + size capped (10 MB default)
//   - Returns `{ id, path, filename, mediaType, size }` so the PWA
//     can show a toast and the LLM tool layer can later turn the id
//     into an Attachment object.
//   - No metadata DB — directory listing is the source of truth. A
//     stale 7-day cleanup is a follow-up.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join as joinPath, resolve as resolvePath, extname } from 'node:path';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface AttachmentStoreEntry {
  id: string;
  path: string;
  filename: string;
  mediaType: string;
  size: number;
  createdAt: number;
}

export function defaultAttachmentBaseDir(): string {
  return joinPath('/tmp', 'elanous-attachments');
}

/** Generate a stable, filesystem-safe id. Includes a short timestamp
 *  so listing is roughly chronological without an external index. */
function newAttachmentId(now: number): string {
  const ts = now.toString(36);
  // 4 random base36 chars — ~20 bits, enough to avoid collisions in a
  // single millisecond window across the user's typical fleet.
  const suffix = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `att-${ts}-${suffix}`;
}

function sanitiseFilename(raw: string): string {
  // Allow alphanum + dot + dash + underscore; collapse anything else
  // to '-'. Then collapse sequences of dots (the `..` traversal token
  // is the chief concern, but `....pdf` → `.pdf` is also tidier). Cap
  // at 80 chars so the resulting path stays sane.
  let cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '-');
  cleaned = cleaned.replace(/\.{2,}/g, '.');
  // Strip leading/trailing dots/dashes — leading dot would create
  // hidden files; trailing dot is just ugly.
  cleaned = cleaned.replace(/^[.-]+/, '').replace(/[.-]+$/, '');
  cleaned = cleaned.slice(-80);
  return cleaned.length > 0 ? cleaned : 'file';
}

function detectMediaType(filename: string, fallback: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.heic': case '.heif': return 'image/heic';
    case '.pdf': return 'application/pdf';
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    default: return fallback || 'application/octet-stream';
  }
}

export interface SaveAttachmentOpts {
  blob: Blob;
  filename: string;
  /** Override base dir (tests). */
  baseDir?: string;
  /** Override max bytes (tests). Default 10 MB. */
  maxBytes?: number;
  /** Override clock for deterministic ids (tests). */
  now?: () => number;
}

export type SaveAttachmentResult =
  | { ok: true; entry: AttachmentStoreEntry }
  | { ok: false; reason: 'too-large' | 'empty' | 'write-failed'; detail?: string };

/** Persist `opts.blob` to disk and return the metadata. Pure-ish:
 *  filesystem write is the only side effect, and tests can redirect
 *  via `baseDir`. */
export async function saveAttachmentBlob(opts: SaveAttachmentOpts): Promise<SaveAttachmentResult> {
  if (opts.blob.size === 0) return { ok: false, reason: 'empty' };
  const cap = opts.maxBytes ?? MAX_BYTES;
  if (opts.blob.size > cap) return { ok: false, reason: 'too-large', detail: `${opts.blob.size} > ${cap}` };

  const now = (opts.now ?? Date.now)();
  const id = newAttachmentId(now);
  const safeName = sanitiseFilename(opts.filename || 'file');
  const baseDir = opts.baseDir ?? defaultAttachmentBaseDir();
  const filename = `${id}-${safeName}`;
  const filePath = resolvePath(joinPath(baseDir, filename));
  const root = resolvePath(baseDir);
  if (!filePath.startsWith(root)) {
    return { ok: false, reason: 'write-failed', detail: 'path traversal blocked' };
  }

  let buf: Buffer;
  try {
    const ab = await opts.blob.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: String(e) };
  }

  try {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(filePath, buf);
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: String(e) };
  }

  const mediaType = detectMediaType(safeName, opts.blob.type);
  return {
    ok: true,
    entry: {
      id,
      path: filePath,
      filename: safeName,
      mediaType,
      size: opts.blob.size,
      createdAt: now,
    },
  };
}

/** P-3 §6.9 (2026-05-07) — TTL cleanup. Sweep the attachment store and
 *  unlink files whose mtime is older than `maxAgeMs`. Returns the count
 *  of files removed. Default Q4=C policy is 30 days; the daemon boot
 *  loop calls this from the same setInterval that does session GC.
 *
 *  Best-effort — readdir / unlink failures don't throw; they're
 *  swallowed so a single bad entry can't break the rest of the sweep
 *  or the periodic timer. Returns 0 when the dir doesn't exist (first
 *  boot before any upload).
 *
 *  jsonl history references stay intact (the resolveAttachmentPath
 *  side returns null for unlinked ids — caller's existing 404 path
 *  handles "attachment expired" gracefully). */
export function gcAttachments(maxAgeMs: number, baseDir?: string): number {
  const dir = baseDir ?? defaultAttachmentBaseDir();
  if (!existsSync(dir)) return 0;
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let entries: string[];
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  const { unlinkSync } = require('node:fs') as typeof import('node:fs');
  for (const name of entries) {
    if (!name.startsWith('att-')) continue;
    const filePath = resolvePath(joinPath(dir, name));
    const root = resolvePath(dir);
    if (!filePath.startsWith(root)) continue;
    try {
      const fileStat = statSync(filePath);
      if (!fileStat.isFile()) continue;
      if (fileStat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        removed += 1;
      }
    } catch {
      /* per-file errors swallowed — sweep continues */
    }
  }
  return removed;
}

/** Resolve `id` (just the prefix, e.g. `att-...-...`) to its on-disk
 *  path. Used by the GET endpoint to verify the file exists before
 *  serving. Returns null when the id doesn't match anything. */
export function resolveAttachmentPath(id: string, baseDir?: string): string | null {
  if (!/^att-[a-z0-9]+-[a-z0-9]+$/.test(id)) return null;
  const dir = baseDir ?? defaultAttachmentBaseDir();
  // List the dir + match the id prefix. Cheap for dirs with <1000
  // entries; if attachment volume grows, swap for a sidecar index.
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const matches = readdirSync(dir).filter((f) => f.startsWith(`${id}-`));
    if (matches.length === 0) return null;
    const candidate = resolvePath(joinPath(dir, matches[0]!));
    const root = resolvePath(dir);
    if (!candidate.startsWith(root)) return null;
    return candidate;
  } catch {
    return null;
  }
}
