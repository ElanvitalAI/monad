// NEXUS · supervisor spawn primitive (Phase N-2 PR ε)
//
// Headless child-process wrapper used by daemon / pwa-host / channel-bot
// kinds (PR ζ/η/θ). Mirrors the pluggable-backend pattern of MiniTerminal:
// the production backend is `bunSpawnBackend` (uses `Bun.spawn`) and tests
// inject `makeTestSpawnBackend()` so the spawn pipeline can be exercised
// without forking real subprocesses.
//
// Responsibilities:
//   1. Inject `spec.spawn.env` over process.env when launching children
//   2. Pipe stdout/stderr to `~/.monad/nexus/logs/<id>/{stdout,stderr}.log`
//      (per HANDOFF D-2 · 10MB rotate is deferred to PR ε.+ since the
//      Bun stream API doesn't expose rotation primitives — a follow-up
//      task tracked in BACKLOG)
//   3. Match each stderr line against `restart.haltPatterns` regexes and
//      surface the first hit via `onHaltMatch` so the restart layer can
//      short-circuit before scheduling a backoff
//   4. Forward exit info via `onExit` callback
//
// Sibling pattern: this module does not import `Bun.spawn` types from the
// global ambient — we declare the narrow contract we need so the test
// backend can satisfy it without pulling Bun into the type graph.

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { debug } from '../../debug/log.js';

export interface SupervisorSpawnOpts {
  /** Argv. command[0] is the executable. */
  command: string[];
  cwd?: string;
  /** Merged with process.env at spawn time. */
  env?: Record<string, string>;
  /** Absolute path; parent dir is created (recursive) if missing. */
  stdoutPath?: string;
  stderrPath?: string;
  /** Regex sources tested against each stderr line. First match fires
   *  `onHaltMatch(pattern, line)` exactly once per child lifetime. */
  haltPatterns?: string[];
  onHaltMatch?: (pattern: string, line: string) => void;
  /** IPC handler (Bun.spawn `ipc:` option). channel-bot uses this. */
  ipc?: (message: unknown) => void;
}

export interface SupervisorExitInfo {
  exitCode: number;
  signal?: NodeJS.Signals;
}

/** Narrow contract — one child-process handle from any backend. */
export interface SupervisorChild {
  readonly pid: number;
  kill(signal?: NodeJS.Signals): void;
  onExit(cb: (info: SupervisorExitInfo) => void): () => void;
  /** Best-effort cleanup of stream handles + listeners. Idempotent. */
  dispose(): void;
}

export interface SupervisorSpawnBackend {
  spawn(opts: SupervisorSpawnOpts): SupervisorChild;
}

// ---------------------------------------------------------------------------
// Default backend — Bun.spawn
// ---------------------------------------------------------------------------

interface BunSpawnLike {
  spawn(opts: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdout: 'pipe' | 'ignore' | 'inherit';
    stderr: 'pipe' | 'ignore' | 'inherit';
    stdin: 'pipe' | 'ignore' | 'inherit';
    ipc?: (msg: unknown) => void;
  }): {
    pid: number;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    exited: Promise<number>;
    signalCode: NodeJS.Signals | null;
    kill(sig?: NodeJS.Signals | number): void;
  };
}

declare const Bun: BunSpawnLike;

function ensureDirOf(filePath: string): void {
  try { mkdirSync(dirname(filePath), { recursive: true }); } catch { /* best-effort */ }
}

function streamLinesToFile(
  stream: ReadableStream<Uint8Array> | null,
  filePath: string | undefined,
  onLine: ((line: string) => void) | undefined,
): WriteStream | undefined {
  if (!stream) return undefined;
  let writer: WriteStream | undefined;
  if (filePath) {
    ensureDirOf(filePath);
    writer = createWriteStream(filePath, { flags: 'a' });
  }
  let pending = '';
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (writer) writer.write(chunk);
        if (onLine) {
          pending += chunk;
          let nl = pending.indexOf('\n');
          while (nl >= 0) {
            const line = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            if (line.length > 0) onLine(line);
            nl = pending.indexOf('\n');
          }
        }
      }
      if (onLine && pending.length > 0) onLine(pending);
    } catch {
      /* stream errors swallowed — exit will surface the real failure */
    } finally {
      try { writer?.end(); } catch { /* ignore */ }
    }
  })();
  return writer;
}

export function createBunSpawnBackend(): SupervisorSpawnBackend {
  return {
    spawn(opts) {
      const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>;
      const child = Bun.spawn({
        cmd: opts.command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        ...(opts.ipc ? { ipc: opts.ipc } : {}),
      });

      let halted = false;
      const stderrCheck = (line: string): void => {
        if (halted || !opts.haltPatterns?.length || !opts.onHaltMatch) return;
        for (const pat of opts.haltPatterns) {
          try {
            if (new RegExp(pat).test(line)) {
              halted = true;
              opts.onHaltMatch(pat, line);
              return;
            }
          } catch { /* invalid regex — skip */ }
        }
      };

      const stdoutWriter = streamLinesToFile(child.stdout, opts.stdoutPath, undefined);
      const stderrWriter = streamLinesToFile(child.stderr, opts.stderrPath, stderrCheck);

      const exitListeners = new Set<(info: SupervisorExitInfo) => void>();
      let exited = false;
      let exitInfo: SupervisorExitInfo | null = null;
      void child.exited.then((code) => {
        exited = true;
        const info: SupervisorExitInfo = (() => {
          if (child.signalCode) return { exitCode: code, signal: child.signalCode };
          return { exitCode: code };
        })();
        exitInfo = info;
        for (const cb of exitListeners) {
          try { cb(info); } catch { /* swallow */ }
        }
      });

      if (debug.enabled) {
        debug.log('nexus.supervisor.spawn', String(child.pid), {
          cmd: opts.command[0],
          argc: opts.command.length,
          cwd: opts.cwd ?? process.cwd(),
        });
      }

      return {
        get pid() { return child.pid; },
        kill(sig) {
          if (exited) return;
          try { child.kill(sig ?? 'SIGTERM'); } catch { /* already dead */ }
        },
        onExit(cb) {
          if (exited && exitInfo) {
            try { cb(exitInfo); } catch { /* swallow */ }
            return () => undefined;
          }
          exitListeners.add(cb);
          return () => { exitListeners.delete(cb); };
        },
        dispose() {
          try { stdoutWriter?.end(); } catch { /* ignore */ }
          try { stderrWriter?.end(); } catch { /* ignore */ }
          exitListeners.clear();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test backend — programmable, no real fork
// ---------------------------------------------------------------------------

export interface TestSpawnInvocation {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
  haltPatterns?: string[];
}

export interface TestSupervisorChild extends SupervisorChild {
  /** Inject a stderr line — triggers halt-pattern matching when armed. */
  emitStderr(line: string): void;
  /** Drive the exit callback. */
  emitExit(info: SupervisorExitInfo): void;
  killed: boolean;
  haltMatched: { pattern: string; line: string } | null;
}

export interface TestSpawnBackend extends SupervisorSpawnBackend {
  /** Narrowed to TestSupervisorChild so tests get the test-only hooks. */
  spawn(opts: SupervisorSpawnOpts): TestSupervisorChild;
  spawned: TestSupervisorChild[];
  invocations: TestSpawnInvocation[];
  /** Override pid sequence (default 10001, 10002, ...). */
  pidSequence?: number[];
}

export function makeTestSpawnBackend(): TestSpawnBackend {
  let pidCursor = 10001;
  const backend: TestSpawnBackend = {
    spawned: [],
    invocations: [],
    spawn(opts) {
      const pid = backend.pidSequence?.[backend.spawned.length] ?? pidCursor++;
      const exitListeners = new Set<(info: SupervisorExitInfo) => void>();
      let exited = false;
      let exitInfo: SupervisorExitInfo | null = null;
      let halted = false;
      const child: TestSupervisorChild = {
        pid,
        killed: false,
        haltMatched: null,
        kill() { child.killed = true; },
        onExit(cb) {
          if (exited && exitInfo) { try { cb(exitInfo); } catch { /* swallow */ } return () => undefined; }
          exitListeners.add(cb);
          return () => { exitListeners.delete(cb); };
        },
        emitStderr(line) {
          if (halted || !opts.haltPatterns?.length || !opts.onHaltMatch) return;
          for (const pat of opts.haltPatterns) {
            try {
              if (new RegExp(pat).test(line)) {
                halted = true;
                child.haltMatched = { pattern: pat, line };
                opts.onHaltMatch(pat, line);
                return;
              }
            } catch { /* invalid regex */ }
          }
        },
        emitExit(info) {
          if (exited) return;
          exited = true;
          exitInfo = info;
          for (const cb of exitListeners) { try { cb(info); } catch { /* swallow */ } }
        },
        dispose() { exitListeners.clear(); },
      };
      backend.spawned.push(child);
      backend.invocations.push({
        command: opts.command,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.env !== undefined ? { env: opts.env } : {}),
        ...(opts.stdoutPath !== undefined ? { stdoutPath: opts.stdoutPath } : {}),
        ...(opts.stderrPath !== undefined ? { stderrPath: opts.stderrPath } : {}),
        ...(opts.haltPatterns !== undefined ? { haltPatterns: opts.haltPatterns } : {}),
      });
      return child;
    },
  };
  return backend;
}
