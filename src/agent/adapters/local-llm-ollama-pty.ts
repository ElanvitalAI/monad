// H6 P2 Bundle 2 D · Ollama embodied session adapter (PTY via ollama run).
//
// Parallel to `local-llm-pty.ts` (Bundle 2 A · LM Studio `lms chat`).
// `ollama run <model>` is Ollama's built-in interactive REPL — auto-
// loads the model into memory on first token, streams stdout/stdin
// through the terminal, exits cleanly on Ctrl-C or EOF. Behavior is
// functionally identical to `lms chat` from the PTY layer's point of
// view; we simply register a second factory with `binary: 'ollama'` +
// `defaultArgs: ['run']` (PLAN D24).
//
// Brand + args composition happens in spawn-local-llm-in-vw.ts via
// `composeBrandArgs` (runtime-aware dispatch · PLAN D25). This adapter
// just forwards spec.extraArgs[0] (the model id) to `ollama run`.
//
// Design rails (PLAN §3.0.4 · D24/D25):
//   - D24 `LlmRequestInstall` is the only T2 install tool ·
//         boot/shutdown are not separate (run auto-loads · dispose = shutdown)
//   - D25 spawn-layer runtime-aware dispatch · no new slash · inventory
//         lookup picks this brand when model.runtime === 'ollama'

import type { AgentAdapter } from '../embodiment.js';
import {
  createPtyAdapterFromSpec,
  type CreatePtyAdapterOpts,
  type PtyAdapterSpec,
} from './pty-adapter-factory.js';

export type LocalLlmOllamaPtyAdapterOpts = CreatePtyAdapterOpts;

const LOCAL_LLM_OLLAMA_PTY_SPEC: PtyAdapterSpec = {
  id: 'local-llm-ollama-pty',
  brands: ['local-llm-ollama', 'llo'],
  binary: 'ollama',
  defaultArgs: ['run'],
  transportLabel: 'local-llm-ollama-pty',
};

export function createLocalLlmOllamaPtyAdapter(
  opts: LocalLlmOllamaPtyAdapterOpts = {},
): AgentAdapter {
  return createPtyAdapterFromSpec(LOCAL_LLM_OLLAMA_PTY_SPEC, opts);
}

export function registerDefaultLocalLlmOllamaPtyAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: LocalLlmOllamaPtyAdapterOpts,
): () => void {
  return registry.register(createLocalLlmOllamaPtyAdapter(opts));
}
