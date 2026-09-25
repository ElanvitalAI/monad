// H6 P5 · Per-session TransportObserver registry.
//
// H5 P2 landed the `TransportObserver` class + the attach path that
// pty-adapter-factory runs on every PTY launch, but the observer
// handle was only kept alive via the wrapped `session.dispose` — no
// way for outside callers to look it up by sessionId.
//
// H6 P5 AgentReply needs observer access to diff the reply output
// against a pre-send buffer mark. This tiny module is the source of
// truth for that lookup without creating circular imports:
//   - pty-adapter-factory.ts  → registers on attach
//   - spawn-embodied-agent-in-vw.ts → exposes `findSessionObserver`
//   - src/agent/reply.ts      → consumes via deps.observerLookup
//
// The registry holds weak-ish entries: any session.dispose() wrapper
// that called the factory's observer-attach path also calls
// `unregisterSessionObserver` so dead sessions don't leak.

import type { TransportObserver } from './transport-observer.js';

const _observers = new Map<string, TransportObserver>();

export function registerSessionObserver(
  sessionId: string,
  observer: TransportObserver,
): void {
  _observers.set(sessionId, observer);
}

export function unregisterSessionObserver(sessionId: string): void {
  _observers.delete(sessionId);
}

export function findSessionObserver(sessionId: string): TransportObserver | undefined {
  return _observers.get(sessionId);
}

/** Read-only iteration · used by diagnostics + tests. */
export function listSessionObservers(): ReadonlyArray<{
  readonly sessionId: string;
  readonly observer: TransportObserver;
}> {
  const out: Array<{ sessionId: string; observer: TransportObserver }> = [];
  for (const [sessionId, observer] of _observers) {
    out.push({ sessionId, observer });
  }
  return out;
}

export function _resetSessionObserversForTesting(): void {
  _observers.clear();
}
