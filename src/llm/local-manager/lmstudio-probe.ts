// H6 P2 Bundle 1 · LM Studio probe (Bundle 2 C2+C3 fleet fixups · HTTP primary).
//
// 2026-04-22 (fleet fixups): migrated from `lms ls --json` CLI to the
// OpenAI-compat HTTP endpoint (`GET :1234/v1/models`). Root causes that
// forced the rewrite:
//
//   - `lms ls --json` emits a top-level array on current versions (the
//     `{models:[...]}` object shape is legacy only). The original
//     parser looked up `parsed.models ?? []` and silently returned 0
//     models on modern LM Studio → `/llm nodes` showed `no-models`
//     even when dozens of models were installed. (Bundle 1 regression
//     surfaced during C2+C3 dogfood.)
//   - The CLI-only approach meant any node running LM Studio through
//     the GUI without the `lms` CLI installed (common across the
//     user's Tailscale fleet — e.g. node-b had HTTP :1234 working but
//     no CLI) reported `cli-missing` and was treated as offline.
//
// Switching to HTTP mirrors the Ollama / MLX pattern: one curl, no
// CLI dependency, OpenAI-compat `data[].id` parsed out. Same taxonomy
// (`daemon-down` when port 1234 refuses the connection — LM Studio
// GUI not running or Developer mode disabled).
//
// 2026-05-05 (qwen3.6 dogfood): switched primary endpoint from
// `/v1/models` to `/api/v0/models`. The OpenAI-compat list at /v1
// only carries `id` + `object` + `owned_by` — uniform across "all
// models LM Studio knows about", so the picker can't distinguish
// loaded vs idle and the routing layer can't gate tool-use to
// capable models. The v0 endpoint (LM Studio ≥0.3.5) returns the
// full LM Studio shape per row:
//   { id, type, publisher, arch, compatibility_type, quantization,
//     state: "loaded"|"not-loaded", max_context_length,
//     loaded_context_length, capabilities: ["tool_use"] }
// We fall back to /v1/models when v0 returns HTTP 404 (older LM
// Studio installs) so existing fleets keep working — only the
// extra-fields surface degrades gracefully.
//
// Local probe  → `curl -sf --max-time <s> http://127.0.0.1:1234/api/v0/models`
//                (fallback) http://127.0.0.1:1234/v1/models
// Remote probe → `ssh <host> curl -sf --max-time <s> http://127.0.0.1:1234/api/v0/models`
//
// Failure taxonomy (shared with ollama/mlx):
//   - 'daemon-down'   — connection refused (LM Studio app down /
//                        Developer mode off / port misconfigured)
//   - 'cli-missing'   — curl not on PATH
//   - 'parse-failed'  — JSON shape unexpected
//   - 'no-models'     — daemon up but 0 models
//   - shared: 'ssh-timeout' · 'unreachable' · 'ssh-auth' · 'probe-error'
//
// Design rails (PLAN §3.0, §5 D2/D3/D9):
//   - D2  Bundle 1 = LM Studio only · Ollama/MLX/Docker are Bundle 2+
//   - D3  Multi-machine 1st-class · remote probe via direct ssh
//   - D9  5 min staleness · caller decides when to invalidate

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type { LlmModel, LlmProbeResult, LlmRuntime } from './types.js';
import { LMSTUDIO_DEFAULT_PORT, PROBE_TIMEOUT_MS } from './types.js';
import { updateNodeStatus } from './node-registry.js';

/** Subset of the `/v1/models` OpenAI-compat response LM Studio emits.
 *  Permissive — LM Studio ships only `{id, object}` most of the time. */
export interface LmstudioModelsJson {
  readonly object?: string;
  readonly data?: readonly Partial<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    /** Present on the LM Studio `/api/v0/models` extension. */
    type: string;
    publisher: string;
    arch: string;
    compatibility_type: string;
    quantization: string;
    state: 'loaded' | 'not-loaded';
    max_context_length: number;
    loaded_context_length: number;
    capabilities: readonly string[];
  }>[];
}

export interface ProbeDeps {
  /** Run an arg-vector locally · returns stdout. Throws on timeout /
   *  non-zero exit (stderr message). */
  readonly runLocal?: (
    argv: readonly string[],
    opts: { timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  /** Run an arg-vector on a remote host via ssh. */
  readonly runRemote?: (
    host: string,
    argv: readonly string[],
    opts: { timeoutMs: number; user?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Probe one node for LM Studio inventory via the OpenAI-compat
 *  `/v1/models` endpoint.
 *  - Updates the node-registry status cache as a side effect.
 *  - Returns a structured result even on failure (reachable=false +
 *    warnings populated) so callers can aggregate without try/catch.
 */
export async function probeLmstudio(
  node: { id: string; isLocal: boolean; sshHost?: string; sshUser?: string },
  deps: ProbeDeps = {},
): Promise<LlmProbeResult> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const startedAt = now();
  const warnings: string[] = [];
  let stdout = '';

  // LM Studio default binds to 127.0.0.1 when Developer mode is on.
  // Remote nodes run curl over SSH (same pattern as Ollama/MLX) so
  // the remote 127.0.0.1 is the target, not the origin machine.
  //
  // We try `/api/v0/models` first (LM Studio ≥0.3.5 · richer payload
  // with state / capabilities / context windows) and fall back to the
  // OpenAI-compat `/v1/models` only when v0 returns HTTP 404 — that's
  // the curl exit code 22 path (HTTP error >=400 with -sf). Any other
  // failure mode (connection refused, timeout, ssh issues) propagates
  // through the existing taxonomy without spending an extra round-trip
  // on /v1.
  const curlTimeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000 / 2));
  const buildCurl = (path: string): string[] => [
    'curl',
    '-sf',
    '--max-time', String(curlTimeoutSec),
    `http://127.0.0.1:${LMSTUDIO_DEFAULT_PORT}${path}`,
  ];
  const tryEndpoint = async (path: string): Promise<string> => {
    if (node.isLocal) {
      const runner = deps.runLocal ?? runLocalDefault;
      const r = await runner(buildCurl(path), { timeoutMs });
      return r.stdout;
    } else {
      if (!node.sshHost) throw new Error('missing-ssh-host');
      const runner = deps.runRemote ?? runRemoteDefault;
      const r = await runner(
        node.sshHost,
        buildCurl(path),
        { timeoutMs, ...(node.sshUser ? { user: node.sshUser } : {}) },
      );
      return r.stdout;
    }
  };
  let usedV0 = false;
  try {
    try {
      stdout = await tryEndpoint('/api/v0/models');
      usedV0 = true;
    } catch (v0Err) {
      const msg = v0Err instanceof Error ? v0Err.message : String(v0Err);
      // Curl exit 22 = HTTP error response (the v0 endpoint is missing
      // on older LM Studio versions). Retry on the legacy /v1/models.
      // Other failure shapes (connection refused, ssh, timeout) bubble
      // up to the outer catch unchanged — no point hammering the same
      // unreachable host twice.
      if (msg.includes('exited 22') || msg.toLowerCase().includes('not found')) {
        if (debug.enabled) {
          debug.log('llm.probe.lmstudio.v0-fallback', node.id, { reason: msg });
        }
        stdout = await tryEndpoint('/v1/models');
      } else {
        throw v0Err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = msg === 'missing-ssh-host'
      ? 'missing-ssh-host'
      : classifyProbeError(msg);
    warnings.push(warning);
    if (debug.enabled) {
      debug.log('llm.probe.lmstudio.failed', node.id, { warning, message: msg }, { level: 'error' });
    }
    const probedAt = now();
    updateNodeStatus(node.id, { reachable: false, runtimes: [], at: probedAt });
    return {
      nodeId: node.id,
      runtime: 'lmstudio',
      reachable: false,
      models: [],
      warnings,
      probedAt,
      elapsedMs: probedAt - startedAt,
    };
  }

  // Parse JSON · permissive about shape variants.
  let parsed: LmstudioModelsJson | null = null;
  try {
    parsed = JSON.parse(stdout) as LmstudioModelsJson;
  } catch {
    warnings.push('parse-failed');
  }

  const probedAt = now();
  const baseUrl = defaultLmstudioBaseUrl(node);
  const models: LlmModel[] = parsed
    ? extractModels(parsed, node.id, probedAt)
    : [];
  if (parsed && models.length === 0) warnings.push('no-models');

  const runtimes: LlmRuntime[] = ['lmstudio'];
  updateNodeStatus(node.id, {
    reachable: true,
    runtimes,
    lmstudioBaseUrl: baseUrl,
    at: probedAt,
  });

  if (debug.enabled) {
    debug.log('llm.probe.lmstudio.ok', node.id, {
      models: models.length,
      loaded: models.filter((m) => m.loaded === true).length,
      endpoint: usedV0 ? 'v0' : 'v1',
      baseUrl,
      elapsedMs: probedAt - startedAt,
    });
  }

  return {
    nodeId: node.id,
    runtime: 'lmstudio',
    reachable: true,
    models,
    baseUrl,
    warnings,
    probedAt,
    elapsedMs: probedAt - startedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** LM Studio probe error taxonomy. Mirrors ollama/mlx — connection
 *  refused classifies as `daemon-down` (LM Studio app / Developer
 *  mode off) rather than `unreachable`, aligning with the HTTP probe
 *  family. SSH-level refused (port 22) also collapses here since the
 *  probe can't disambiguate between the two without parsing stderr
 *  in more detail; the warning is diagnostic enough. */
export function classifyProbeError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('timeout')) return 'ssh-timeout';
  if (m.includes('connection refused')) return 'daemon-down';
  if (
    m.includes('command not found')
    || m.includes('not found')
    || m.includes('no such file')
  ) {
    return 'cli-missing';
  }
  if (m.includes('unreachable') || m.includes('no route')) return 'unreachable';
  if (m.includes('permission denied')) return 'ssh-auth';
  // curl exit codes surfaced by runSpawn as "exited N" strings.
  // 7 = connection refused · 28 = timeout · 6 = DNS fail.
  if (m.includes('exited 7')) return 'daemon-down';
  if (m.includes('exited 28')) return 'ssh-timeout';
  if (m.includes('exited 6')) return 'unreachable';
  return 'probe-error';
}

function defaultLmstudioBaseUrl(node: { id: string; isLocal: boolean; sshHost?: string }): string {
  if (node.isLocal) return `http://localhost:${LMSTUDIO_DEFAULT_PORT}/v1`;
  const host = node.sshHost ?? node.id;
  return `http://${host}:${LMSTUDIO_DEFAULT_PORT}/v1`;
}

function extractModels(
  parsed: LmstudioModelsJson,
  nodeId: string,
  probedAt: number,
): LlmModel[] {
  const seen = new Set<string>();
  const out: LlmModel[] = [];
  const rows = parsed.data ?? [];
  for (const r of rows) {
    const id = (r.id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const label = id.includes('/') ? (id.split('/').pop() ?? id) : id;
    // The v0 endpoint enriches each row with state / capabilities /
    // context windows. The legacy /v1/models row only has id + object
    // + owned_by, so the optional fields stay undefined when v0 is
    // unavailable — downstream callers (wizard, routing) must treat
    // undefined as "unknown, fall back to defaults".
    const model: LlmModel = {
      id,
      nodeId,
      runtime: 'lmstudio',
      label,
      probedAt,
      ...(r.state !== undefined ? { loaded: r.state === 'loaded' } : {}),
      ...(typeof r.compatibility_type === 'string'
        ? { format: r.compatibility_type }
        : {}),
      ...(Array.isArray(r.capabilities) && r.capabilities.length > 0
        ? { capabilities: [...r.capabilities] }
        : {}),
      ...(typeof r.max_context_length === 'number' && r.max_context_length > 0
        ? { contextWindow: r.max_context_length }
        : {}),
      ...(typeof r.loaded_context_length === 'number' && r.loaded_context_length > 0
        ? { loadedContextWindow: r.loaded_context_length }
        : {}),
      ...(typeof r.arch === 'string' && r.arch.length > 0
        ? { arch: r.arch }
        : {}),
      ...(typeof r.quantization === 'string' && r.quantization.length > 0
        ? { quantization: r.quantization }
        : {}),
      ...(typeof r.publisher === 'string' && r.publisher.length > 0
        ? { publisher: r.publisher }
        : {}),
    };
    out.push(model);
  }
  return out;
}

// `failure(...)` helper retired 2026-05-05 with the v0/v1 fallback
// rewrite — the inline error branch now builds the LlmProbeResult
// directly so the missing-ssh-host short-circuit threads through the
// same updateNodeStatus path as connection-refused / timeout failures.

// ─── Default runners (prod) ────────────────────────────────────────
// Kept tiny · unit tests inject fakes via deps.

async function runLocalDefault(
  argv: readonly string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return runSpawn(argv[0]!, argv.slice(1), opts.timeoutMs);
}

async function runRemoteDefault(
  host: string,
  argv: readonly string[],
  opts: { timeoutMs: number; user?: string },
): Promise<{ stdout: string; stderr: string }> {
  const target = opts.user ? `${opts.user}@${host}` : host;
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(1, Math.floor(opts.timeoutMs / 1000 / 2))}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    target,
    ...argv,
  ];
  return runSpawn('ssh', sshArgs, opts.timeoutMs);
}

function runSpawn(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`probe timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `${bin} exited ${code} · stderr=${stderr.trim().slice(0, 200)}`,
        ));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
