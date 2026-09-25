// H5 Phase 3 · Claude Code PTY adapter.
//
// Spawns the `claude` binary (Anthropic's Claude Code CLI) as a PTY
// subprocess using the shared pty-adapter-factory. The session flows
// through the same `EmbodiedAgentSession` contract as codex-pty, so
// H5 P2 tools (SnapshotPtyState, ListPtySnapshots, ComparePtySnapshots)
// automatically work on claude sessions without any per-tool changes.
//
// Brand matching:
//   - `'claude'` — the generic brand token
//   - `'claude-code'` — explicit binary name
//
// Register via `registerDefaultClaudePtyAdapter(registry)` at dashboard
// bootstrap (after registerDefaultCodexPtyAdapter).

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type ClaudePtyAdapterOpts = CreatePtyAdapterOpts;

const CLAUDE_SPEC: PtyAdapterSpec = {
  id: 'claude-pty',
  brands: ['claude', 'claude-code'],
  binary: 'claude',
};

export function createClaudePtyAdapter(opts: ClaudePtyAdapterOpts = {}): AgentAdapter {
  return createPtyAdapterFromSpec(CLAUDE_SPEC, opts);
}

export function registerDefaultClaudePtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: ClaudePtyAdapterOpts,
): () => void {
  return registry.register(createClaudePtyAdapter(opts));
}
