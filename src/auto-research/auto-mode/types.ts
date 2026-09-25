// ── PFC-S4 P5: auto-mode types ──
//
// Auto-mode is the research-loop cousin of plan-mode. It mirrors the
// singleton + subscribe pattern but drops the write-gate (the research
// loop must be free to edit Obsidian + experiment snapshots). Budget
// tripped is the hard entry gate instead (DD-S4-4).

import type { TerminationRule } from '../termination-dsl.js';
import type { GoalKind } from '../../conductor/types.js';

export type AutoModePhase =
  | 'idle'
  | 'kickoff'
  | 'adjudicate'
  | 'handoff';

export type AutoModeExitReason =
  | 'manual'
  | 'termination_met'
  | 'budget_tripped'
  | 'max_turns'
  | 'error';

export interface AutoModeState {
  active: boolean;
  sessionId?: string;
  goalSlug?: string;
  /** PFC-S2 generalization — what KIND of goal this loop is pursuing.
   *  Defaults to 'research' for backward compatibility with pre-S2
   *  sessions that only had the auto-research adapter. */
  goalKind?: GoalKind;
  startedAt?: number;
  maxTurns: number;
  turnIndex: number;
  phase: AutoModePhase;
  terminationRule?: TerminationRule;
  /** Cached rendered loop-prompt injection from last enter — convenient
   *  so UI consumers can peek without rebuilding the snapshot. */
  lastKickoffRendered?: string;
  exitReason?: AutoModeExitReason;
  exitDiagnostic?: string;
}

export const INACTIVE_AUTO_MODE_STATE: AutoModeState = {
  active: false,
  maxTurns: 20,
  turnIndex: 0,
  phase: 'idle',
};

export const AUTO_MODE_DEFAULT_MAX_TURNS = 20;
export const AUTO_MODE_HARD_MAX_TURNS = 100;
