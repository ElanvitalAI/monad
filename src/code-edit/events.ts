// Lightweight pub/sub for code-edit results — Phase CE3.
//
// Rationale: the ToolRuntime contract is `run(req) -> { output }`
// (plain string), so the rendered diff can't ride back on the return
// value without widening the contract for every other runtime. And
// we deliberately don't want the ANSI-coloured diff in the tool
// `output` that goes to the LLM — the model reads text, coloured
// escapes are noise.
//
// So the code-edit runtime publishes an EditResult event on this
// bus when Edit/Write succeeds; the dashboard subscribes at init
// time and renders the diff block into chatLines. Skills that don't
// care can ignore the bus.

import type { EditResult } from './types.js';
import { getSourceDeltaManager, type SourceDeltaEvent } from './source-delta.js';

type EditListener = (result: EditResult) => void;
type SourceDeltaListener = (event: SourceDeltaEvent) => void;

const editListeners = new Set<EditListener>();
const sourceDeltaListeners = new Set<SourceDeltaListener>();

export function subscribeEditResult(fn: EditListener): () => void {
  editListeners.add(fn);
  return () => { editListeners.delete(fn); };
}

export function subscribeSourceDelta(fn: SourceDeltaListener): () => void {
  sourceDeltaListeners.add(fn);
  return () => { sourceDeltaListeners.delete(fn); };
}

export function publishEditResult(result: EditResult): void {
  const sourceDelta = getSourceDeltaManager().onEditResult(result);
  for (const fn of editListeners) {
    try { fn(result); } catch { /* never let a subscriber break the runtime */ }
  }
  for (const fn of sourceDeltaListeners) {
    try { fn(sourceDelta); } catch { /* never let a subscriber break the runtime */ }
  }
}

/** For tests — blow away every listener. */
export function _clearEditResultListenersForTesting(): void {
  editListeners.clear();
  sourceDeltaListeners.clear();
}
