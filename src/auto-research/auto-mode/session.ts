// ── PFC-S4 P5: auto-mode singleton session ──
//
// Mirror of src/plan-mode/session.ts. The only differences are field
// names + the default state. Deep-copies on getAutoModeState() are
// important because AutoModeState carries the TerminationRule AST —
// callers that mutate would break subsequent evaluations.

import {
  INACTIVE_AUTO_MODE_STATE,
  type AutoModeState,
} from './types.js';

let state: AutoModeState = { ...INACTIVE_AUTO_MODE_STATE };

type Listener = (state: AutoModeState) => void;
const listeners = new Set<Listener>();

export function getAutoModeState(): AutoModeState {
  return {
    ...state,
    terminationRule: state.terminationRule ? structuredClone(state.terminationRule) : undefined,
  };
}

export function isAutoModeActive(): boolean {
  return state.active;
}

export function setAutoModeState(next: AutoModeState): void {
  state = next;
  for (const fn of listeners) {
    try { fn(getAutoModeState()); } catch { /* never break caller */ }
  }
}

export function resetAutoModeForTest(): void {
  setAutoModeState({ ...INACTIVE_AUTO_MODE_STATE });
  listeners.clear();
}

export function subscribeAutoMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Generate a short ULID-ish id for auto-mode session. */
export function generateAutoModeSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
