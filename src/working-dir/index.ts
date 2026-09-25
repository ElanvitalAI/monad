// ── Working-directory shell state + browser compatibility helpers ──
//
// The browser-specific data model lives in `src/browser-pane/model.ts`.
// This module keeps the dashboard shell state (`view` / `focus` /
// preview bookkeeping) and re-exports the historical helper names so
// the rest of the app can migrate incrementally.

import type { PaneFocus, WorkingDirView } from '../workspace-types.js';
import {
  basename,
  dirname,
  type BrowserPaneModel,
  type FsEntry,
  browserAttachTargets,
  createBrowserPaneModel,
  enterBrowserDirectory,
  focusedBrowserEntry,
  readDirEntries,
  refreshBrowserPane,
  resolvePath,
  sortEntries,
  splitAtPrefix,
  toggleBrowserSelectAll,
  toggleBrowserSelection,
} from '../browser-pane/model.js';

export { basename, dirname, readDirEntries, resolvePath, sortEntries, splitAtPrefix };
export type { BrowserPaneModel, FsEntry };

export interface WorkingDirState extends BrowserPaneModel {
  view: WorkingDirView;
  focus: PaneFocus;
}

/** Build a blank state rooted at `cwd`. Caller must follow with a
 *  `refreshWorkingDir` to populate the entries list — doing the fs
 *  read in the constructor would make `initialState` async, which the
 *  tests and plugin contract both prefer to avoid. */
export function createWorkingDirState(cwd: string = process.cwd()): WorkingDirState {
  return {
    ...createBrowserPaneModel(cwd),
    // Default to View 1 (Normal — browser + preview + scratch / log).
    // Session 9 reassigned V1 to the dense general-purpose layout;
    // Obsidian / Skill / Chat live at V2 / V3 / V4 respectively.
    view: 1,
    focus: 'input',
    entries: [],
    cursor: 0,
    offset: 0,
    selected: new Set(),
  };
}
export function refreshWorkingDir(state: WorkingDirState): void {
  refreshBrowserPane(state);
}

/** Step into a subdirectory (or up via `..`). Caller runs
 *  `refreshWorkingDir` after — we keep state mutation surgical so
 *  tests can assert `cwd` separately from listing reloads. */
export function enterDirectory(state: WorkingDirState, nextCwd: string): void {
  enterBrowserDirectory(state, nextCwd);
}

/** Toggle multi-select for the entry at `cursorIdx`. No-op for
 *  folders and the `..` sentinel — selection only carries files into
 *  the attach pipeline. Returns the new selection size. */
export function toggleSelection(state: WorkingDirState, cursorIdx: number = state.cursor): number {
  return toggleBrowserSelection(state, cursorIdx);
}

/** Select all visible files (or clear if already all selected).
 *  Folders are skipped — they aren't attachable. */
export function toggleSelectAll(state: WorkingDirState): number {
  return toggleBrowserSelectAll(state);
}

/** Return absolute paths of the current attach target: the multi-
 *  selection if non-empty, otherwise the single file under the
 *  cursor. Folders + `..` resolve to no targets — the caller checks
 *  `focusedEntry()` to decide whether Enter should cd or attach. */
export function attachTargets(state: WorkingDirState): string[] {
  return browserAttachTargets(state);
}

/** Entry under the cursor — used by the preview auto-refresh and by
 *  the Enter handler to dispatch cd vs attach. */
export function focusedEntry(state: WorkingDirState): FsEntry | null {
  return focusedBrowserEntry(state);
}
