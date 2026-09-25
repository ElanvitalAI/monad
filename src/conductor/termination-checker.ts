// ── §5-④ writer/checker separation ──
//
// Completion must be proven by an INDEPENDENT checker, not the writer.
// The continuation agent (writer) produces the artifacts; an
// independent checker verifies them. Self-grading is the failure mode a
// hard gate is meant to prevent — a model asked to score its own work
// grades leniently (codex ships auto-review as a separate one-shot
// sub-thread for exactly this reason).
//
// This composes a goal's objective termination with a `custom` checker
// rule (a separate shell command evaluated in the goalRoot): the goal is
// complete only when the base conditions hold AND the checker approves.
// Wire an LLM judge or a scoring script as the checker command so the
// writer can't self-declare done. Additive — does not modify
// termination-dsl.ts. See docs/RESEARCH-loop-engineering-vs-pfc-dual-loop
// §5-④.

import type { TerminationRule } from '../auto-research/termination-dsl.js';
import type { GoalKind } from './types.js';
import { terminationPresetFor } from './termination-presets.js';

export interface CheckerOptions {
  /** Shell command that INDEPENDENTLY verifies completion — runs in the
   *  goalRoot, exit 0 = approved. Distinct from the writer agent that
   *  produced the artifacts. Wire an LLM judge (e.g. `monad review
   *  --gate`) or a scoring script here. */
  command: string;
  /** Checker timeout (default 120s — an LLM judge needs headroom). */
  timeoutMs?: number;
}

const DEFAULT_CHECKER_TIMEOUT_MS = 120_000;

/**
 * Compose a base termination rule with an independent checker (§5-④).
 * The result is satisfied only when the base objective conditions hold
 * AND the checker command approves — so the writer cannot self-declare
 * completion. When the base is already an `and`, the checker is appended
 * to keep the rule tree shallow.
 */
export function withIndependentChecker(
  base: TerminationRule,
  checker: CheckerOptions,
): TerminationRule {
  const checkerRule: TerminationRule = {
    kind: 'custom',
    command: checker.command,
    timeoutMs: checker.timeoutMs ?? DEFAULT_CHECKER_TIMEOUT_MS,
  };
  if (base.kind === 'and') {
    return { kind: 'and', rules: [...base.rules, checkerRule] };
  }
  return { kind: 'and', rules: [base, checkerRule] };
}

/**
 * A goalKind preset (§5-①) wrapped with an independent checker (§5-④) —
 * the writer's objective conditions PLUS an independent checker gate.
 */
export function terminationPresetWithChecker(
  kind: GoalKind,
  checker: CheckerOptions,
): TerminationRule {
  return withIndependentChecker(terminationPresetFor(kind), checker);
}
