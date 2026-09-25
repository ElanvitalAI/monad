// ── §5-③ Phase C1: continuation bridge ──
//
// Reconstructs the ContinuationDriver dependencies for an active
// auto-mode goal. EnterAutoMode builds a LoopPromptContext from just a
// goalSlug (discoverObsidianVault → resolveGoalPaths → loadGoalBudget →
// ExperimentLedger → buildLoopPromptSnapshot). AutoModeState only carries
// goalSlug + terminationRule, so a continuation turn must rebuild that
// same context each turn to get the completion-audit prompt and a fresh
// goal-state termination verdict.
//
// Pure except for the injected `runTurn` (createDaemonRunTurn in Phase
// C2) — starts nothing on its own. See docs §5-③.

import {
  discoverObsidianVault,
  type ObsidianVault,
} from '../auto-research/obsidian-bridge.js';
import { resolveGoalPaths } from '../auto-research/goal-paths.js';
import { loadGoalBudget } from '../auto-research/budget-loader.js';
import { ExperimentLedger } from '../auto-research/experiment-ledger.js';
import {
  buildLoopPromptSnapshot,
  renderLoopPromptInjection,
} from '../auto-research/loop-prompt.js';
import { buildAndonPreamble } from '../cft/andon.js';
import { getAutoModeState } from '../auto-research/auto-mode/session.js';
import type { TerminationRule } from '../auto-research/termination-dsl.js';
import type { ContinuationDriverDeps } from './continuation-driver.js';

/** Minimal turn result the bridge needs — the assistant/tool text used
 *  for the no-progress hash. Wiring (C2) maps createDaemonRunTurn's
 *  richer result onto this. */
export interface ContinuationTurnResult {
  text: string;
  /** §5-⑤ — tokens the turn consumed, accrued into the goal budget so
   *  the budget furnace guard can trip. Optional (0 when unknown). */
  usedTokens?: number;
}

export interface ContinuationBridgeOpts {
  /** Active goal (from AutoModeState.goalSlug). */
  goalSlug: string;
  /** Resolved termination rule (from AutoModeState.terminationRule). */
  terminationRule: TerminationRule;
  /** Runs one agent turn with the injected prompt. Wired to
   *  createDaemonRunTurn in Phase C2. */
  runTurn: (prompt: string) => Promise<ContinuationTurnResult>;
  /** Escalate an andon (cft/andon) when the loop stalls. */
  onAndon?: (reason: string) => void;
  onStep?: ContinuationDriverDeps<ContinuationTurnResult>['onStep'];
  onHalt?: ContinuationDriverDeps<ContinuationTurnResult>['onHalt'];
  /** Optional owner-specific active predicate for persistent queued goals. */
  isActive?: () => boolean;
  /** Explicit selected authored-goal document, injected into each queued goal turn. */
  authoredGoalDocument?: string;
  vault?: ObsidianVault;
  maxTurns?: number;
  noProgressAndonThreshold?: number;
}

/** Build the DI dependency bundle the ContinuationDriver runs on. */
export function buildContinuationDriverDeps(
  opts: ContinuationBridgeOpts,
): ContinuationDriverDeps<ContinuationTurnResult> {
  const vault = opts.vault ?? discoverObsidianVault();
  const paths = resolveGoalPaths(vault, opts.goalSlug);

  // §5-⑤ — one persistent budget meter for the goal: turn usage accrues
  // into it (recordUsage) and the driver's budget furnace guard reads it
  // (budgetExhausted). Also feeds the loop-prompt + budget_remaining_min
  // rule so all budget views stay consistent.
  const budget = loadGoalBudget(paths.budgetFile);

  // Rebuild the loop-prompt snapshot each call — it re-reads goal files
  // + re-evaluates the Termination DSL, so it reflects the turn just
  // taken. Cheap (a few file reads); correctness over caching.
  const buildSnapshot = () => {
    const ledger = new ExperimentLedger(paths.goalRoot);
    const andonPreamble = buildAndonPreamble();
    return buildLoopPromptSnapshot({
      vault,
      goalSlug: opts.goalSlug,
      goalRoot: paths.goalRoot,
      budget,
      ledger,
      termination: opts.terminationRule,
      ...(andonPreamble ? { andonPreamble } : {}),
    });
  };

  return {
    // Drive only while THIS goal is the active auto-mode goal.
    isActive: opts.isActive ?? (() => {
      const s = getAutoModeState();
      return s.active && s.goalSlug === opts.goalSlug;
    }),
    buildPrompt: async () => {
      const prompt = renderLoopPromptInjection(await buildSnapshot());
      return opts.authoredGoalDocument ? `## Authored goal document\n${opts.authoredGoalDocument}\n\n${prompt}` : prompt;
    },
    runTurn: opts.runTurn,
    // Goal-state termination (files/budget), re-evaluated post-turn.
    isTerminated: async () => (await buildSnapshot()).termination.shouldTerminate,
    hashToolResults: (r) => hashText(r.text),
    // §5-⑤ — accrue token usage into the goal budget and stop when a cap
    // is tripped (no-op when budget.json has no caps → maxTurns guards).
    recordUsage: (r) => { if (r.usedTokens && r.usedTokens > 0) budget.add({ tokens: r.usedTokens }); },
    budgetExhausted: () => budget.snapshot().tripped.length > 0,
    ...(opts.onAndon ? { onAndon: opts.onAndon } : {}),
    ...(opts.onStep ? { onStep: opts.onStep } : {}),
    ...(opts.onHalt ? { onHalt: opts.onHalt } : {}),
    ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
    ...(opts.noProgressAndonThreshold !== undefined
      ? { noProgressAndonThreshold: opts.noProgressAndonThreshold }
      : {}),
  };
}

/** Small deterministic string hash (djb2-ish) for no-progress
 *  detection — collisions are harmless here (a false "progress" just
 *  delays the andon by a turn). */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
