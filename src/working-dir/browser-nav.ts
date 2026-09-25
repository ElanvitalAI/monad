// ── Browser pane keyboard navigation primitives ──────────────────
//
// Pure helpers shared by the dashboard's default browser pane handler
// and the tablet `Ctrl+M B` Browser+Preview modal. Each helper
// mutates the supplied browser model in place and reports whether
// anything changed so callers can decide whether to re-render the
// widget / refresh the preview / push a chat-line breadcrumb.
//
// Lifted out so the modal can apply the same Left/Right/Enter/`<`
// semantics against its own browser instance instead of falling
// through to the default pane handler.

import { dirname } from 'path';
import {
  enterBrowserDirectory,
  focusedBrowserEntry,
  refreshBrowserPane,
  type BrowserPaneModel,
  type FsEntry,
} from '../browser-pane/model.js';

/** Navigate the browser to its parent directory (`Left` / `<`).
 *  Returns true when cwd changed, false when already at the
 *  filesystem root. Refreshes entries on success — callers are
 *  expected to follow up with widget + preview sync. */
export function browserNavParent(state: BrowserPaneModel): boolean {
  const parent = dirname(state.cwd);
  if (parent === state.cwd) return false;
  enterBrowserDirectory(state, parent);
  refreshBrowserPane(state);
  return true;
}

/** Navigate into the directory under the cursor (`Right`). No-op
 *  on `..`, on a file row, or when `entries` is empty. Returns
 *  true when cwd changed. */
export function browserNavInto(state: BrowserPaneModel): boolean {
  const e = focusedBrowserEntry(state);
  if (!e || !e.isDir || e.name === '..') return false;
  enterBrowserDirectory(state, e.absPath);
  refreshBrowserPane(state);
  return true;
}

export type BrowserEnterOutcome =
  | { kind: 'cd'; entry: FsEntry }
  | { kind: 'file'; entry: FsEntry }
  | { kind: 'noop' };

/** Resolve what `Enter` on the cursor row should do. The caller
 *  applies the side effect (cd vs attach) — keeps this helper free
 *  of UI / chat-line dependencies. */
export function browserNavEnter(state: BrowserPaneModel): BrowserEnterOutcome {
  const e = focusedBrowserEntry(state);
  if (!e) return { kind: 'noop' };
  if (e.isDir) {
    enterBrowserDirectory(state, e.absPath);
    refreshBrowserPane(state);
    return { kind: 'cd', entry: e };
  }
  return { kind: 'file', entry: e };
}
