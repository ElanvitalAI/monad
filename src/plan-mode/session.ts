// Plan-mode singleton session — Phase WF3.
//
// Exposes the current plan-mode state + a tiny pub/sub so UI
// consumers (dashboard, log pane) can react to enter/exit without
// tight coupling to the tool layer.

import type { PlanModeState, PlanPhase } from './types.js';
import { INACTIVE_PLAN_MODE_STATE } from './types.js';

let state: PlanModeState = { ...INACTIVE_PLAN_MODE_STATE };

type Listener = (state: PlanModeState) => void;
const listeners = new Set<Listener>();

export function getPlanModeState(): PlanModeState {
  return {
    ...state,
    previousPolicy: {
      mode: state.previousPolicy.mode,
      trustedDirs: state.previousPolicy.trustedDirs ? [...state.previousPolicy.trustedDirs] : undefined,
      deniedDirs: state.previousPolicy.deniedDirs ? [...state.previousPolicy.deniedDirs] : undefined,
    },
  };
}

export function isPlanModeActive(): boolean {
  return state.active;
}

export function setPlanModeState(next: PlanModeState): void {
  state = next;
  for (const fn of listeners) {
    try { fn(getPlanModeState()); } catch { /* never break caller */ }
  }
}

export function setPlanPhase(phase: PlanPhase): void {
  if (!state.active) return;
  setPlanModeState({ ...state, phase });
}

export function resetPlanModeState(): void {
  setPlanModeState({ ...INACTIVE_PLAN_MODE_STATE });
}

export function subscribePlanMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _clearPlanModeListenersForTesting(): void {
  listeners.clear();
}

/** Generate a short ULID-ish id for session + artifact. Not a full
 *  ULID — just enough entropy for one-per-day human-readable names. */
export function generatePlanSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
