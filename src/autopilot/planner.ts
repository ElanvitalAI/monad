// src/autopilot/planner.ts
//
// ROADMAP-ipad-companion-autopilot-priority §D1.4b — heuristic planner.
//
// The simplest planner: no LLM round-trip. If the user wrote the mission
// as a numbered or bulleted list, split it into `AutopilotPlanStep[]`
// and hand the result to `AutopilotLoopDriver` via `config.plan`.
//
// Accepted shapes (line-anchored, line-by-line):
//   "1. step text"
//   "1) step text"
//   "- step text"
//   "* step text"
//   "  • step text"           (Unicode bullet · leading whitespace OK)
//
// Continuation lines (no marker prefix) attach to the previous step's
// `text`, joined by " " — so multi-line steps remain a single step.
//
// Inline text BEFORE the first marker is treated as a "preamble" and
// ignored — useful when the user prepends context ("Reorg the workspace.
// Steps:\n1. …"). When no markers match, the planner returns `null` and
// the driver falls back to single-shot mission mode.
//
// LLM-based mission decomposition (auto-derive steps when none exist)
// is out of scope — that lives in `planner-llm.ts` (future), gated
// behind a model budget guard.

import type { AutopilotPlan, AutopilotPlanStep } from './agent-loop.js';

interface ParseOptions {
  /** Plan ref propagated into `AutopilotPlan.ref`. Default `"heuristic"`. */
  ref?: string;
  /** Cap on the number of steps returned. Default 16 (D1 budget guard). */
  maxSteps?: number;
}

// Markers we accept: `1.`, `1)`, `-`, `*`, `•` (Unicode bullet).
// Captured group 1 is the step body.
const MARKER_RE = /^\s*(?:(?:\d+)[.)]|[-*•])\s+(.+)$/;

/**
 * Parse a mission string into an `AutopilotPlan`. Returns `null` when
 * no list markers are found — caller should fall back to single-shot
 * mission mode.
 */
export function parseHeuristicPlan(
  mission: string,
  opts: ParseOptions = {},
): AutopilotPlan | null {
  if (!mission) return null;
  const ref = opts.ref ?? 'heuristic';
  const maxSteps = opts.maxSteps ?? 16;
  const steps: AutopilotPlanStep[] = [];
  for (const rawLine of mission.split('\n')) {
    const line = rawLine.trimEnd();
    const match = line.match(MARKER_RE);
    if (match) {
      if (steps.length >= maxSteps) break;
      steps.push({
        id: `step${steps.length + 1}`,
        text: match[1].trim(),
      });
    } else if (steps.length > 0 && line.trim().length > 0) {
      // Continuation — attach to the last step (preserves multi-line bullets).
      const last = steps[steps.length - 1];
      last.text = `${last.text} ${line.trim()}`;
    }
    // else: preamble (no marker yet) or blank line — ignored.
  }
  if (steps.length === 0) return null;
  return { ref, steps };
}

/**
 * Convenience — parse a mission and return a config slice ready to
 * spread into `AutopilotConfig`. Caller decides whether to use the
 * heuristic plan or fall through.
 *
 *   const driver = new AutopilotLoopDriver({
 *     agent, sessionId,
 *     mission,
 *     maxIterations: 16,
 *     ...heuristicPlanConfig(mission),
 *   });
 */
export function heuristicPlanConfig(
  mission: string,
  opts: ParseOptions = {},
): { plan?: AutopilotPlan } {
  const plan = parseHeuristicPlan(mission, opts);
  return plan ? { plan } : {};
}
