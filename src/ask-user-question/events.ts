// Pub/sub for completed AskUserQuestion calls — Phase WF1.
//
// Mirrors src/code-edit/events.ts. The tool runtime returns the
// answers as JSON in `output` for the LLM, and also publishes the
// structured result on this bus so the dashboard (or any future UI
// consumer) can pick it up — e.g. for trace logging or replay.

import type { AskUserQuestionResult } from './types.js';

type Listener = (result: AskUserQuestionResult & { questionIds: string[] }) => void;

const listeners = new Set<Listener>();

export function subscribeQuestionResult(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function publishQuestionResult(
  result: AskUserQuestionResult,
  questionIds: string[],
): void {
  for (const fn of listeners) {
    try { fn({ ...result, questionIds }); } catch { /* never break runtime */ }
  }
}

export function _clearQuestionResultListenersForTesting(): void {
  listeners.clear();
}
