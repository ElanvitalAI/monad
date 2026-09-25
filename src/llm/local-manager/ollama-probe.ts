// H6 P2 Bundle 2 C1 · Ollama probe.
//
// Mirrors `lmstudio-probe.ts` but hits the Ollama HTTP API
// (`GET :11434/api/tags`) instead of a CLI. Pre-infra check
// (2026-04-22) found that Ollama's CLI `--format json` flag is
// inconsistent across versions (`Error: unknown flag: --format`),
// while the HTTP API is stable and only depends on the daemon
// running (`ollama serve` — typically auto-started by LaunchAgent
// on macOS once the user has installed Ollama).
//
// Local probe    → `curl -sf --max-time <s> http://127.0.0.1:11434/api/tags`
// Remote probe   → `ssh <host> curl -sf --max-time <s> http://127.0.0.1:11434/api/tags`
//                  (Ollama binds to 127.0.0.1 by default, so the
//                  remote curl must run on the remote side — same
//                  pattern as Bundle 1 LM Studio probe.)
//
// Failure taxonomy additions:
//   - 'daemon-down' — connection refused (ollama serve not running)
//   - 'cli-missing' — curl not on the remote PATH (rare on macOS)
// Shared with lmstudio-probe: ssh-timeout · unreachable · ssh-auth ·
// parse-failed · no-models · probe-error.
//
// Design rails (PLAN §3.0.3 · D23):
//   - D23 HTTP API only · no CLI dependency · curl + ssh

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type { LlmModel, LlmProbeResult, LlmRuntime } from './types.js';
import { OLLAMA_DEFAULT_PORT, PROBE_TIMEOUT_MS } from './types.js';
import { updateNodeStatus } from './node-registry.js';

/** Subset of the `/api/tags` response shape we rely on · permissive
 *  so minor field changes in future Ollama versions don't break us. */
export interface OllamaListTagsJson {
  readonly models?: readonly Partial<{
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: Partial<{
      format: string;
      family: string;
      families: readonly string[];
      parameter_size: string;
      quantization_level: string;
    }>;
  }>[];
}

export interface OllamaProbeDeps {
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

/** Probe one node for Ollama inventory.
 *  - Updates the node-registry status cache as a side effect
 *    (reachable · ollamaBaseUrl · runtimes = ['ollama'] on success).
 *  - Returns a structured result even on failure so callers can
 *    aggregate without try/catch.
 *  - On success WITHOUT failing the node overall: if manager.ts
 *    runs lmstudio-probe + ollama-probe in parallel, the final
 *    aggregated runtimes/reachable are computed at the orchestrator
 *    level (see manager.refreshInventory). */
export async function probeOllama(
  node: { id: string; isLocal: boolean; sshHost?: string; sshUser?: string },
  deps: OllamaProbeDeps = {},
): Promise<LlmProbeResult> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const startedAt = now();
  const warnings: string[] = [];
  let stdout = '';

  // Use curl against the Ollama HTTP API. Ollama binds to 127.0.0.1
  // by default so we always reference localhost; for remote nodes
  // the curl runs on the remote side via SSH.
  const curlTimeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000 / 2));
  const curlArgv = [
    'curl',
    '-sf',
    '--max-time', String(curlTimeoutSec),
    `http://127.0.0.1:${OLLAMA_DEFAULT_PORT}/api/tags`,
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
    const warning = classifyOllamaProbeError(msg);
    warnings.push(warning);
    if (debug.enabled) {
      debug.log('llm.probe.ollama.failed', node.id, { warning, message: msg }, { level: 'error' });
    }
    const probedAt = now();
    // Write failure state for Ollama-specific slice · manager.ts will
    // aggregate with the lmstudio-probe result before the refresh ends.
    updateNodeStatus(node.id, { reachable: false, runtimes: [], at: probedAt });
    return {
      nodeId: node.id,
      runtime: 'ollama',
      reachable: false,
      models: [],
      warnings,
      probedAt,
      elapsedMs: probedAt - startedAt,
    };
  }

  // Parse JSON · be permissive about shape variants.
  let parsed: OllamaListTagsJson | null = null;
  try {
    parsed = JSON.parse(stdout) as OllamaListTagsJson;
  } catch {
    warnings.push('parse-failed');
  }

  const probedAt = now();
  const baseUrl = defaultOllamaBaseUrl(node);
  const models: LlmModel[] = parsed
    ? extractModels(parsed, node.id, probedAt)
    : [];
  if (parsed && models.length === 0) warnings.push('no-models');

  const runtimes: LlmRuntime[] = ['ollama'];
  updateNodeStatus(node.id, {
    reachable: true,
    runtimes,
    ollamaBaseUrl: baseUrl,
    at: probedAt,
  });

  if (debug.enabled) {
    debug.log('llm.probe.ollama.ok', node.id, {
      models: models.length,
      baseUrl,
      elapsedMs: probedAt - startedAt,
    });
  }

  return {
    nodeId: node.id,
    runtime: 'ollama',
    reachable: true,
    models,
    baseUrl,
    warnings,
    probedAt,
    elapsedMs: probedAt - startedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Ollama-specific variant of classifyProbeError. Adds `daemon-down`
 *  for the common "connection refused" case (daemon not running) and
 *  falls through to the shared taxonomy used by lmstudio-probe. */
export function classifyOllamaProbeError(msg: string): string {
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
  // Curl exit codes surfaced by runSpawn as "exited N" strings.
  // 7 = connection refused · 28 = timeout · 6 = DNS fail.
  if (m.includes('exited 7')) return 'daemon-down';
  if (m.includes('exited 28')) return 'ssh-timeout';
  if (m.includes('exited 6')) return 'unreachable';
  return 'probe-error';
}

function defaultOllamaBaseUrl(node: { id: string; isLocal: boolean; sshHost?: string }): string {
  if (node.isLocal) return `http://localhost:${OLLAMA_DEFAULT_PORT}/v1`;
  const host = node.sshHost ?? node.id;
  return `http://${host}:${OLLAMA_DEFAULT_PORT}/v1`;
}

function extractModels(
  parsed: OllamaListTagsJson,
  nodeId: string,
  probedAt: number,
): LlmModel[] {
  const seen = new Set<string>();
  const out: LlmModel[] = [];
  const rows = parsed.models ?? [];
  for (const r of rows) {
    const id = (r.name ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const label = id;
    const format = r.details?.format;
    const model: LlmModel = {
      id,
      nodeId,
      runtime: 'ollama',
      label,
      ...(typeof r.size === 'number' ? { sizeBytes: r.size } : {}),
      ...(format ? { format } : {}),
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
    runtime: 'ollama',
    reachable: false,
    models: [],
    warnings: [...warnings],
    probedAt,
    elapsedMs,
  };
}

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
