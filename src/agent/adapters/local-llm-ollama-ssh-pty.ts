// H6 P2 Bundle 2 D · Remote Ollama embodied session adapter.
//
// Parallel to `local-llm-ssh-pty.ts` (Bundle 2 A2 · remote LM Studio).
// Spawns `ssh -t <node> ollama run <model>` as a PTY-over-SSH · shares
// all the same tradeoffs (no reconnect · minimal ssh flags · reach-
// ability precheck at the spawn layer before this adapter is invoked).
//
// Composition at launch time:
//   binary     = 'ssh'
//   defaultArgs= ['-t']
//   extraArgs  = [nodeId, 'ollama', 'run', modelId]   ← caller-supplied
//   → actual spawn: `ssh -t <node> ollama run <model>`
//
// Design rails (PLAN §3.0.4 · D24/D25 · D18/D22 carry-over from A2):
//   - D22 minimal ssh flags · user ~/.ssh/config + agent forwarding respected
//   - D18/D20 reachability precheck lives in spawn-local-llm-in-vw.ts

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type LocalLlmOllamaSshPtyAdapterOpts = CreatePtyAdapterOpts;

const LOCAL_LLM_OLLAMA_SSH_PTY_SPEC: PtyAdapterSpec = {
  id: 'local-llm-ollama-ssh-pty',
  brands: ['local-llm-ollama-remote', 'llo-remote'],
  binary: 'ssh',
  defaultArgs: ['-t'],
  transportLabel: 'local-llm-ollama-pty-remote',
};

export function createLocalLlmOllamaSshPtyAdapter(
  opts: LocalLlmOllamaSshPtyAdapterOpts = {},
): AgentAdapter {
  return createPtyAdapterFromSpec(LOCAL_LLM_OLLAMA_SSH_PTY_SPEC, opts);
}

export function registerDefaultLocalLlmOllamaSshPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: LocalLlmOllamaSshPtyAdapterOpts,
): () => void {
  return registry.register(createLocalLlmOllamaSshPtyAdapter(opts));
}
