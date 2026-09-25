// H5 Phase 1 Step C · First concrete AgentAdapter (codex binary).
//
// Spawns the `codex` binary as a PTY subprocess and wraps it in an
// `EmbodiedAgentSession`. This is the baseline "terminal embodiment"
// for the codex brand — the user sees an interactive codex REPL in a
// VW pane, types directly, sees output live. A separate `kind:'acp'`
// or `kind:'rpc'` transport (Phase 3.B.2 / future SDK wrap) can
// attach to the same session via `EmbodiedAgentSession.transports[]`.
//
// H5 P3 · launch + wrap logic lives in `pty-adapter-factory.ts` now
// so claude-pty / gemini-pty can reuse the same recipe without
// duplicating ~100 LOC per brand.

import type { AgentAdapter } from '../embodiment.js';
import type { TransportObserver } from '../transport-observer.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type CodexPtyAdapterOpts = CreatePtyAdapterOpts;

const CODEX_SPEC: PtyAdapterSpec = {
  id: 'codex-pty',
  brands: ['codex'],
  binary: 'codex',
};

/** Factory — produces a configurable adapter instance. Production
 *  code typically calls `createCodexPtyAdapter()` with no args and
 *  registers the result into `defaultAdapterRegistry`. */
export function createCodexPtyAdapter(opts: CodexPtyAdapterOpts = {}): AgentAdapter {
  return createPtyAdapterFromSpec(CODEX_SPEC, opts);
}

/** Re-exported for unit tests that want to inspect observer attach. */
export type { TransportObserver };

/** Convenience · creates + registers the adapter on the default
 *  registry. Bundle 3 wires this call into app bootstrap. */
export function registerDefaultCodexPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: CodexPtyAdapterOpts,
): () => void {
  return registry.register(createCodexPtyAdapter(opts));
}
