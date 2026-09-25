// 6-state machine for the interactive modal Q&A widget.
//
// The widget walks an ordered chain of steps. Each step has a small
// internal cycle (show input → wait for answer → resolve answer →
// chain to next step), and the whole session has a terminal
// (done / cancel) state. Keeping the machine explicit + pure makes
// it trivial to test, reason about, and instrument.
//
//   show ──► awaiting ──► answered ──► chained ──► (next) awaiting
//                │            │           │
//                ▼            ▼           ▼
//             cancel        cancel      done
//
// `cancel` and `done` are absorbing — once entered, no further
// transitions are allowed. The machine does not own side effects;
// the host (`InteractiveModalSession`) reads the snapshot, invokes
// listeners, and feeds events back in.

export type ModalSessionState =
  | 'idle'        // before mount
  | 'show'        // step rendered, before any input
  | 'awaiting'    // input host pumped, waiting for an answer / key
  | 'answered'    // answer received, validation pending
  | 'chained'     // step accepted, transitioning to next
  | 'done'        // terminal — all steps resolved
  | 'cancel';     // terminal — user aborted

export type ModalSessionEvent =
  | { kind: 'mount' }
  | { kind: 'await' }
  | { kind: 'answer'; value: unknown }
  | { kind: 'accept' }                 // answer validated → chained
  | { kind: 'reject'; reason: string } // validation failed → back to awaiting
  | { kind: 'next' }                   // chained → next step's show
  | { kind: 'finish' }                 // last step accepted → done
  | { kind: 'cancel'; reason?: string };

export interface ModalSessionSnapshot {
  state: ModalSessionState;
  /** Latest answer for the current step. Cleared on `next`. */
  pendingAnswer?: unknown;
  /** Reason a transition was blocked / a cancel occurred. */
  reason?: string;
}

const TERMINAL: ReadonlyArray<ModalSessionState> = ['done', 'cancel'];

/** Pure transition. Returns either a new snapshot or `null` when the
 *  event is not legal for the current state — callers can warn /
 *  drop / log without the machine throwing. */
export function transition(
  prev: ModalSessionSnapshot,
  ev: ModalSessionEvent,
): ModalSessionSnapshot | null {
  if (TERMINAL.includes(prev.state)) {
    // Terminal state — only re-cancellation is benign (idempotent).
    if (ev.kind === 'cancel' && prev.state === 'cancel') return prev;
    return null;
  }
  switch (ev.kind) {
    case 'mount':
      return prev.state === 'idle' ? snap('show') : null;
    case 'await':
      return prev.state === 'show' || prev.state === 'chained'
        ? snap('awaiting')
        : null;
    case 'answer':
      return prev.state === 'awaiting'
        ? { state: 'answered', pendingAnswer: ev.value }
        : null;
    case 'accept':
      return prev.state === 'answered'
        ? { state: 'chained', pendingAnswer: prev.pendingAnswer }
        : null;
    case 'reject':
      return prev.state === 'answered'
        ? { state: 'awaiting', reason: ev.reason }
        : null;
    case 'next':
      return prev.state === 'chained' ? snap('show') : null;
    case 'finish':
      return prev.state === 'chained' ? snap('done') : null;
    case 'cancel':
      return { state: 'cancel', reason: ev.reason };
  }
}

function snap(state: ModalSessionState): ModalSessionSnapshot {
  return { state };
}

export const INITIAL_SNAPSHOT: ModalSessionSnapshot = { state: 'idle' };

/** Convenience: run a sequence of events and return the final
 *  snapshot. Stops at the first illegal event and returns the last
 *  legal snapshot together with the offending event index — useful
 *  for both tests and debug logs. */
export function run(
  events: ReadonlyArray<ModalSessionEvent>,
  start: ModalSessionSnapshot = INITIAL_SNAPSHOT,
): { snapshot: ModalSessionSnapshot; rejectedAt?: number } {
  let cur = start;
  for (let i = 0; i < events.length; i++) {
    const next = transition(cur, events[i]!);
    if (!next) return { snapshot: cur, rejectedAt: i };
    cur = next;
  }
  return { snapshot: cur };
}
