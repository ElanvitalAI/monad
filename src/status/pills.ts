// MX5 — Status-bar pill geometry.
//
// status-bar.ts is a pure-render module: it takes state and returns
// a single ANSI string. For mouse routing we need to know WHERE each
// anchor pill (sessionCwd + model) lands on the terminal row so the
// dashboard can dispatch clicks correctly.
//
// Rather than refactor status-bar into a full View, this module
// re-renders the primary line piece by piece and tracks column
// offsets as it goes. The output is `{ text, pills }` — the exact
// same rendered string as `renderPrimaryStatus`, plus the pill bounds
// for the 2 anchor segments. The separator matches
// `renderPrimaryStatus`, so pill offsets stay in sync.
//
// Coordinates are 0-indexed column positions within the status row
// (compatible with ClickRegistry.absX). startCol is inclusive,
// endCol is exclusive.

import { stripAnsi, visibleWidth } from '../tui.js';
import {
  contextUsageSegment,
  hostSegment,
  sessionCwdSegment,
  gitSegment,
  modelSegment,
  elapsedSegment,
  sshSegment,
  STATUS_SEGMENT_SEPARATOR,
  type StatusBarRenderOptions,
  type StatusBarState,
  tmuxSegment,
} from './bar.js';

export type PillName = 'workingDir' | 'model' | 'virtualWindow' | 'shellRollup' | 'mode' | 'workspaceDock' | 'conversationPopup' | 'acpSending';

export interface PillBound {
  name: PillName;
  /** 0-indexed column (inclusive) where the pill starts. */
  startCol: number;
  /** 0-indexed column (exclusive) where the pill ends. */
  endCol: number;
}

export interface PrimaryStatusWithPills {
  text: string;
  pills: PillBound[];
}

/** Same output as `renderPrimaryStatus` plus the pill column ranges. */
export function computePrimaryStatusPills(
  state: StatusBarState,
  opts: StatusBarRenderOptions = {},
): PrimaryStatusWithPills {
  const segments = [
    { name: 'workingDir' as PillName, render: sessionCwdSegment(state.cwd, opts) },
    { name: null as PillName | null, render: gitSegment(state.cwd, state.gitBranch, opts) },
    { name: 'model' as PillName, render: modelSegment(state.providerInfo, opts) },
  ];
  if (typeof state.contextUsedTokens === 'number') {
    segments.push({ name: null, render: contextUsageSegment(state.contextUsedTokens, opts) });
  }
  if (state.tmuxLabel) {
    segments.push({ name: null, render: tmuxSegment(state.tmuxLabel, opts) });
  }
  else if (state.sshLabel) {
    segments.push({ name: null, render: sshSegment(state.sshLabel, opts) });
  }
  if (state.host) {
    segments.push({ name: null, render: hostSegment(state.host, opts) });
  }
  if (typeof state.elapsedSec === 'number') {
    segments.push({ name: null, render: elapsedSegment(state.elapsedSec, opts) });
  }

  const pills: PillBound[] = [];
  let col = 0;
  const parts: string[] = [];
  const sepW = visibleWidth(stripAnsi(STATUS_SEGMENT_SEPARATOR));
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) col += sepW;
    const width = visibleWidth(stripAnsi(seg.render));
    if (seg.name) {
      pills.push({ name: seg.name, startCol: col, endCol: col + width });
    }
    col += width;
    parts.push(seg.render);
  }
  return { text: parts.join(STATUS_SEGMENT_SEPARATOR), pills };
}

/** Which pill (if any) does a click at `col` land on? `col` is
 *  0-indexed within the status-bar row. */
export function pillAtColumn(pills: readonly PillBound[], col: number): PillBound | null {
  for (const p of pills) {
    if (col >= p.startCol && col < p.endCol) return p;
  }
  return null;
}
