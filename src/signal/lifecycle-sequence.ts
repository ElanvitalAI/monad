import { createSeqCounter } from './lifecycle-record.js';

const counters = new Map<string, () => number>();

/** Returns the next process-wide lifecycle sequence for one producer PTY. */
export function nextLifecycleSequence(ptyId: string): number {
  let counter = counters.get(ptyId);
  if (!counter) {
    counter = createSeqCounter();
    counters.set(ptyId, counter);
  }
  return counter();
}

export function resetLifecycleSequencesForTesting(): void {
  counters.clear();
}
