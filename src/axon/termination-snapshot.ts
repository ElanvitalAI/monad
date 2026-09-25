// AXON F2 — auto-mode wire-up helper for the P5 termination detector.
//
// P5 shipped `evaluateTermination` as a pure detector and loop-prompt
// declared an `axonTermination?: AxonTerminationSnapshot` optional
// section, but no production caller ever threaded the two together.
// This module bridges them:
//
//   caller state  →  TerminationInput  →  evaluateTermination
//                                             │
//                                             ▼
//                                      AxonTerminationSnapshot
//                                   (loop-prompt consumes this)
//
// Keeping the plumber small + pure (no I/O, no imports from
// auto-research) mirrors the policy the detector itself follows —
// every input comes in as data, every output comes out as data.
// The caller in `auto-mode/tool-enter.ts` owns the I/O (question
// queue read, budget snapshot, TerminationCheck dispatch).

import {
  evaluateTermination,
  formatTerminationForPrompt,
  type TerminationInput,
} from './termination-detector.js';
import { announcementStore } from './announcement-store.js';
import type { AxonTerminationSnapshot } from '../auto-research/loop-prompt.js';

/** Minimal turn-level inputs the auto-mode entry can realistically
 *  observe. Fields align with `TerminationInput` but are renamed for
 *  the caller's perspective — e.g. `goalTerminationMet` comes from
 *  the TerminationCheck tool, not the detector internals.
 *
 *  Fields marked optional default to the "safe" interpretation
 *  (factor unsatisfied ⇒ don't push toward terminate). Callers
 *  without the signal should omit rather than pass `false`. */
export interface BuildAxonTerminationSnapshotInput {
  /** Goal slug currently driving the loop. Used to gate factor 7 —
   *  we only count the latest `AnnounceCompletion` call if it was
   *  for THIS goal. Prevents a stale announcement from a previous
   *  session bleeding into the current verdict. */
  goalSlug: string;
  /** PFC-S4 goal-termination-rule verdict (factor 5). */
  goalTerminationMet?: boolean;
  /** Budget snapshot derived signal — `snap.tripped.length > 0`
   *  (factor 6). */
  budgetExhausted?: boolean;
  /** True when every question in `<goal>/question-queue.md` is
   *  marked resolved (or there were none to start). (factor 4) */
  clarifyingQuestionsAnswered?: boolean;
  /** Per-turn signals — typically absent at EnterAutoMode entry
   *  (no prior turn to observe) but supplied by subsequent loop
   *  ticks so the detector can fire factors 1–3. */
  stopReason?: string;
  pendingToolCalls?: number;
  recentToolResultHashes?: readonly string[];
  /** Test seam — defaults to the module `announcementStore`. */
  announcementStore?: {
    getLast(): { goalSlug?: string } | null;
  };
}

/** Compose the loop-prompt `axonTermination` payload. The LLM reads
 *  this every turn kick-off as a `## Axon Termination (turn-level)`
 *  section, so the rendered prompt must be self-contained + safe to
 *  embed in a system prompt. */
export function buildAxonTerminationSnapshot(
  input: BuildAxonTerminationSnapshotInput,
): AxonTerminationSnapshot {
  const store = input.announcementStore ?? announcementStore;
  const last = store.getLast();
  // Factor 7 only fires when the announcement is scoped to this goal
  // (or unscoped — legacy records don't carry goalSlug). Mis-matched
  // announcements are ignored so the detector stays conservative.
  const announceForThisGoal = last !== null
    && (last.goalSlug === undefined || last.goalSlug === input.goalSlug);

  const detectorInput: TerminationInput = {
    ...(input.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
    ...(input.pendingToolCalls !== undefined ? { pendingToolCalls: input.pendingToolCalls } : {}),
    ...(input.recentToolResultHashes !== undefined ? { recentToolResultHashes: input.recentToolResultHashes } : {}),
    ...(input.clarifyingQuestionsAnswered !== undefined ? { clarifyingQuestionsAnswered: input.clarifyingQuestionsAnswered } : {}),
    ...(input.goalTerminationMet !== undefined ? { goalTerminationMet: input.goalTerminationMet } : {}),
    ...(input.budgetExhausted !== undefined ? { budget: { exhausted: input.budgetExhausted } } : {}),
    announceCompletion: announceForThisGoal,
  };

  const decision = evaluateTermination(detectorInput);
  return {
    shouldTerminate: decision.shouldTerminate,
    confidence: decision.confidence,
    satisfiedCount: decision.satisfiedCount,
    reason: decision.reason,
    prompt: formatTerminationForPrompt(decision),
  };
}
