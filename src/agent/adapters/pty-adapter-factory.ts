// H5 Phase 3 · Shared PTY adapter factory.
//
// codex-pty, claude-pty, gemini-pty all follow the same recipe:
//   1. supports() = brand ∈ brands, mode ∈ modes
//   2. launch()   = bindAgentToVW + wrap into EmbodiedAgentSession
//                   + optional observer attach (dispose chain wrapped)
//
// Factoring this out keeps each per-brand adapter to ~30 LOC of
// brand-specific config, and guarantees behaviour parity across
// brands — SnapshotPtyState, ListPtySnapshots, etc. all receive the
// same shape regardless of which binary a session is driving.
//
// Callers: `createCodexPtyAdapter`, `createClaudePtyAdapter`,
// `createGeminiPtyAdapter`. Tests live at
// `test/agent-pty-adapter-factory.test.ts`.

import type {
  AgentAdapter,
  AgentLaunchMode,
  AgentLaunchSpec,
  EmbodiedAgentSession,
  EmbodiedInterruptSignal,
  EmbodiedSessionStatus,
} from '../embodiment.js';
import { unregisterPty, type PtyHandle } from '../../pty-shell/registry.js';
import { bindAgentToVW, type BindAgentOpts } from '../pty-binding.js';
import { defaultChannelRouter } from '../channel-router.js';
import { attachObserver } from '../transport-observer.js';
import {
  registerSessionObserver,
  unregisterSessionObserver,
} from '../observer-registry.js';

const DEFAULT_MODES: readonly AgentLaunchMode[] = ['auto', 'pty-direct', 'hybrid'];

export interface PtyAdapterSpec {
  /** Adapter id e.g. `'codex-pty'` · also used as default transport label. */
  readonly id: string;
  /** Accepted `AgentLaunchSpec.brand` values. Case-sensitive. */
  readonly brands: readonly string[];
  /** Accepted `AgentLaunchSpec.mode` values · defaults to
   *  ['auto','pty-direct','hybrid'] to match existing codex-pty. */
  readonly modes?: readonly AgentLaunchMode[];
  /** Default executable · resolved on PATH or absolute. */
  readonly binary: string;
  /** Args prepended to `spec.extraArgs`. Default []. */
  readonly defaultArgs?: readonly string[];
  /** Transport label (shows up in `session.transports[0].label`) ·
   *  defaults to `id`. */
  readonly transportLabel?: string;
}

export interface CreatePtyAdapterOpts {
  /** Override binary · defaults to `spec.binary`. */
  readonly binary?: string;
  /** Extra args appended to spec-level defaults (before spec.extraArgs). */
  readonly defaultArgs?: readonly string[];
  /** Override adapter id · defaults to `spec.id`. */
  readonly id?: string;
  /** H5 P2 · auto-attach TransportObserver so SnapshotPtyState carries
   *  per-channel buffers. Default true · unit tests pass false to
   *  opt out of side-effect registration. */
  readonly observer?: boolean;
}

const SESSION_PREFIX = 'emb-';
let sessionSeq = 0;

/** Produce an AgentAdapter following the PTY recipe. Each per-brand
 *  factory (`createCodexPtyAdapter`, etc.) calls this with its spec.
 *  Observer attach is opt-in via `opts.observer` (default true). */
export function createPtyAdapterFromSpec(
  spec: PtyAdapterSpec,
  opts: CreatePtyAdapterOpts = {},
): AgentAdapter {
  const id = opts.id ?? spec.id;
  const binary = opts.binary ?? spec.binary;
  const mergedDefaults = [
    ...(spec.defaultArgs ?? []),
    ...(opts.defaultArgs ?? []),
  ];
  const modes = new Set(spec.modes ?? DEFAULT_MODES);
  const brands = new Set(spec.brands);
  const transportLabel = spec.transportLabel ?? id;
  const observerEnabled = opts.observer ?? true;

  const supports = (s: AgentLaunchSpec): boolean => {
    if (!brands.has(s.brand)) return false;
    const mode = s.mode ?? 'auto';
    return modes.has(mode);
  };

  const launch = async (s: AgentLaunchSpec): Promise<EmbodiedAgentSession> => {
    if (!supports(s)) {
      throw new Error(
        `${id} adapter does not support brand="${s.brand}" mode="${s.mode ?? 'auto'}"`,
      );
    }
    const bindOpts: BindAgentOpts = {
      binary,
      args: [...mergedDefaults, ...(s.extraArgs ?? [])],
      cwd: s.cwd,
      env: s.env ? { ...s.env } : undefined,
      paneId: s.paneId,
    };
    const bound = bindAgentToVW(bindOpts);
    const session = wrapPtySession(id, transportLabel, s, bound.ptyHandle);
    if (observerEnabled) {
      try {
        const { observer, dispose } = attachObserver(session, {
          router: defaultChannelRouter,
          adapterId: id,
        });
        // H6 P5 · expose per-session observer so AgentReply and other
        // delta consumers can diff buffer state without re-attaching.
        registerSessionObserver(session.id, observer);
        const prior = session.dispose.bind(session);
        (session as { dispose: () => Promise<void> }).dispose = async () => {
          try { dispose(); } catch { /* swallow observer cleanup errors */ }
          unregisterSessionObserver(session.id);
          await prior();
        };
      } catch {
        // Observer is advisory — if PTY transport is unavailable
        // (shouldn't happen in this codepath since bindAgentToVW
        // just ran), silently fall back to a bare session rather
        // than failing the launch.
      }
    }
    return session;
  };

  return { id, supports, launch };
}

// ─── Internal · PTY handle → EmbodiedAgentSession wrapper ────────────

function wrapPtySession(
  adapterId: string,
  transportLabel: string,
  spec: AgentLaunchSpec,
  handle: PtyHandle,
): EmbodiedAgentSession {
  const id = `${SESSION_PREFIX}${adapterId}-${++sessionSeq}-${handle.id}`;
  const transports = Object.freeze([
    Object.freeze({ kind: 'pty' as const, id: handle.id, label: transportLabel }),
  ]);
  const startedAt = Date.now();
  let disposed = false;

  const state = (): ReturnType<EmbodiedAgentSession['state']> => {
    const status = resolveStatus(handle, disposed);
    const result: ReturnType<EmbodiedAgentSession['state']> = {
      status,
      paneId: spec.paneId,
      title: `${spec.brand} [${adapterId}]`,
      startedAt,
    };
    if (handle.exitCode !== null) {
      result.finishedAt = Date.now();
    }
    return result;
  };

  const send = async (input: string): Promise<void> => {
    if (disposed) throw new Error('embodied session disposed');
    if (!handle.isAlive()) {
      throw new Error(`${adapterId} PTY has exited · cannot send input`);
    }
    handle.write(input);
  };

  const interrupt = async (signal?: EmbodiedInterruptSignal): Promise<void> => {
    if (disposed) return;
    handle.kill(mapSignal(signal));
  };

  const snapshot = async (): Promise<string> => {
    return handle.snapshot();
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (handle.isAlive()) {
      try {
        handle.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    unregisterPty(handle.id);
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

function resolveStatus(handle: PtyHandle, disposed: boolean): EmbodiedSessionStatus {
  if (disposed && !handle.isAlive()) return 'done';
  if (!handle.isAlive()) {
    const code = handle.exitCode;
    if (code !== null && code !== 0) return 'error';
    return 'done';
  }
  return 'running';
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

/** Test-only · reset the shared session sequence counter. Prevents
 *  cross-test id leakage when suites assert on exact session ids. */
export function _resetPtyAdapterSessionSeqForTesting(): void {
  sessionSeq = 0;
}
