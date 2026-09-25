// NEXUS · webterm session (N-1 cleanup PR d).
//
// Per-tab thin PTY session: holds the line-oriented output buffer,
// owns a single PtyBackend (reused from mini-terminal so the same
// production backend factory wires both surfaces in PR e), and
// exposes a subscribe() callback so the SidebarTabSurface detail view
// re-renders on each chunk + status change. Mirrors the
// `NexusChatSession` shape from PR b/c so the TUI key dispatcher and
// boot wire treat the two surfaces symmetrically.
//
// What lands in PR d vs deferred:
//   - PR d: lifecycle (inert → running → exited/error), output buffer
//     (line-ring · default 500 lines), write/resize forward, cancel +
//     destroy, subscribe pattern. PtyBackend factory is injected — the
//     production node-pty factory wires through PR e (mini-terminal-
//     backend.ts) along with mini-terminal.
//   - Deferred: ANSI stripping in the buffer (kept verbatim — view
//     renders raw lines until cleanup PR.+ adds an ANSI processor),
//     scrollback paging keys, search.
//
// Test seam: the PtyBackend interface from ./pty.ts is the single
// dependency boundary, so tests inject a fake backend that pushes
// deterministic chunks + emits exit on demand.

import { terminatePty, type PtyBackend, type PtyTerminationOpts, type PtyTerminationResult } from './pty.js';

export type WebtermSessionStatus = 'inert' | 'running' | 'exited' | 'error';

export interface NexusWebtermSessionOpts {
  /** Backend factory — invoked on construct + (when respawn enabled)
   *  after exit. When omitted the session boots inert (no PTY) so the
   *  view can still render a placeholder + the operator can attach a
   *  backend later (PR e production wire). */
  spawn?: () => PtyBackend;
  /** Output buffer ring cap (lines). Default 500 — generous compared
   *  to the mini-terminal default (200) since the webterm tab is the
   *  user's primary fallback shell when chat is in the air. */
  bufferLines?: number;
  /** Auto-respawn policy. Default: { enabled: false } — webterm tabs
   *  are user-driven (cd, exit are normal); a respawn loop on exit
   *  would surprise the user. Set { enabled: true, graceMs: 2000 } to
   *  match the mini-terminal "always-on" semantic. */
  respawn?: { enabled: boolean; graceMs?: number };
  /** Wall-clock seam for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** PTY termination grace and post-SIGKILL observation windows. */
  termination?: PtyTerminationOpts;
  /** Soft error sink — invoked on backend setup / write failure so the
   *  host view can surface a banner. The session also records the
   *  error in `getLastError()`. Optional — no-op when omitted. */
  onError?: (err: Error) => void;
}

/** Per-tab webterm session — one PTY backend, line-oriented output
 *  buffer, growing on every chunk. Re-rendering hooks (`subscribe`)
 *  fire after every mutation so the view stays current without
 *  polling.
 *
 *  Lifecycle:
 *
 *    new NexusWebtermSession({})                    → status='inert'
 *    new NexusWebtermSession({spawn: factory})      → status='running'
 *
 *    write("ls\n")                                  → forwards to PTY
 *    backend emits chunk                            → buffer append
 *    backend exits                                  → status='exited'
 *      (respawn.enabled: re-spawn after graceMs    → status='running')
 *
 *    destroy()                                      → kill + cleanup
 *      (subsequent write/resize are no-ops; status stays at last
 *       value so the view can still surface "exited" after teardown).
 */
export class NexusWebtermSession {
  private readonly opts: NexusWebtermSessionOpts;
  private readonly buffer: string[] = [];
  private readonly bufferCap: number;
  private readonly subscribers = new Set<() => void>();
  private readonly respawnEnabled: boolean;
  private readonly respawnGraceMs: number;
  private status: WebtermSessionStatus;
  private backend: PtyBackend | null = null;
  private dataUnsub: (() => void) | null = null;
  private exitUnsub: (() => void) | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private destruction: Promise<PtyTerminationResult> | null = null;
  private lastError: Error | null = null;
  private lastExitCode: number | null = null;

  constructor(opts: NexusWebtermSessionOpts = {}) {
    this.opts = opts;
    this.bufferCap = opts.bufferLines ?? 500;
    this.respawnEnabled = opts.respawn?.enabled ?? false;
    this.respawnGraceMs = opts.respawn?.graceMs ?? 2000;
    if (opts.spawn) {
      try {
        this.spawnBackend();
        this.status = 'running';
      } catch (err) {
        this.status = 'error';
        this.recordError(err as Error);
      }
    } else {
      this.status = 'inert';
    }
  }

  // ── public read API ─────────────────────────────────────────────

  getStatus(): WebtermSessionStatus {
    return this.status;
  }

  /** Snapshot of the output buffer — caller MUST treat as read-only.
   *  Returned reference is the live array so successive renders can
   *  diff cheaply; callers must not mutate. */
  getOutput(): readonly string[] {
    return this.buffer;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  /** Exit code from the most recent backend exit (null when the
   *  session has never exited or is currently running). */
  getLastExitCode(): number | null {
    return this.lastExitCode;
  }

  /** Process pid of the live backend (undefined when inert / exited
   *  / backend doesn't expose pid). */
  getPid(): number | undefined {
    return this.backend?.pid;
  }

  // ── subscription ────────────────────────────────────────────────

  /** Re-render hook. Caller registers once; the closure fires after
   *  every output / status / error mutation. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  private notify(): void {
    for (const fn of this.subscribers) {
      try { fn(); } catch { /* observer must not break the session */ }
    }
  }

  // ── mutation API ────────────────────────────────────────────────

  /** Forward a keystroke / pasted text to the child stdin. No-op when
   *  inert / exited / destroyed (the TUI dispatcher consults
   *  `getStatus()` to decide whether to fall through to the surface). */
  write(input: string): void {
    if (this.destroyed) return;
    if (!this.backend) return;
    if (this.status !== 'running') return;
    try {
      this.backend.write(input);
    } catch (err) {
      this.recordError(err as Error);
    }
  }

  /** Resize the underlying PTY. Silently no-ops when the backend is
   *  absent or doesn't support resize. */
  resize(rows: number, cols: number): void {
    if (this.destroyed) return;
    try { this.backend?.resize?.(rows, cols); } catch { /* swallow */ }
  }

  /** Send SIGINT to the child (Ctrl-C inside webterm). The TUI key
   *  dispatcher's outer Ctrl-C path stays reserved for the loop
   *  stop() — callers wire a different key (e.g. Ctrl-\\) to this. */
  sendSignal(signal: NodeJS.Signals = 'SIGINT'): void {
    if (this.destroyed || !this.backend) return;
    try { this.backend.kill(signal); } catch (err) {
      this.recordError(err as Error);
    }
  }

  /** Tear down: clear timers and output subscriptions, then terminate the
   *  backend and wait for its exit observation. Repeated calls share the same
   *  completion promise; callers may ignore it and still send SIGTERM now. */
  destroy(): Promise<PtyTerminationResult> {
    if (this.destruction) return this.destruction;
    this.destroyed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.dataUnsub?.();
    this.dataUnsub = null;
    const backend = this.backend;
    this.backend = null;
    this.subscribers.clear();
    this.destruction = (backend
      ? terminatePty(backend, this.opts.termination)
      : Promise.resolve<PtyTerminationResult>('exited')
    ).finally(() => {
      this.exitUnsub?.();
      this.exitUnsub = null;
    });
    return this.destruction!;
  }

  // ── internal ────────────────────────────────────────────────────

  private spawnBackend(): void {
    if (!this.opts.spawn) return;
    const backend = this.opts.spawn();
    this.backend = backend;
    this.dataUnsub = backend.onData((chunk) => this.appendChunk(chunk));
    this.exitUnsub = backend.onExit((info) => this.handleExit(info));
  }

  private appendChunk(chunk: string): void {
    if (this.destroyed) return;
    if (chunk.length === 0) return;
    // Line-oriented buffer: split on \n, stitch the first chunk onto
    // the open last line so successive partial writes accumulate on
    // the same row (the production renderer in cleanup PR.+ will run
    // an ANSI processor before display).
    const lines = chunk.split('\n');
    if (this.buffer.length > 0 && lines.length > 0) {
      this.buffer[this.buffer.length - 1] += lines[0];
      lines.shift();
    } else if (lines.length > 0) {
      this.buffer.push(lines.shift()!);
    }
    for (const line of lines) this.buffer.push(line);
    while (this.buffer.length > this.bufferCap) this.buffer.shift();
    this.notify();
  }

  private handleExit(info: { exitCode: number | null; signal?: NodeJS.Signals }): void {
    if (this.destroyed) return;
    this.lastExitCode = info.exitCode;
    this.status = 'exited';
    this.dataUnsub?.();
    this.exitUnsub?.();
    this.dataUnsub = null;
    this.exitUnsub = null;
    this.backend = null;
    this.notify();
    if (!this.respawnEnabled) return;
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      if (this.destroyed) return;
      try {
        this.spawnBackend();
        this.status = 'running';
        this.lastExitCode = null;
        this.notify();
      } catch (err) {
        this.status = 'error';
        this.recordError(err as Error);
      }
    }, this.respawnGraceMs);
  }

  private recordError(err: Error): void {
    this.lastError = err;
    this.notify();
    try { this.opts.onError?.(err); } catch { /* swallow */ }
  }
}

/** Shared registry — runNexus / shell / tui-render look up the per-tab
 *  webterm session by spec id without circular imports. Mirrors
 *  `NexusChatSessionRegistry` from PR c so the boot wire and key
 *  dispatch treat the two surfaces uniformly. */
export type NexusWebtermSessionRegistry = Map<string, NexusWebtermSession>;
