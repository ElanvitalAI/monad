// H6 P2 Bundle 2 A2 · Remote local-LLM embodied session adapter
// (PTY-over-SSH via `ssh -t <node> lms chat <model>`).
//
// Bundle 2 A landed the local-only adapter (`local-llm-pty`). A2
// extends to Tailscale fleet nodes (node-b · mbp · …). Instead of
// generalizing the existing adapter (which would force resolveCommand
// hook additions on the shared pty-adapter-factory recipe and touch
// codex/claude/gemini indirectly), we register a sibling factory
// with static `binary: 'ssh'` + `defaultArgs: ['-t']`. The spawn
// layer picks which brand to route to based on nodeId (D19).
//
// Command composition at launch time:
//   binary     = 'ssh'
//   defaultArgs= ['-t']
//   extraArgs  = [nodeId, 'lms', 'chat', modelId]   ← caller supplies
//   → actual spawn: `ssh -t <node> lms chat <model>`
//
// Pre-flight: spawn-local-llm-in-vw.ts verifies `node.reachable`
// via manager before launching (D20) so SSH failures surface in
// <2s rather than blocking the PTY for the 30s OS default timeout.
//
// Design rails (PLAN §3.0.2 · D19-D22):
//   - D19 separate factory · no resolveCommand hook on shared recipe
//   - D20 reachability precheck before spawn
//   - D21 disconnect = session termination (no reconnect in v1)
//   - D22 minimal ssh flags · ['-t'] only · user ~/.ssh/config +
//         agent forwarding respected (unlike Bundle 1 probe which uses
//         BatchMode for non-interactive JSON probe)

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type LocalLlmSshPtyAdapterOpts = CreatePtyAdapterOpts;

const LOCAL_LLM_SSH_PTY_SPEC: PtyAdapterSpec = {
  id: 'local-llm-ssh-pty',
  brands: ['local-llm-remote', 'lll-remote'],
  binary: 'ssh',
  defaultArgs: ['-t'],
  transportLabel: 'local-llm-pty-remote',
};

/** Factory · produces an AgentAdapter that spawns
 *  `ssh -t <node> lms chat <model>`. Callers (spawn-local-llm-in-vw.ts)
 *  must supply `extraArgs = [nodeId, 'lms', 'chat', modelId]`. */
export function createLocalLlmSshPtyAdapter(
  opts: LocalLlmSshPtyAdapterOpts = {},
): AgentAdapter {
  return createPtyAdapterFromSpec(LOCAL_LLM_SSH_PTY_SPEC, opts);
}

export function registerDefaultLocalLlmSshPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: LocalLlmSshPtyAdapterOpts,
): () => void {
  return registry.register(createLocalLlmSshPtyAdapter(opts));
}
