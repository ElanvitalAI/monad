// PLAN-ipad-notes-obsidian-typora §5 Phase O2 — PR Q (2026-05-17) —
// Recursive vault `.md` enumeration for the iPad CodeMirror editor's
// `[[wikilink]]` autocomplete. Skips hidden dirs (`.obsidian`, `.git`,
// dotfiles), `node_modules`, and non-`.md` files. Sorted by basename
// so the autocomplete popup feels stable across queries.
//
// `elanous/obsidian/templates` covers a single folder; this one walks the
// whole vault because wikilinks can reference any note. The cap (default
// 500, max 2000) bounds payload — vaults larger than that should rely
// on the substring `query` to narrow.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface NoteEntry {
  /** Basename without `.md` extension — what the user sees in autocomplete. */
  name: string;
  /** Vault-relative path (POSIX separators), e.g. `Daily/2026-05-17.md`. */
  relPath: string;
}

export interface NotesResult {
  notes: NoteEntry[];
  /** True when the walk hit `limit` and returned early; caller may show
   *  a "more available, refine query" hint. */
  truncated: boolean;
  error?: string;
}

export interface FindNotesOpts {
  vaultRoot: string;
  /** Case-insensitive substring filter applied to basename OR relPath. */
  query?: string;
  /** Default 500, capped at 2000. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.obsidian', '.trash']);

export async function findNotes(opts: FindNotesOpts): Promise<NotesResult> {
  const cap = Math.min(
    Math.max(typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const query = (opts.query ?? '').toLowerCase();
  const notes: NoteEntry[] = [];
  const state = { truncated: false };

  async function walk(dir: string, relPrefix: string): Promise<void> {
    if (state.truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      // Root vault failures are real configuration errors — let them
      // bubble so the caller can surface "obsidian-vault-unavailable"
      // semantics. Subdirectory failures (permission denied, vanished
      // symlink target, stale .Trashes) get skipped silently so one
      // bad dir doesn't abort the walk.
      if (relPrefix === '') throw e;
      return;
    }
    for (const e of entries) {
      if (state.truncated) return;
      // Hidden + commonly-uninteresting dirs.
      if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(join(dir, e.name), rel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const base = e.name.replace(/\.md$/i, '');
        if (query.length > 0) {
          if (
            !base.toLowerCase().includes(query) &&
            !rel.toLowerCase().includes(query)
          ) {
            continue;
          }
        }
        notes.push({ name: base, relPath: rel });
        if (notes.length >= cap) {
          state.truncated = true;
          return;
        }
      }
    }
  }

  try {
    await walk(opts.vaultRoot, '');
    notes.sort((a, b) => a.name.localeCompare(b.name));
    return { notes, truncated: state.truncated };
  } catch (e) {
    return {
      notes: [],
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
