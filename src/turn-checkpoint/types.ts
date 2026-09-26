// PLAN §4.1 · Phase 1.1 — Turn checkpoint primitive types.
//
// A checkpoint is a serialised "where were we" snapshot, written at
// decision boundaries inside `streamLLMWithTools` (Edit / Bash /
// agent-spawn) and on `/pause` requests. The shape is intentionally
// flat + JSON-safe — checkpoints persist to `~/.elanous/checkpoints/<turn>.jsonl`
// and must round-trip through `JSON.parse`.
//
// Design constraint: this module deliberately does NOT import the
// private interfaces from src/llm.ts (ExecutionLoopState,
// VerificationLoopState, FinalizationPolicySnapshot, LoopSignalSnapshot).
// Those types carry runtime class instances (DoomLoopTracker) that
// aren't serialisable, so the snapshot below captures the primitive
// subset relevant for resume + diagnosis.

import type { TurnUri } from '../mss/uri/brand.js';

/** Decision boundary classification. `pause` is the synthetic kind
 *  written when `/pause` requested a stop *before* the next dispatch;
 *  the other four mirror the tool families that warrant a checkpoint. */
export type TurnCheckpointKind =
  | 'edit'
  | 'shell'
  | 'commit'
  | 'agent-spawn'
  | 'pause';

export interface TurnCheckpointDecision {
  kind: TurnCheckpointKind;
  /** Short human-readable preview — tool name + first arg, capped to
   *  80 chars so the JSONL row stays narrow. */
  preview: string;
}

export interface TurnCheckpointLoopSnapshot {
  execution?: {
    lastCommand: string | null;
    lastSummary: string | null;
    primarySourceFile: string | null;
    interestingLine: string | null;
  };
  verification?: {
    lastCommand: string | null;
    lastSummary: string | null;
    historyLen: number;
    needsRefresh: boolean;
    /** Non-verification shell command after the last verification; freshness is unknown. */
    unknownSinceShellCommand?: string | null;
  };
  finalization?: {
    verificationStillCurrent: boolean;
    forceFinalAnswer: boolean;
  };
  signal?: {
    primarySourceFile: string | null;
    primaryTestFile: string | null;
    interestingLine: string | null;
  };
}

export interface TurnCheckpointRecentMessage {
  role: 'system' | 'user' | 'assistant';
  /** Trimmed to 240 chars; multi-block content is flattened to text only. */
  text: string;
}

export interface TurnCheckpoint {
  turnUri: TurnUri;
  /** Monotonic index within the turn — increments at every captured
   *  decision boundary (0, 1, 2…). */
  toolIndex: number;
  /** ISO 8601 timestamp at capture time. */
  timestamp: string;
  decision: TurnCheckpointDecision;
  /** `history.length` at capture time — lets the resume seed know how
   *  much of the turn already happened. */
  messageCount: number;
  loop: TurnCheckpointLoopSnapshot;
  /** Last assistant text in the history (≤240 chars). Optional — early
   *  checkpoints in a turn may have no assistant text yet. */
  recentText?: string;
  /** Up to 2 most recent messages (role + flattened text). Used by the
   *  resume seed to remind the model what it just did. */
  recentMessages?: TurnCheckpointRecentMessage[];
}
