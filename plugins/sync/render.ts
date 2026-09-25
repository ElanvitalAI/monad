// ── Sync plugin — legacy cell renderer (kept for backward compat) ──
// W4.3 moved sync mode rendering onto list widgets; the list widget's
// own render path is now the source of truth. This file keeps the old
// renderSyncCell function because a couple of tests still exercise it
// as a pure-function target. Remove when those tests retire.

import { C, ICONS, visibleWidth } from '../../src/tui.js';
import type { SyncPane } from './types.js';

export interface SyncCellInput {
  pane: SyncPane;
  row: number;
  paneWidth: number;
  list: string[];
  cursor: number;
  offset: number;
  selected: Set<string>;
  activePane: SyncPane;
  allSkillCount: number;
  allSelected: boolean;
}

export function renderSyncCell(input: SyncCellInput): string {
  const idx = input.offset + input.row;
  if (idx >= input.list.length) return ' '.repeat(input.paneWidth);

  const name = input.list[idx]!;
  const isCur = idx === input.cursor;
  const isActive = input.pane === input.activePane;
  const isAllItem = input.pane === 0 && name === '* ALL';
  const isSel = isAllItem ? input.allSelected : input.selected.has(name);

  let rawLabel: string;
  if (isAllItem) {
    rawLabel = `* ALL (${input.allSkillCount})`;
  } else if (input.pane === 0) {
    rawLabel = name;
  } else if (input.pane === 1) {
    rawLabel = `${ICONS.server} ${name}`;
  } else {
    rawLabel = `${ICONS.service} ${name}`;
  }

  const markChar = isSel ? '\u25CF' : '\u25CB';
  const plainContent = ` ${markChar} ${rawLabel}`;
  const padded = plainContent + ' '.repeat(Math.max(0, input.paneWidth - visibleWidth(plainContent)));

  if (isCur && isActive) return C.cursor(padded);
  if (isCur && !isActive) return C.cursorAlt(padded);
  if (isSel) return C.success(padded);
  if (isActive) return C.text(padded);
  return C.dim(padded);
}
