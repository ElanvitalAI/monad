// H5 Phase 1 Step F · Attach additional transports to an existing
// EmbodiedAgentSession.
//
// The adapter (Step C) produces a session with a single PTY transport.
// Other subsystems may want to add co-existing transports to the same
// session — e.g. an ACP connection that controls the same codex
// instance the user is typing to, or the H4 P3.B.2 RPC client. This
// helper is a thin functional overlay: it returns a new session
// object that shares the original's state/send/interrupt/snapshot/
// dispose but advertises a combined `transports[]` list.
//
// Rationale over mutating `session.transports` directly: the
// `EmbodiedAgentSession.transports` field is declared readonly in
// the type contract (PR #434). Mutating it is a type violation and
// would corrupt references held by earlier callers. Returning a new
// session preserves immutability and makes the layering explicit.

import type {
  EmbodiedAgentSession,
  EmbodiedTransportKind,
} from './embodiment.js';

export interface AttachedTransport {
  readonly kind: EmbodiedTransportKind;
  readonly id: string;
  readonly label?: string;
}

/** Return a new session object whose `transports[]` includes the
 *  original's entries plus the supplied additions. All lifecycle
 *  methods (state · send · interrupt · snapshot · dispose) are
 *  forwarded to the underlying session.
 *
 *  The additions are appended in order after the existing transports,
 *  so a caller can build up a session incrementally without losing
 *  the PTY-transport-first convention that `CodexPtyAdapter` produces. */
export function attachTransports(
  base: EmbodiedAgentSession,
  additions: readonly AttachedTransport[],
): EmbodiedAgentSession {
  if (additions.length === 0) return base;
  const merged = Object.freeze([
    ...base.transports,
    ...additions.map((t) => Object.freeze({ ...t })),
  ]);
  return {
    id: base.id,
    launchSpec: base.launchSpec,
    transports: merged,
    state: () => base.state(),
    send: (input) => base.send(input),
    interrupt: (signal) => base.interrupt(signal),
    snapshot: () => base.snapshot(),
    dispose: () => base.dispose(),
  };
}
