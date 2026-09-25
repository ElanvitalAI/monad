// Read-before-Edit invariant — Phase CE1.
//
// Adapted from claude-code-fork's readFileState Map
// (src/tools/FileEditTool/FileEditTool.ts:275-286). The store tracks
// which files the LLM has Read this session and records a content
// hash so Edit can detect "file changed on disk since you Read it"
// and bounce the call back to the model for a fresh Read.
//
// Design notes:
//  - Paths are canonicalised to absolute so relative callers
//    ("./foo.ts") hit the same entry as absolute ones.
//  - Partial views (Read with offset/limit) set partialView:true —
//    Edit later rejects these because the LLM can't reliably match
//    old_string against a window it only partly saw.
//  - We hash the content (not the file) so the store is decoupled
//    from the filesystem — the apply path re-reads disk + compares.

import { createHash } from 'crypto';
import { isAbsolute, resolve } from 'path';
import { getSessionCwd } from '../session/working-dir.js';
import type { ReadFileEntry } from './types.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// WD4 — resolve relative paths against the session working directory
// so a Read of "foo.ts" and an Edit of "foo.ts" canonicalise to the
// same absolute entry even after the user flips SWD mid-session.
function canon(path: string): string {
  return isAbsolute(path) ? path : resolve(getSessionCwd(), path);
}

export class ReadFileStateStore {
  private map = new Map<string, ReadFileEntry>();

  /** Record that the caller (typically the Read tool) just saw this
   *  file. `content` is the full text observed, used to compute the
   *  stale-detection hash. Omit `content` for partial views. */
  recordRead(path: string, opts: { partialView?: boolean; content?: string } = {}): void {
    const abs = canon(path);
    this.map.set(abs, {
      path: abs,
      ts: Date.now(),
      partialView: opts.partialView ?? false,
      contentHash: opts.content !== undefined ? hashContent(opts.content) : undefined,
    });
  }

  /** Lookup for the Edit path — returns null when the file hasn't
   *  been Read. Does NOT throw; the caller decides how to surface the
   *  missing-read error (typically an EditError with code 5). */
  verifyBeforeEdit(path: string): ReadFileEntry | null {
    return this.map.get(canon(path)) ?? null;
  }

  /** Drop the entry — call when the file is deleted or renamed so
   *  subsequent Edits force a fresh Read. */
  invalidate(path: string): void {
    this.map.delete(canon(path));
  }

  /** Drop every entry. For tests + /code-edit reset. */
  clear(): void {
    this.map.clear();
  }

  /** Snapshot for debug/log views. */
  size(): number {
    return this.map.size;
  }

  entries(): ReadFileEntry[] {
    return [...this.map.values()];
  }
}
