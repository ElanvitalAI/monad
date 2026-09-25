// WT-N-1 — attachment-store: blob → disk + path resolution.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  gcAttachments,
  resolveAttachmentPath,
  saveAttachmentBlob,
} from '../src/boot/attachment-store';

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(joinPath(tmpdir(), 'monad-attach-test-'));
});

afterEach(() => {
  try { rmSync(baseDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('saveAttachmentBlob', () => {
  test('writes blob to disk + returns metadata', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    const result = await saveAttachmentBlob({
      blob,
      filename: 'photo.jpg',
      baseDir,
      now: () => 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.filename).toBe('photo.jpg');
    expect(result.entry.mediaType).toBe('image/jpeg');
    expect(result.entry.size).toBe(4);
    expect(result.entry.id).toMatch(/^att-/);
    expect(existsSync(result.entry.path)).toBe(true);
    const written = readFileSync(result.entry.path);
    expect(written.length).toBe(4);
    expect(written[0]).toBe(0xff);
  });

  test('rejects empty blob', async () => {
    const blob = new Blob([], { type: 'image/png' });
    const result = await saveAttachmentBlob({ blob, filename: 'empty.png', baseDir });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('empty');
  });

  test('rejects oversized blob', async () => {
    const blob = new Blob([new Uint8Array(20)], { type: 'image/png' });
    const result = await saveAttachmentBlob({
      blob, filename: 'big.png', baseDir, maxBytes: 8,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('too-large');
  });

  test('sanitises filename (path traversal + weird chars)', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await saveAttachmentBlob({
      blob,
      filename: '../../../etc/passwd',
      baseDir,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // No '..' or '/' in saved filename
    expect(result.entry.filename).not.toContain('..');
    expect(result.entry.filename).not.toContain('/');
    expect(result.entry.path.startsWith(baseDir)).toBe(true);
  });

  test('detects media type from extension', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: '' }); // no Blob.type
    const result = await saveAttachmentBlob({
      blob,
      filename: 'image.png',
      baseDir,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.mediaType).toBe('image/png');
  });

  test('falls back to Blob.type when no extension', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'application/foo' });
    const result = await saveAttachmentBlob({
      blob,
      filename: 'noext',
      baseDir,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.mediaType).toBe('application/foo');
  });
});

describe('resolveAttachmentPath', () => {
  test('returns null for invalid id format', () => {
    expect(resolveAttachmentPath('not-an-id', baseDir)).toBeNull();
    expect(resolveAttachmentPath('../etc/passwd', baseDir)).toBeNull();
  });

  test('returns null when nothing matches', () => {
    expect(resolveAttachmentPath('att-abc-1234', baseDir)).toBeNull();
  });

  test('returns path after save', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' });
    const saved = await saveAttachmentBlob({
      blob, filename: 'x.png', baseDir, now: () => 1_700_000_000_000,
    });
    if (!saved.ok) throw new Error('save failed');
    const resolved = resolveAttachmentPath(saved.entry.id, baseDir);
    expect(resolved).toBe(saved.entry.path);
  });
});

// P-3 §6.9 (2026-05-07) Q4=C — attachment TTL cleanup.
describe('gcAttachments — TTL sweep', () => {
  test('returns 0 when baseDir does not exist', () => {
    expect(gcAttachments(1000, joinPath(baseDir, 'no-such-subdir'))).toBe(0);
  });

  test('removes only files older than maxAgeMs', async () => {
    const oldBlob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' });
    const newBlob = new Blob([new Uint8Array([3, 4])], { type: 'image/png' });
    const oldSave = await saveAttachmentBlob({ blob: oldBlob, filename: 'old.png', baseDir });
    const newSave = await saveAttachmentBlob({ blob: newBlob, filename: 'new.png', baseDir });
    if (!oldSave.ok || !newSave.ok) throw new Error('save failed');
    // Backdate the old file's mtime to 60 days ago so a 30-day TTL
    // hits it. The new file keeps `now` mtime so it survives.
    const sixtyDaysAgo = (Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(oldSave.entry.path, sixtyDaysAgo, sixtyDaysAgo);
    const removed = gcAttachments(30 * 24 * 60 * 60 * 1000, baseDir);
    expect(removed).toBe(1);
    expect(existsSync(oldSave.entry.path)).toBe(false);
    expect(existsSync(newSave.entry.path)).toBe(true);
  });

  test('non-att-prefixed files are ignored (defensive — only sweeps store-owned)', () => {
    // Place a stray file directly in baseDir; gcAttachments must not
    // touch it because the filename doesn't start with `att-`.
    const stray = joinPath(baseDir, 'stray.png');
    writeFileSync(stray, new Uint8Array([0]));
    const sixtyDaysAgo = (Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(stray, sixtyDaysAgo, sixtyDaysAgo);
    const removed = gcAttachments(30 * 24 * 60 * 60 * 1000, baseDir);
    expect(removed).toBe(0);
    expect(existsSync(stray)).toBe(true);
  });

  test('returns 0 when nothing is stale', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    await saveAttachmentBlob({ blob, filename: 'fresh.png', baseDir });
    expect(gcAttachments(30 * 24 * 60 * 60 * 1000, baseDir)).toBe(0);
  });
});
