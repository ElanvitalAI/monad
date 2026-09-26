// Agent CLI (`elanous agent`) logs.db sink initializer.
//
// `elanous agent` runs as a standalone process that does NOT inherit the nexus
// daemon's StoreSink. Without registering a sink here, core-turn debug.log
// events (e.g. capability.resolve — src/core-turn/run-core-turn.ts) land only in
// the file trail and never reach logs.db, so `elanous logs --category
// capability.resolve` shows nothing for the agent path. This initializer closes
// that gap, mirroring the nexus reference (src/nexus/index.ts) and the existing
// standalone-sink call sites (TUI, agent-mission preAction).
//
// Note: `runChatTurnCli` is shared by chat/ask, which intentionally do NOT carry
// the agent surface, so registration lives at the `agent` command entry only.

type RegisterStandaloneLogSink = (surface: string) => Promise<void>;

/**
 * Build an idempotent agent-CLI log-sink initializer.
 *
 * - Single-flight: concurrent entries share one in-flight registration.
 * - No failure caching: a rejected attempt is cleared so a later entry can retry.
 * - Fail-open is the CALLER's contract — the initializer rethrows on failure and
 *   the caller must swallow it so logging never blocks the agent turn.
 *
 * `registerStandaloneLogSink` is injectable for behavior tests; production omits
 * it and the real domains/standalone-log-sink helper is imported lazily.
 */
export function createAgentCliLogSinkInitializer(
  registerStandaloneLogSink?: RegisterStandaloneLogSink,
): () => Promise<void> {
  let inFlight: Promise<void> | undefined;

  return (): Promise<void> => {
    if (!inFlight) {
      inFlight = (async () => {
        const register = registerStandaloneLogSink
          ?? (await import('../domains/standalone-log-sink.js')).registerStandaloneLogSink;
        await register('agent');
      })().catch((err) => {
        inFlight = undefined; // do not cache failure — allow a later retry
        throw err;
      });
    }
    return inFlight;
  };
}

/** Process-wide singleton used by the real `elanous agent` entry (src/index.ts). */
export const initializeAgentCliLogSink = createAgentCliLogSinkInitializer();
