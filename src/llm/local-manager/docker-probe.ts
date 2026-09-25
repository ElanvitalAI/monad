// H6 P2 Bundle 2 C3 · Docker probe.
//
// Detects LLM-serving containers on a node via `docker ps --format
// '{{json .}}'` + image-name filter (D29). Unlike the HTTP probes
// (lmstudio / ollama / mlx) this is a CLI-based probe because
// container discovery is fundamentally a Docker-daemon operation —
// there is no stable HTTP "list containers" endpoint without talking
// to the daemon socket directly.
//
// Local probe  → `docker ps --format '{{json .}}'`
// Remote probe → `ssh <host> docker ps --format '{{json .}}'`
//
// Filter + port extraction:
//   - Each stdout line is one container as JSON.
//   - Image name must match /ollama|vllm|tgi|text-generation-inference|llama/i
//     (case-insensitive). Label-based `--filter label=llm` was rejected
//     because public LLM images ship without standard labels.
//   - `Ports` field like `"0.0.0.0:11434->11434/tcp"` — first
//     matching host port becomes the baseUrl port. No match → skip.
//
// v1 surfaces at most ONE matched container per node as the node's
// `dockerBaseUrl` (the first line in ps output). Multi-LLM-container
// nodes are a Bundle 3 concern (D32) — the current manager shape
// allows only one baseUrl per (node × runtime).
//
// Failure taxonomy:
//   - 'daemon-down'   — "Cannot connect to the Docker daemon"
//   - 'cli-missing'   — docker binary not on PATH
//   - 'parse-failed'  — JSON line malformed
//   - 'no-models'     — daemon up but no LLM-image container running
//   - shared: 'ssh-timeout' / 'unreachable' / 'ssh-auth' / 'probe-error'
//
// Design rails (PLAN §3.0.5 · D29 · D30 · D31):
//   - D29 running containers + image name filter + port mapping
//   - D30 embodied 제외 · Bundle 3 HTTP SSE wrapper 와 함께
//   - D31 quad-probe cost 수용 · per-node wall-clock 영향 최소

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type { LlmModel, LlmProbeResult, LlmRuntime } from './types.js';
import { PROBE_TIMEOUT_MS } from './types.js';
import { updateNodeStatus } from './node-registry.js';

/** Subset of `docker ps --format '{{json .}}'` fields we care about.
 *  Docker ships many more — we stay permissive so minor Docker CLI
 *  changes don't break the probe. */
export interface DockerPsJson {
  readonly ID?: string;
  readonly Names?: string;
  readonly Image?: string;
  readonly Ports?: string;
  readonly State?: string;
  readonly Status?: string;
}

export interface DockerProbeDeps {
  readonly runLocal?: (
    argv: readonly string[],
    opts: { timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly runRemote?: (
    host: string,
    argv: readonly string[],
    opts: { timeoutMs: number; user?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Regex for LLM-image detection. Matches the common public images
 *  users run for model serving. Case-insensitive. Additions go in
 *  this single place — the rest of the probe uses this predicate. */
const LLM_IMAGE_PATTERN = /ollama|vllm|tgi|text-generation-inference|llama/i;

/** Probe one node for Docker-hosted LLM containers.
 *  - Updates the node-registry status cache as a side effect
 *    (reachable · dockerBaseUrl · runtimes = ['docker'] on success
 *    AND at least one LLM container found).
 *  - Returns reachable=true even with zero containers when the daemon
 *    is up · surfaces a `no-models` warning. This mirrors Ollama's
 *    behavior (daemon up but empty library). */
export async function probeDocker(
  node: { id: string; isLocal: boolean; sshHost?: string; sshUser?: string },
  deps: DockerProbeDeps = {},
): Promise<LlmProbeResult> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const startedAt = now();
  const warnings: string[] = [];
  let stdout = '';

  const dockerArgv = ['docker', 'ps', '--format', '{{json .}}'];

  try {
    if (node.isLocal) {
      const runner = deps.runLocal ?? runLocalDefault;
      const r = await runner(dockerArgv, { timeoutMs });
      stdout = r.stdout;
    } else {
      if (!node.sshHost) {
        return failure(node.id, now(), now() - startedAt, ['missing-ssh-host']);
      }
      const runner = deps.runRemote ?? runRemoteDefault;
      const r = await runner(
        node.sshHost,
        dockerArgv,
        { timeoutMs, ...(node.sshUser ? { user: node.sshUser } : {}) },
      );
      stdout = r.stdout;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = classifyDockerProbeError(msg);
    warnings.push(warning);
    if (debug.enabled) {
      debug.log('llm.probe.docker.failed', node.id, { warning, message: msg }, { level: 'error' });
    }
    const probedAt = now();
    updateNodeStatus(node.id, { reachable: false, runtimes: [], at: probedAt });
    return {
      nodeId: node.id,
      runtime: 'docker',
      reachable: false,
      models: [],
      warnings,
      probedAt,
      elapsedMs: probedAt - startedAt,
    };
  }

  // Parse one JSON object per non-empty line · permissive.
  const { containers, parseFailed } = parseDockerPsLines(stdout);
  if (parseFailed) warnings.push('parse-failed');

  // Filter by image name · keep only LLM-serving containers.
  const llmContainers = containers.filter(
    (c) => c.Image && LLM_IMAGE_PATTERN.test(c.Image),
  );

  const probedAt = now();
  const models: LlmModel[] = [];
  for (const c of llmContainers) {
    const model = buildModelEntry(c, node.id, probedAt);
    if (model) models.push(model);
  }
  if (models.length === 0) warnings.push('no-models');

  // v1 · single baseUrl per node. Pick the first matched container
  // with a parseable host port (D32). Node is reachable even if no
  // LLM container exists — the daemon responded.
  const baseUrl = pickBaseUrl(llmContainers, node);
  const runtimes: LlmRuntime[] = ['docker'];
  updateNodeStatus(node.id, {
    reachable: true,
    runtimes,
    ...(baseUrl ? { dockerBaseUrl: baseUrl } : {}),
    at: probedAt,
  });

  if (debug.enabled) {
    debug.log('llm.probe.docker.ok', node.id, {
      containers: containers.length,
      llmContainers: llmContainers.length,
      models: models.length,
      baseUrl: baseUrl ?? '(none)',
      elapsedMs: probedAt - startedAt,
    });
  }

  return {
    nodeId: node.id,
    runtime: 'docker',
    reachable: true,
    models,
    ...(baseUrl ? { baseUrl } : {}),
    warnings,
    probedAt,
    elapsedMs: probedAt - startedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Docker-specific variant of classifyProbeError. Adds `daemon-down`
 *  for "Cannot connect to the Docker daemon" which is how the CLI
 *  reports a stopped daemon (OrbStack / Docker Desktop not running). */
export function classifyDockerProbeError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('cannot connect to the docker daemon')) return 'daemon-down';
  if (m.includes('is the docker daemon running')) return 'daemon-down';
  if (m.includes('timeout')) return 'ssh-timeout';
  if (m.includes('connection refused')) return 'daemon-down';
  if (
    m.includes('command not found')
    || m.includes('not found')
    || m.includes('no such file')
    || m.includes('enoent')
  ) {
    return 'cli-missing';
  }
  if (m.includes('unreachable') || m.includes('no route')) {
    return 'unreachable';
  }
  if (m.includes('permission denied')) return 'ssh-auth';
  if (m.includes('exited 28')) return 'ssh-timeout';
  return 'probe-error';
}

/** Split docker ps JSON stream into objects · tolerant of blank
 *  lines and of a single malformed line (returns `parseFailed: true`
 *  but keeps the parseable containers). */
export function parseDockerPsLines(stdout: string): {
  containers: DockerPsJson[];
  parseFailed: boolean;
} {
  const out: DockerPsJson[] = [];
  let parseFailed = false;
  const lines = stdout.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as DockerPsJson);
    } catch {
      parseFailed = true;
    }
  }
  return { containers: out, parseFailed };
}

/** Extract the host port from a Docker "Ports" string like
 *  `"0.0.0.0:11434->11434/tcp, :::11434->11434/tcp"`. Returns the
 *  first numeric host port observed or `null` when none parses.
 *  Ignores IPv6 `[::]:port->` forms to keep URL composition simple. */
export function extractHostPort(portsField: string | undefined): number | null {
  if (!portsField) return null;
  // Match `<host>:<port>->` where host is an IPv4 (optionally 0.0.0.0).
  // Skip bare `->internal/tcp` entries (no host publish).
  const re = /(?:^|,\s*)(?:\d{1,3}(?:\.\d{1,3}){3})?:(\d+)->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(portsField)) !== null) {
    const port = Number(m[1]);
    if (Number.isFinite(port) && port > 0 && port < 65536) return port;
  }
  return null;
}

function buildModelEntry(
  c: DockerPsJson,
  nodeId: string,
  probedAt: number,
): LlmModel | null {
  const image = c.Image ?? '';
  const name = c.Names ?? '';
  if (!image) return null;
  // Model id = `<image-basename>@<container-name>` so the same
  // container always maps to the same id across probes. Fall back
  // to the raw image string when no container name is present.
  const imageBase = image.split('/').pop() ?? image;
  const id = name ? `${imageBase}@${name}` : imageBase;
  return {
    id,
    nodeId,
    runtime: 'docker',
    label: id,
    format: 'docker',
    probedAt,
  };
}

function pickBaseUrl(
  containers: readonly DockerPsJson[],
  node: { isLocal: boolean; sshHost?: string; id: string },
): string | null {
  for (const c of containers) {
    const port = extractHostPort(c.Ports);
    if (port) {
      const host = node.isLocal ? 'localhost' : (node.sshHost ?? node.id);
      return `http://${host}:${port}/v1`;
    }
  }
  return null;
}

function failure(
  nodeId: string,
  probedAt: number,
  elapsedMs: number,
  warnings: readonly string[],
): LlmProbeResult {
  return {
    nodeId,
    runtime: 'docker',
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
  // Shell-quote every argv element before handing to ssh. Rationale:
  // `ssh host arg1 arg2` serializes the argv into one command string
  // for the remote shell (joined by spaces), which then re-parses it.
  // For the Docker probe specifically, `--format '{{json .}}'` contains
  // braces that a remote zsh interprets as brace expansion (`zsh:1:
  // parse error near '}'`). Single-quoting each argv item on the
  // client side preserves them literally across the ssh hop — zsh/bash
  // both treat characters inside `'...'` as literal. Ollama / MLX /
  // LM Studio probes don't need this (their argv is alphanumeric +
  // `-` + `:` + `/` only) but applying here stays defensive.
  const remoteCmd = argv.map(shellSingleQuote).join(' ');
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(1, Math.floor(opts.timeoutMs / 1000 / 2))}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    target,
    remoteCmd,
  ];
  return runSpawn('ssh', sshArgs, opts.timeoutMs);
}

/** POSIX single-quote a shell arg · safe across bash/zsh/sh.
 *  Doubles single quotes as `'\''` (close, escape literal, reopen). */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
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
