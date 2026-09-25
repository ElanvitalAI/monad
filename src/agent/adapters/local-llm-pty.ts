// H6 P2 Bundle 2 A · Local LLM embodied session adapter (PTY via lms chat).
//
// Pre-infra check (2026-04-22) confirmed `lms chat <model>` is LM
// Studio's official interactive REPL — no HTTP wrapper needed. We
// spawn the CLI as a PTY subprocess via the shared factory recipe
// (same path as codex-pty / claude-pty / gemini-pty), so transport
// stays `'pty'` and P5 AgentReply / P6 capture / P7 inject / /handoff
// cross-class all work without change (see PLAN D14).
//
// The model name arrives at spawn time in `AgentLaunchSpec.extraArgs`
// (set by spawn-local-llm-in-vw.ts) because the factory's static
// `defaultArgs` can't encode per-launch model selection. Composition:
//   binary     = 'lms'
//   defaultArgs= ['chat']
//   extraArgs  = [<modelId>]      ← caller-provided per launch
//   → actual spawn: `lms chat <modelId>`
//
// Bundle 2 A scope (PLAN §3.0.1):
//   - local node only (D18 · remote PTY-over-SSH is Bundle 2 A2)
//   - LM Studio only (D2 · Ollama/MLX/Docker is Bundle 2 C)
//   - no HTTP wrapper / no 'api' transport (D14)
//   - chat widget (Option C) is IDX track arc (D16)

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type LocalLlmPtyAdapterOpts = CreatePtyAdapterOpts;

const LOCAL_LLM_PTY_SPEC: PtyAdapterSpec = {
  id: 'local-llm-pty',
  brands: ['local-llm', 'lll'],
  binary: 'lms',
  defaultArgs: ['chat'],
  transportLabel: 'local-llm-pty',
};

/** Factory · produces an AgentAdapter that spawns `lms chat <model>`
 *  where `<model>` is taken from `AgentLaunchSpec.extraArgs[0]`.
 *  Callers typically use `spawn-local-llm-in-vw.ts` which composes
 *  the spec correctly. */
export function createLocalLlmPtyAdapter(opts: LocalLlmPtyAdapterOpts = {}): AgentAdapter {
  return createPtyAdapterFromSpec(LOCAL_LLM_PTY_SPEC, opts);
}

/** Convenience · creates and registers the adapter on the given
 *  registry · called from `initSpawnEmbodiedAgentInVW` bootstrap. */
export function registerDefaultLocalLlmPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: LocalLlmPtyAdapterOpts,
): () => void {
  return registry.register(createLocalLlmPtyAdapter(opts));
}
