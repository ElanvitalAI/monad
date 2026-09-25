// ── Files pane — middle-pane 'files' mode row builder ──
// The middle pane has four modes (files/inspect/history/status); the
// latter three render from pre-built string[] arrays already and stay
// in dashboard.ts. This module handles the 'files' mode row layout.
//
// NOTE (MD7, 2026-04-18): This module is retained only for
// `test/panes.test.ts`. Actual dashboard file rendering is performed
// by the `list` plugin widget (`widgets/list/widget.ts`) populated
// with colored entries from `workingDir.entries`. MD6 added double-
// click submit to that widget; extend there, not here.

import { C, pad } from '../tui.js';
import { fileColor, fileIcon, sizeStr } from './file-icons.js';
import type { FileTreeEntry } from '../types.js';

export interface FilesPaneState {
  files: FileTreeEntry[];
  cursor: number;
  offset: number;
  focused: boolean;
}

export function renderFilesRows(state: FilesPaneState, width: number, listH: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < listH; i++) {
    const fIdx = state.offset + i;
    if (fIdx >= state.files.length) { out.push(''); continue; }
    const f = state.files[fIdx]!;
    const isCur = fIdx === state.cursor;
    const ptr = isCur ? (state.focused ? C.accent('▸') : C.muted('▸')) : ' ';
    const name = f.path.split('/').pop() || f.path;
    const fIcon = fileIcon(name);
    const fClr = fileColor(name);
    const nameStr = isCur && state.focused ? C.bold(name) : fClr(name);
    const size = C.muted(sizeStr(f.size));
    out.push(`${ptr}${C.muted(fIcon)} ${pad(nameStr, width - 12)}${size}`);
  }
  return out;
}
