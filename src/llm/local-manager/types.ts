// H6 P2 Bundle 1 · Local LLM Manager · shared types.
//
// Read-only inventory types for the Bundle 1 subset: Tailscale fleet
// discovery + LM Studio `lms ls` probing + multi-node routing via
// `local-llm:<node>:<model>` model spec. Install/boot/Intel + non-LM
// Studio runtimes (Ollama/MLX/Docker) + embodied session adapter are
// Bundle 2+ (see PLAN §3.0).
//
// Design rails (PLAN §5):
//   - D2  LM Studio = default runtime · Bundle 1 에서는 LM Studio 전용
//   - D3  Multi-machine 1st-class · per-node baseUrl 는 `http://<node>:1234`
//   - D9  Inventory staleness 5 분 · refreshInventory() 강제 refresh
//   - D11 Bundle 1 inventory-only · no embodied session
//   - D13 node-registry 는 ssh-hosts.ts 재사용

export type LlmRuntime =
  | 'lmstudio'
  | 'ollama'       // Bundle 2 · Bundle 1 에서는 probe 안 함
  | 'mlx'          // Bundle 2
  | 'llamacpp'     // Bundle 2
  | 'docker';      // Bundle 2

/** Per-node descriptor · used by Manager + surfaced via `/llm nodes`. */
export interface LlmNode {
  /** Stable node id · `'local'` for elanous host · ssh-host name otherwise. */
  readonly id: string;
  /** Human-readable label · typically same as id for clarity. */
  readonly label: string;
  /** Whether this node is the local elanous host (no SSH needed). */
  readonly isLocal: boolean;
  /** SSH host override · undefined for local node. */
  readonly sshHost?: string;
  /** SSH user · typically omitted (inherits from ~/.ssh/config). */
  readonly sshUser?: string;
  /** Short description from ssh-hosts.ts · "MacBook Pro" etc. */
  readonly description?: string;
  /** Last probe time (ms epoch) · 0 before first probe. */
  readonly lastProbedAt: number;
  /** Probe reachability · undefined = not yet probed. */
  readonly reachable?: boolean;
  /** Runtimes detected as available on this node (Bundle 1 = lmstudio only). */
  readonly runtimes: readonly LlmRuntime[];
  /** LM Studio API base URL when available · e.g. `http://mbp:1234/v1`. */
  readonly lmstudioBaseUrl?: string;
  /** Ollama API base URL when available · e.g. `http://mbp:11434/v1`.
   *  Bundle 2 C1 · populated by `probeOllama` when the daemon is reachable. */
  readonly ollamaBaseUrl?: string;
  /** MLX (mlx_lm.server) API base URL when available · e.g.
   *  `http://mbp:8080/v1`. Bundle 2 C2 · populated by `probeMlx` when
   *  `mlx_lm.server` is running (MLX has no daemon auto-start · user
   *  must launch it manually or via LaunchAgent). */
  readonly mlxBaseUrl?: string;
  /** Docker-hosted LLM container API base URL when available · e.g.
   *  `http://localhost:11435/v1`. Bundle 2 C3 · populated by
   *  `probeDocker` when a running container's image name matches the
   *  LLM filter (ollama/vllm/tgi/...) and a published port exists. v1
   *  surfaces only the first matched container per node; multi-LLM-
   *  container nodes are a Bundle 3 concern (D32). */
  readonly dockerBaseUrl?: string;
}

/** A model entry discovered on a specific node + runtime. */
export interface LlmModel {
  /** Model identifier as reported by the runtime · passed straight to
   *  the OpenAI-compat `model:` field. Examples:
   *  `qwen2.5-32b-instruct-mlx` · `gpt-oss-20b-gguf`. */
  readonly id: string;
  /** The node this model lives on. */
  readonly nodeId: string;
  /** The runtime hosting the model. */
  readonly runtime: LlmRuntime;
  /** Human label · typically the `id` with runtime prefix dropped. */
  readonly label: string;
  /** Whether the model is currently loaded / serving. Populated by
   *  probes that expose load state (LM Studio `/api/v0/models`
   *  reports `state: "loaded" | "not-loaded"`; Ollama `/api/ps` lists
   *  loaded models separately). `undefined` when the probe couldn't
   *  determine load state — caller treats as "unknown, assume idle". */
  readonly loaded?: boolean;
  /** Size in bytes when available · `undefined` if unknown. */
  readonly sizeBytes?: number;
  /** Architecture / format hint · `'mlx' | 'gguf' | 'safetensors' | ...`. */
  readonly format?: string;
  /** Capability tags reported by the runtime · e.g. `['tool_use']` ·
   *  `['vision']`. LM Studio v0 surfaces this in
   *  `capabilities: string[]`; other runtimes leave undefined.
   *  Routing layer can use this to gate tool-use prompts to models
   *  that actually support function calling. */
  readonly capabilities?: readonly string[];
  /** Maximum context window the model file supports (tokens). LM
   *  Studio v0 reports this in `max_context_length`. `undefined` when
   *  unknown. Different from `loadedContextWindow` — a model can be
   *  loaded with a smaller context budget than its theoretical max. */
  readonly contextWindow?: number;
  /** Context window the model is currently configured to serve with
   *  (tokens). LM Studio v0 reports this as `loaded_context_length`
   *  on loaded models. When set this is the authoritative input
   *  budget for `/context` gating; otherwise fall back to
   *  `contextWindow`. */
  readonly loadedContextWindow?: number;
  /** Architecture identifier from the runtime · e.g. `qwen3_5_moe` ·
   *  `gemma4` · `llama`. LM Studio v0 only. Catalog matchers can use
   *  this to map local IDs onto BUILTIN_CATALOG family entries. */
  readonly arch?: string;
  /** Quantization label · `'4bit'` · `'Q4_K_M'` · `'8bit'` · `'fp16'`.
   *  Surfaced for the wizard description. */
  readonly quantization?: string;
  /** Publisher / org slug · `'mlx-community'` · `'unsloth'`. Used by
   *  the wizard to disambiguate same-named models from different
   *  providers (e.g. `mlx-community/gemma-4-26b-a4b-it` vs
   *  `lmstudio-community/gemma-4-26b-a4b-it`). */
  readonly publisher?: string;
  /** Last probe time (ms epoch). */
  readonly probedAt: number;
}

/** Single probe outcome for one node + runtime combo. */
export interface LlmProbeResult {
  readonly nodeId: string;
  readonly runtime: LlmRuntime;
  readonly reachable: boolean;
  readonly models: readonly LlmModel[];
  /** Optional base URL (LM Studio HTTP endpoint). */
  readonly baseUrl?: string;
  /** Non-fatal warnings · e.g. `'cli-missing'` · `'ssh-timeout'` · `'parse-failed'`. */
  readonly warnings: readonly string[];
  /** When the probe ran (ms epoch). */
  readonly probedAt: number;
  /** ms elapsed during probe · timeout diagnostics. */
  readonly elapsedMs: number;
}

/** Aggregate inventory snapshot · returned by `Manager.getInventory()`. */
export interface LlmInventory {
  readonly nodes: readonly LlmNode[];
  /** Flat list of all models across nodes · sorted by `nodeId, label`. */
  readonly models: readonly LlmModel[];
  /** When the snapshot was taken (ms epoch). */
  readonly at: number;
  /** Cache hit if the snapshot came from cache (vs fresh probe). */
  readonly cached: boolean;
  /** Aggregate warnings across all probes. */
  readonly warnings: readonly string[];
}

/** Canonical local-llm model spec parse result. */
export interface LocalLlmSpec {
  /** Raw spec · `local-llm:<node>:<model>` or legacy `local:<model>`. */
  readonly raw: string;
  /** Node id · `'local'` for legacy single-host spec. */
  readonly nodeId: string;
  /** Model id · runtime-specific string passed to OpenAI-compat `model:`. */
  readonly modelId: string;
}

/** Parse a local-llm model spec. Accepts:
 *   - `local-llm:<node>:<model>` (Bundle 1 canonical)
 *   - `local:<model>` (legacy · single-host · nodeId=`'local'`)
 *   - `local-llm:<model>` (implicit local node · nodeId=`'local'`)
 *
 *  Returns null when the spec doesn't match any local-llm shape. */
export function parseLocalLlmSpec(raw: string): LocalLlmSpec | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.startsWith('local-llm:')) {
    const rest = raw.slice('local-llm:'.length);
    const idx = rest.indexOf(':');
    if (idx < 0) {
      // local-llm:<model> · implicit local
      return { raw, nodeId: 'local', modelId: rest };
    }
    const nodeId = rest.slice(0, idx);
    const modelId = rest.slice(idx + 1);
    if (!nodeId || !modelId) return null;
    return { raw, nodeId, modelId };
  }
  if (raw.startsWith('local:')) {
    const modelId = raw.slice('local:'.length);
    if (!modelId) return null;
    return { raw, nodeId: 'local', modelId };
  }
  return null;
}

/** Default LM Studio API port when not configured via ssh-hosts.json. */
export const LMSTUDIO_DEFAULT_PORT = 1234;

/** Default Ollama API port (Bundle 2 C1 · D23). Ollama binds to
 *  127.0.0.1 by default so remote probes go through SSH (curl on
 *  the remote · matches Bundle 1 pattern). */
export const OLLAMA_DEFAULT_PORT = 11434;

/** Default MLX `mlx_lm.server` API port (Bundle 2 C2 · D32). The
 *  server binds to 127.0.0.1 by default (same as Ollama) so remote
 *  probes go through SSH. User must launch `mlx_lm.server --model
 *  <path>` themselves — no daemon auto-start. */
export const MLX_DEFAULT_PORT = 8080;

/** Default inventory staleness window (D9 · 5 min). */
export const INVENTORY_STALENESS_MS = 5 * 60 * 1000;

/** Default SSH probe timeout · matches `ssh-fs.ts`. */
export const PROBE_TIMEOUT_MS = 15_000;
