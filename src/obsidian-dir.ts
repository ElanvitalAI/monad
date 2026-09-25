// ── Obsidian vault browser state + helpers ──
//
// Mirrors the working-dir browser API but scoped to an Obsidian vault —
// navigation is clamped to the vault
// root (no escape via `..`) and the state carries an `available` flag
// so the dashboard can render a helpful placeholder when the vault
// path is missing.
//
// Pure data layer: we reuse `readDirEntries` + `sortEntries` + the
// `FsEntry` type from working-dir.ts. All state-mutating helpers are
// explicit (refresh / enter / toggle…) so tests can assert each step.

import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { readDirEntries, sortEntries, type FsEntry } from './working-dir/index.js';
import type { FileSortMode } from './workspace-types.js';

export interface ObsidianDirState {
  /** Absolute path of the vault root. Set once at init from
   *  OBSIDIAN_VAULT; stays immutable for the session. */
  root: string;
  /** Current directory under `root`. Always starts at `root` and
   *  navigation guards prevent escape above it. */
  cwd: string;
  entries: FsEntry[];
  cursor: number;
  offset: number;
  /** Multi-select set keyed by absolute path. Files only. */
  selected: Set<string>;
  sortMode: FileSortMode;
  showHidden: boolean;
  /** `false` when `root` doesn't exist on disk — the dashboard
   *  renders a placeholder instead of an empty pane in that case. */
  available: boolean;
}

/** Build a blank vault state. `refreshObsidianDir` must follow to
 *  populate `entries`. */
export function createObsidianDirState(root: string): ObsidianDirState {
  const resolved = resolve(root);
  return {
    root: resolved,
    cwd: resolved,
    entries: [],
    cursor: 0,
    offset: 0,
    selected: new Set(),
    sortMode: 'name',
    showHidden: false,
    available: existsSync(resolved),
  };
}

/** Rebuild entries from disk against the current cwd + sort/hidden
 *  flags. Inserts a `..` sentinel only when below `root` — the vault
 *  is a closed universe. Swallows fs errors (unreadable dirs leave
 *  entries empty). */
export function refreshObsidianDir(state: ObsidianDirState): void {
  if (!state.available) {
    state.entries = [];
    state.cursor = 0;
    return;
  }
  const { folders: rawDirs, files: rawFiles } = readDirEntries(state.cwd, state.showHidden);
  const folders = sortEntries(rawDirs, state.sortMode);
  const files = sortEntries(rawFiles, state.sortMode);
  const entries: FsEntry[] = [];
  if (state.cwd !== state.root) {
    entries.push({
      name: '..',
      absPath: dirname(state.cwd),
      isDir: true,
      size: 0,
      mtime: 0,
      ext: '',
    });
  }
  entries.push(...folders, ...files);
  state.entries = entries;
  state.cursor = Math.min(state.cursor, Math.max(0, state.entries.length - 1));
  const alive = new Set(state.entries.filter(e => !e.isDir).map(e => e.absPath));
  for (const p of [...state.selected]) {
    if (!alive.has(p)) state.selected.delete(p);
  }
}

/** cd within the vault. Refuses to move above `root` — `..` from
 *  the root is treated as a no-op. Caller runs `refreshObsidianDir`
 *  after so tests can assert cwd separately from listing reloads. */
export function enterObsidianDirectory(state: ObsidianDirState, nextCwd: string): void {
  const resolved = resolve(nextCwd);
  if (!resolved.startsWith(state.root)) return; // vault escape — ignore
  state.cwd = resolved;
  state.cursor = 0;
  state.offset = 0;
  state.selected.clear();
}

/** Toggle multi-select for the entry at `cursorIdx`. Folders + `..`
 *  are ignored. Returns the new selection size. */
export function obsidianToggleSelection(
  state: ObsidianDirState,
  cursorIdx: number = state.cursor,
): number {
  const e = state.entries[cursorIdx];
  if (!e || e.isDir) return state.selected.size;
  if (state.selected.has(e.absPath)) state.selected.delete(e.absPath);
  else state.selected.add(e.absPath);
  return state.selected.size;
}

/** Select all visible files (or clear if already all selected). */
export function obsidianToggleSelectAll(state: ObsidianDirState): number {
  const filePaths = state.entries.filter(e => !e.isDir).map(e => e.absPath);
  if (state.selected.size === filePaths.length && filePaths.every(p => state.selected.has(p))) {
    state.selected.clear();
  } else {
    state.selected = new Set(filePaths);
  }
  return state.selected.size;
}

/** Absolute paths of the current attach target: selection if any,
 *  else the single file under the cursor. */
export function obsidianAttachTargets(state: ObsidianDirState): string[] {
  if (state.selected.size > 0) return [...state.selected];
  const e = state.entries[state.cursor];
  return e && !e.isDir ? [e.absPath] : [];
}

export function obsidianFocusedEntry(state: ObsidianDirState): FsEntry | null {
  return state.entries[state.cursor] ?? null;
}
