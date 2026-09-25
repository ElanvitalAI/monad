// ── Skills pane — left-side skill list ──
// Pure row builder: given the skill rows + cursor/offset + focus/width,
// produce `listH` already-styled lines. The dashboard composes these
// into the 3-pane grid alongside files-pane and preview rows.
//
// NOTE (MD7, 2026-04-18): This module is currently retained only for
// the test contract in `test/panes.test.ts`. Actual dashboard skills
// rendering is performed by the `list` plugin widget
// (`widgets/list/widget.ts`) driven by `workingDir.*` state with
// `renderAgentRoster` as a sibling. The `list` widget carries MD6
// double-click support; do not wire new pane features through this
// row-builder path.

import { C, ICONS, pad, timeSince } from '../tui.js';

export interface SkillRow {
  name: string;
  fileCount: number;
  syncedTargets: number;
  lastSynced?: Date;
  hasSnapshot: boolean;
}

export interface SkillsPaneState {
  rows: SkillRow[];
  cursor: number;
  offset: number;
  focused: boolean;
}

/** Produce `listH` styled lines — one per visible row, '' for empty slots. */
export function renderSkillsRows(state: SkillsPaneState, width: number, listH: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < listH; i++) {
    const sIdx = state.offset + i;
    if (sIdx >= state.rows.length) { out.push(''); continue; }
    const row = state.rows[sIdx]!;
    const isCur = sIdx === state.cursor;
    const ptr = isCur ? (state.focused ? C.accent('▸') : C.muted('▸')) : ' ';
    const icon = row.hasSnapshot ? C.success(ICONS.unchanged) : C.muted(ICONS.changed);
    const nameColor = isCur && state.focused ? C.info
      : row.hasSnapshot ? C.text : C.dim;
    const age = row.lastSynced ? C.muted(timeSince(row.lastSynced).replace(' ago', '')) : '';
    out.push(`${ptr}${icon} ${pad(nameColor(row.name), width - 10)}${age}`);
  }
  return out;
}
