// H5 Phase 3 · Gemini CLI PTY adapter.
//
// Spawns the `gemini` binary as a PTY subprocess using the shared
// pty-adapter-factory. Follows the same recipe as codex-pty and
// claude-pty so cross-brand orchestration (H5 P3 handoff, scheduler
// dispatch, etc.) is transport-symmetric.
//
// Brand matching:
//   - `'gemini'`
//   - `'gemini-cli'`
//
// Note on `--experimental-acp`: Gemini CLI has an ACP mode flag
// (see H5 P3 PLAN §3.1). This adapter deliberately uses the plain
// PTY path because the bus architecture (`EmbodiedAgentSession.
// transports[]`) attaches ACP as a separate transport entry when
// available — it does not require the binary to be launched in ACP
// mode. A future `createGeminiAcpAdapter` can stack on top.

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type GeminiPtyAdapterOpts = CreatePtyAdapterOpts;

const GEMINI_SPEC: PtyAdapterSpec = {
  id: 'gemini-pty',
  brands: ['gemini', 'gemini-cli'],
  binary: 'gemini',
};

export function createGeminiPtyAdapter(opts: GeminiPtyAdapterOpts = {}): AgentAdapter {
  return createPtyAdapterFromSpec(GEMINI_SPEC, opts);
}

export function registerDefaultGeminiPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: GeminiPtyAdapterOpts,
): () => void {
  return registry.register(createGeminiPtyAdapter(opts));
}
