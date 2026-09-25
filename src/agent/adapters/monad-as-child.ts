// H5 Phase 3 · monad-as-child adapter.
//
// Wraps another monad instance (spawned with `--acp-server`) as an
// `EmbodiedAgentSession` whose only transport is `kind:'acp'`. This
// enables "monad calling monad" — a parent agent delegates a task to
// a sub-monad which itself can route to codex/claude/gemini/etc.
//
// Recursion is capped via an env-configurable depth limit (default 3)
// propagated through the `MONAD_AGENT_DEPTH` env var. Each child bumps
// the counter; `launch()` refuses when the cap would be exceeded.
//
// Unlike codex/claude/gemini PTY adapters, this one does NOT use the
// `pty-adapter-factory` · it spawns via `child_process.spawn` with
// stdio pipes so the ACP JSON-RPC stream flows through stdin/stdout
// directly. The sub-monad's own dashboard doesn't render (because
// `--acp-server` bypasses the UI path · see `src/index.ts` L2439).
//
// Design ref: `내부 문서 `PLAN-h5-embodied-agent-bus-phase-3`` §4.3.

import { spawn, type ChildProcess } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type {
  AgentAdapter,
  AgentLaunchSpec,
  EmbodiedAgentSession,
  EmbodiedInterruptSignal,
  EmbodiedSessionStatus,
} from '../embodiment.js';

export const MONAD_AGENT_DEPTH_ENV = 'MONAD_AGENT_DEPTH';
export const MONAD_AGENT_DEPTH_CAP_ENV = 'MONAD_AGENT_DEPTH_CAP';
const DEFAULT_DEPTH_CAP = 3;

export interface MonadAsChildAdapterOpts {
  /** Path or name of the monad binary. Default `'monad'`. */
  readonly monadBinary?: string;
  /** Extra args passed after `--acp-server`. Rarely needed —
   *  sub-monad inherits the parent's cwd/env already. */
  readonly extraArgs?: readonly string[];
  /** Adapter id · default `'monad-as-child'`. */
  readonly id?: string;
  /** Depth cap override. `MONAD_AGENT_DEPTH_CAP` env still wins
   *  when set; this is only the hard-coded default. */
  readonly depthCap?: number;
  /** Test seam — inject a synthetic process spawner so unit tests
   *  don't fork actual monad processes. Receives the full argv and
   *  should return a duck-typed ChildProcess (pid, kill, on('exit'),
   *  stdio pipes are OK to be null). */
  readonly _spawnFactory?: (
    bin: string,
    args: readonly string[],
    opts: { env: Record<string, string>; cwd?: string },
  ) => ChildProcess;
}

const BRANDS = new Set(['monad', 'monad-child']);
const MODES = new Set(['auto', 'acp', 'hybrid']);

export function createMonadAsChildAdapter(
  opts: MonadAsChildAdapterOpts = {},
): AgentAdapter {
  const id = opts.id ?? 'monad-as-child';
  const binary = opts.monadBinary ?? 'monad';
  const extraArgs = opts.extraArgs ? [...opts.extraArgs] : [];
  const defaultCap = opts.depthCap ?? DEFAULT_DEPTH_CAP;
  const spawnFn = opts._spawnFactory ?? spawn;

  const supports = (spec: AgentLaunchSpec): boolean => {
    if (!BRANDS.has(spec.brand)) return false;
    const mode = spec.mode ?? 'auto';
    return MODES.has(mode);
  };

  const launch = async (spec: AgentLaunchSpec): Promise<EmbodiedAgentSession> => {
    if (!supports(spec)) {
      throw new Error(
        `${id} adapter does not support brand="${spec.brand}" mode="${spec.mode ?? 'auto'}"`,
      );
    }
    const currentDepth = readDepth(spec.env);
    const cap = readDepthCap(spec.env, defaultCap);
    if (currentDepth + 1 > cap) {
      throw new Error(
        `${id} · recursion depth cap reached (current=${currentDepth} cap=${cap}) · refusing to spawn sub-monad`,
      );
    }
    const childEnv = buildChildEnv(spec.env, currentDepth + 1, cap);
    const argv = ['--acp-server', ...extraArgs, ...(spec.extraArgs ?? [])];
    const child = spawnFn(binary, argv, {
      env: childEnv,
      ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
    });
    debug.log(
      'agent.monadAsChild.launch',
      `bin=${binary} depth=${currentDepth + 1}/${cap} pid=${child.pid ?? '(unknown)'}`,
    );
    return wrapMonadChildSession(id, spec, child);
  };

  return { id, supports, launch };
}

// ─── Depth tracking ───────────────────────────────────────────────

function readDepth(env: Readonly<Record<string, string>> | undefined): number {
  const raw = env?.[MONAD_AGENT_DEPTH_ENV] ?? process.env[MONAD_AGENT_DEPTH_ENV];
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readDepthCap(
  env: Readonly<Record<string, string>> | undefined,
  fallback: number,
): number {
  const raw = env?.[MONAD_AGENT_DEPTH_CAP_ENV] ?? process.env[MONAD_AGENT_DEPTH_CAP_ENV];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildChildEnv(
  specEnv: Readonly<Record<string, string>> | undefined,
  nextDepth: number,
  cap: number,
): Record<string, string> {
  const env: Record<string, string> = {};
  // Inherit process env first so sub-monad sees PATH, HOME, etc.
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  // Spec-level env overrides win next
  if (specEnv) {
    for (const [k, v] of Object.entries(specEnv)) env[k] = v;
  }
  // Depth tracking · always clobber regardless of inherited value
  env[MONAD_AGENT_DEPTH_ENV] = String(nextDepth);
  env[MONAD_AGENT_DEPTH_CAP_ENV] = String(cap);
  return env;
}

// ─── Session wrapper ──────────────────────────────────────────────

const SESSION_PREFIX = 'emb-';
let sessionSeq = 0;

function wrapMonadChildSession(
  adapterId: string,
  spec: AgentLaunchSpec,
  child: ChildProcess,
): EmbodiedAgentSession {
  const id = `${SESSION_PREFIX}${adapterId}-${++sessionSeq}-${child.pid ?? 'nopid'}`;
  const transportId = `acp-${child.pid ?? 'nopid'}`;
  const transports = Object.freeze([
    Object.freeze({ kind: 'acp' as const, id: transportId, label: adapterId }),
  ]);
  const startedAt = Date.now();
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let disposed = false;

  child.on('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  const state = (): ReturnType<EmbodiedAgentSession['state']> => {
    const status: EmbodiedSessionStatus =
      disposed
        ? 'done'
        : exitCode === null && exitSignal === null
          ? 'running'
          : exitCode === 0
            ? 'done'
            : 'error';
    const result: ReturnType<EmbodiedAgentSession['state']> = {
      status,
      ...(spec.paneId !== undefined ? { paneId: spec.paneId } : {}),
      title: `${spec.brand} [${adapterId}]`,
      startedAt,
    };
    if (exitCode !== null || exitSignal !== null) {
      result.finishedAt = Date.now();
    }
    return result;
  };

  const send = async (input: string): Promise<void> => {
    if (disposed) throw new Error('embodied session disposed');
    if (!child.stdin || child.stdin.destroyed) {
      throw new Error('sub-monad stdin unavailable · cannot send input');
    }
    child.stdin.write(input.endsWith('\n') ? input : input + '\n');
  };

  const interrupt = async (signal?: EmbodiedInterruptSignal): Promise<void> => {
    if (disposed) return;
    const sig = mapSignal(signal);
    try {
      child.kill(sig);
    } catch {
      /* best effort */
    }
  };

  const snapshot = async (): Promise<string> => {
    // Sub-monad in ACP-server mode doesn't render a terminal UI · the
    // best "snapshot" we can provide is a structured one-liner with
    // runtime info. Handoff context should come from the ACP transport
    // layer (future · via transport-observer once ACP events are wired).
    const st = state();
    return `[${adapterId}] pid=${child.pid ?? '?'} status=${st.status} exit=${exitCode ?? '-'}`;
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      if (!child.killed) child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Close stdin so the child sees an EOF and exits cleanly if it's
    // still reading. Wrapped in try because stdin may already be null
    // or destroyed when spawn used stdio:'ignore'.
    try { child.stdin?.end(); } catch { /* ignore */ }
  };

  return {
    id,
    launchSpec: spec,
    transports,
    state,
    send,
    interrupt,
    snapshot,
    dispose,
  };
}

function mapSignal(signal?: EmbodiedInterruptSignal): NodeJS.Signals {
  switch (signal) {
    case 'kill':
      return 'SIGKILL';
    case 'terminate':
      return 'SIGTERM';
    case 'ctrl_c':
    default:
      return 'SIGINT';
  }
}

/** Convenience · register the adapter on the default registry. */
export function registerDefaultMonadAsChildAdapter(
  registry: import('../adapter-registry.js').AdapterRegistry,
  opts?: MonadAsChildAdapterOpts,
): () => void {
  return registry.register(createMonadAsChildAdapter(opts));
}

/** Test-only · reset the module-level session sequence counter. */
export function _resetMonadAsChildSessionSeqForTesting(): void {
  sessionSeq = 0;
}
