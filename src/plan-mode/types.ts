// Plan-mode types — Phase WF3.
//
// Plan mode flips Elanous into a read-only planning posture: the LLM
// can Read / Grep / AskUserQuestion but cannot touch any file except
// the session's plan artifact. Adapted from Claude Code's plan-mode
// model (Apache 2.0-ish — algorithmic reference only).

import type { ApprovalPolicy } from '../code-edit/types.js';

export type PlanPhase = 'inactive' | 'explore' | 'design' | 'review' | 'finalize';

export interface PlanModeState {
  active: boolean;
  /** Short ULID-ish — stamped at EnterPlanMode time. Used for the
   *  plan artifact filename + as a stable key in downstream UIs. */
  sessionId: string;
  startedAt: number;
  phase: PlanPhase;
  /** Absolute path — the ONLY writable file while plan mode is
   *  active. Edit/Write on any other path returns PlanModeWriteBlocked. */
  planFilePath: string;
  /** Code-edit approval policy snapshot captured at EnterPlanMode;
   *  restored on ExitPlanMode so mode state doesn't leak. */
  previousPolicy: ApprovalPolicy;
  /** Title the user originally asked about — remembered for artifact
   *  frontmatter + prompt hints. */
  title?: string;
}

export interface PlanArtifact {
  sessionId: string;
  title: string;
  created: number;
  updated: number;
  phase: PlanPhase;
  /** Markdown body. Freeform — the model writes it via Edit against
   *  planFilePath; Elanous reads it on ExitPlanMode for the preview
   *  and the handoff path. */
  body: string;
}

export interface PlanModeError {
  code: 'PlanModeWriteBlocked' | 'PlanModeAlreadyActive' | 'PlanModeNotActive';
  message: string;
  /** For PlanModeWriteBlocked: the path that was denied. */
  path?: string;
}

/** INACTIVE state used when no plan mode session is running.
 *  Keeping it as a constant keeps `getPlanModeState()` total (never
 *  returns null) at the cost of always having to check `.active`. */
export const INACTIVE_PLAN_MODE_STATE: PlanModeState = {
  active: false,
  sessionId: '',
  startedAt: 0,
  phase: 'inactive',
  planFilePath: '',
  previousPolicy: { mode: 'ask-edit' },
};
