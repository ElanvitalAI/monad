// H6 P2 Bundle 2 C2 · MLX probe.
//
// Mirrors `ollama-probe.ts` but hits the `mlx_lm.server`
// OpenAI-compatible endpoint (`GET :8080/v1/models`) instead of the
// Ollama-native `/api/tags`. Pre-infra check (2026-04-22) confirmed
// MLX has no `list`-style CLI — only one-shot `mlx_lm.generate` and
// the HTTP server — so the HTTP API is the only stable inventory
// surface (D27).
//
// Local probe  → `curl -sf --max-time <s> http://127.0.0.1:8080/v1/models`
// Remote probe → `ssh <host> curl -sf --max-time <s> http://127.0.0.1:8080/v1/models`
//
// Unlike Ollama, MLX does NOT auto-start a daemon — the user must
// launch `mlx_lm.server --model <path>` manually (or via LaunchAgent)
// before the probe can detect anything. A refused connection is the
// expected state on most nodes; classified as `daemon-down` so the
// surface stays quiet (warnings are truncated to 6 per inventory).
//
// Failure taxonomy (shared with ollama-probe):
//   - 'daemon-down'   — connection refused (server not running)
//   - 'cli-missing'   — curl not on PATH (rare on macOS)
//   - 'parse-failed'  — JSON shape unexpected
//   - 'no-models'     — server up but no models loaded
//   - 'ssh-timeout' / 'unreachable' / 'ssh-auth' / 'probe-error'
//
// Design rails (PLAN §3.0.5 · D27):
//   - D27 HTTP API only · no CLI dependency · curl + ssh
//   - D32 MLX_DEFAULT_PORT = 8080

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type { LlmModel, LlmProbeResult, LlmRuntime } from './types.js';
import { MLX_DEFAULT_PORT, PROBE_TIMEOUT_MS } from './types.js';
import { updateNodeStatus } from './node-registry.js';

/** Subset of the `/v1/models` OpenAI-compat response we rely on.
 *  `mlx_lm.server` returns `{ object: 'list', data: [{ id, object,
 *  created, owned_by, ... }] }`. We only need `data[].id`. */
export interface MlxModelsJson {
  readonly object?: string;
  readonly data?: readonly Partial<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>[];
}

export interface MlxProbeDeps {
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

/** Probe one node for MLX inventory.
 *  - Updates the node-registry status cache as a side effect
 *    (reachable · mlxBaseUrl · runtimes = ['mlx'] on success).
 *  - Returns a structured result even on failure so callers can
 *    aggregate without try/catch.
 *  - Final aggregated runtimes/reachable are computed at the
 *    orchestrator level (see manager.refreshInventory). */
export async function probeMlx(
  node: { id: string; isLocal: boolean; sshHost?: string; sshUser?: string },
  deps: MlxProbeDeps = {},
): Promise<LlmProbeResult> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const startedAt = now();
  const warnings: string[] = [];
  let stdout = '';

  // Use curl against the MLX OpenAI-compat endpoint. mlx_lm.server
  // binds to 127.0.0.1 by default so remote probes run curl over SSH.
  const curlTimeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000 / 2));
  const curlArgv = [
    'curl',
    '-sf',
    '--max-time', String(curlTimeoutSec),
    `http://127.0.0.1:${MLX_DEFAULT_PORT}/v1/models`,
  ];

  try {
    if (node.isLocal) {
      const runner = deps.runLocal ?? runLocalDefault;
      const r = await runner(curlArgv, { timeoutMs });
      stdout = r.stdout;
    } else {
      if (!node.sshHost) {
        return failure(node.id, now(), now() - startedAt, ['missing-ssh-host']);
      }
      const runner = deps.runRemote ?? runRemoteDefault;
      const r = await runner(
        node.sshHost,
        curlArgv,
        { timeoutMs, ...(node.sshUser ? { user: node.sshUser } : {}) },
      );
      stdout = r.stdout;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = classifyMlxProbeError(msg);
    warnings.push(warning);
    if (debug.enabled) {
      debug.log('llm.probe.mlx.failed', node.id, { warning, message: msg }, { level: 'error' });
    }
    const probedAt = now();
    updateNodeStatus(node.id, { reachable: false, runtimes: [], at: probedAt });
    return {
      nodeId: node.id,
      runtime: 'mlx',
      reachable: false,
      models: [],
      warnings,
      probedAt,
      elapsedMs: probedAt - startedAt,
    };
  }

  // Parse JSON · OpenAI-compat list response.
  let parsed: MlxModelsJson | null = null;
  try {
    parsed = JSON.parse(stdout) as MlxModelsJson;
  } catch {
    warnings.push('parse-failed');
  }

  const probedAt = now();
  const baseUrl = defaultMlxBaseUrl(node);
  const models: LlmModel[] = parsed
    ? extractModels(parsed, node.id, probedAt)
    : [];
  if (parsed && models.length === 0) warnings.push('no-models');

  const runtimes: LlmRuntime[] = ['mlx'];
  updateNodeStatus(node.id, {
    reachable: true,
    runtimes,
    mlxBaseUrl: baseUrl,
    at: probedAt,
  });

  if (debug.enabled) {
    debug.log('llm.probe.mlx.ok', node.id, {
      models: models.length,
      baseUrl,
      elapsedMs: probedAt - startedAt,
    });
  }

  return {
    nodeId: node.id,
    runtime: 'mlx',
    reachable: true,
    models,
    baseUrl,
    warnings,
    probedAt,
    elapsedMs: probedAt - startedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** MLX-specific variant of classifyProbeError. Shares `daemon-down`
 *  with Ollama (connection refused = server not launched). MLX has no
 *  LaunchAgent auto-start, so `daemon-down` is the common case on
 *  nodes where the user hasn't started `mlx_lm.server`. */
export function classifyMlxProbeError(msg: string): string {
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
  if (m.includes('unreachable') || m.includes('no route')) {
    return 'unreachable';
  }
  if (m.includes('permission denied')) return 'ssh-auth';
  if (m.includes('exited 7')) return 'daemon-down';
  if (m.includes('exited 28')) return 'ssh-timeout';
  if (m.includes('exited 6')) return 'unreachable';
  return 'probe-error';
}

function defaultMlxBaseUrl(node: { id: string; isLocal: boolean; sshHost?: string }): string {
  if (node.isLocal) return `http://localhost:${MLX_DEFAULT_PORT}/v1`;
  const host = node.sshHost ?? node.id;
  return `http://${host}:${MLX_DEFAULT_PORT}/v1`;
}

function extractModels(
  parsed: MlxModelsJson,
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
    const model: LlmModel = {
      id,
      nodeId,
      runtime: 'mlx',
      label: id,
      format: 'mlx',
      probedAt,
    };
    out.push(model);
  }
  return out;
}

function failure(
  nodeId: string,
  probedAt: number,
  elapsedMs: number,
  warnings: readonly string[],
): LlmProbeResult {
  return {
    nodeId,
    runtime: 'mlx',
    reachable: false,
    models: [],
    warnings: [...warnings],
    probedAt,
    elapsedMs,
  };
}

// ─── Default runners (prod) ────────────────────────────────────────

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
