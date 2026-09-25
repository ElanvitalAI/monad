// HUD bridge for /goal + plan-mode — FU-3 (Status pill).
//
// Subscribes to the goal registry + plan-mode session and reflects
// their state in the dashboard HUD as two segments:
//   - 'goal'      → 🎯 active · 3/20 · last:continue
//   - 'plan-mode' → 📋 plan · explore
//
// Lives in src/dashboard/* because it depends on the HUD API. The
// goal/plan modules are surface-agnostic and don't reach back here.

import { C } from '../tui.js';
import { clearSegment, setSegment, type HudState } from '../panes/hud.js';
import {
  getCurrentGoal,
  subscribeGoal,
  type Goal,
} from '../goals/index.js';
import {
  getPlanModeState,
  subscribePlanMode,
  type PlanModeState,
} from '../plan-mode/index.js';

const SEG_GOAL = 'goal';
const SEG_PLAN = 'plan-mode';

// Priority — left-of-center area, after 'mode' (10) and 'reasoning' (4).
const PRIO_PLAN = 12;
const PRIO_GOAL = 14;

function paintGoal(hud: HudState, goal: Goal | null): void {
  if (!goal) {
    clearSegment(hud, SEG_GOAL);
    return;
  }
  // Active = green-ish; paused/budget = warning; complete = success
  const icon = '🎯';
  let body: string;
  if (goal.status === 'active') {
    body = C.info(`${icon} goal · ${goal.usage.turnsUsed}/${goal.budget.maxTurns}`);
  } else if (goal.status === 'paused') {
    body = C.warning(`${icon} paused · ${goal.usage.turnsUsed}/${goal.budget.maxTurns}`);
  } else if (goal.status === 'budget-limited') {
    body = C.warning(`${icon} budget · ${goal.usage.turnsUsed}/${goal.budget.maxTurns}`);
  } else if (goal.status === 'complete') {
    // FU-4 (2026-05-05) — brief success flash. The pill stays as a
    // muted "complete" baseline; a transient ✅ overlay segment paints
    // for ~4s to give a "toast moment" without a separate widget.
    body = C.muted(`${icon} complete`);
    flashSuccessToast(hud);
  } else {
    body = C.muted(`${icon} ${goal.status}`);
  }
  // Append last verdict tag when present (compact form).
  if (goal.lastVerdict && goal.status === 'active') {
    body += C.muted(` · ${goal.lastVerdict}`);
  }
  setSegment(hud, SEG_GOAL, body, PRIO_GOAL);
}

const SEG_TOAST = 'goal-toast';
const TOAST_DURATION_MS = 4_000;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function flashSuccessToast(hud: HudState): void {
  if (toastTimer) clearTimeout(toastTimer);
  setSegment(hud, SEG_TOAST, C.success('✅ goal complete'), PRIO_GOAL - 1);
  toastTimer = setTimeout(() => {
    clearSegment(hud, SEG_TOAST);
    toastTimer = null;
  }, TOAST_DURATION_MS);
}

function paintPlan(hud: HudState, state: PlanModeState): void {
  if (!state.active) {
    clearSegment(hud, SEG_PLAN);
    return;
  }
  setSegment(hud, SEG_PLAN, C.info(`📋 plan · ${state.phase}`), PRIO_PLAN);
}

/** Wire the bridge to a HUD instance + a redraw hook. Returns a
 *  dispose callback that unsubscribes both feeds. Idempotent — calls
 *  paintGoal/paintPlan once on attach for the current state. */
export function wireGoalPlanHudBridge(deps: {
  hud: HudState;
  draw: () => void;
}): () => void {
  // Initial paint
  paintGoal(deps.hud, getCurrentGoal());
  paintPlan(deps.hud, getPlanModeState());
  deps.draw();

  const unsubGoal = subscribeGoal((next) => {
    paintGoal(deps.hud, next);
    deps.draw();
  });
  const unsubPlan = subscribePlanMode((next) => {
    paintPlan(deps.hud, next);
    deps.draw();
  });

  return () => {
    unsubGoal();
    unsubPlan();
    clearSegment(deps.hud, SEG_GOAL);
    clearSegment(deps.hud, SEG_PLAN);
  };
}

// Re-exports for tests + diagnostics
export { paintGoal as _paintGoalForTesting, paintPlan as _paintPlanForTesting };
