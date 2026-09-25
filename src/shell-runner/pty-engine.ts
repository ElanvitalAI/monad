// ── PtyCaptureEngine (NT-A4) ──
//
// Engine for ShellMode ∈ { vw, modal, interactive }. Runs a command
// in a long-lived PTY host (typically a PreviewTerminal that's
// already placed in a VW slot or modal) and resolves the ShellResult
// when a boundary strategy fires.
//
// Flow per run():
//   1. acquire inflight lock on the host (one command at a time).
//   2. terminal.markBufferPosition() → bookmark.
//   3. register raw-tap + OSC 133 detector + chunk forwarder +
//      quiet-idle reset + output-byte count.
//   4. terminal.write(command + '\r').
//   5. whichever boundary fires first wins:
//        OSC-133 cmd-end  (preferred — exact)
//        exit-style sentinel via "exit %?\n"? (no — we don't inject)
//        quiet-idle       (fallback — configurable, default 1500ms)
//        timeout          (hard cap)
//        kill()           (caller-initiated, interrupted=true)
//   6. slice bookmark→now, stripMotion+stripSgr, cap to maxOutputBytes.
//   7. release lock, resolve result.
//
// Why no child-process exit code? The PTY is shared across many
// sequential commands; there is no OS-level "this command ended".
// We rely on OSC 133 when the rc injection (NT-B2) is alive, and
// quiet-idle / timeout otherwise. Caller receives exitCode from the
// OSC 133 payload if the shell sent one.
//
// Why decouple from PreviewTerminal via TerminalHost? Tests want to
// drive raw chunks deterministically (no fs.read loop), and the vw-
// placement-adapter will eventually want to swap the backing PTY
// without the engine noticing.

import type {
  BoundaryEvent,
  BufferMark,
  CaptureEngine,
  OutputChunk,
  PromoteOpts,
  RunCtx,
  ShellHandle,
  ShellMode,
  ShellRequest,
  ShellResult,
  ShellStatus,
  Unsubscribe,
} from './types.js';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_QUIET_IDLE_MS,
  DEFAULT_TIMEOUTS,
  INTERRUPT_CHORDS,
} from './types.js';
import { createOsc133Detector } from '../terminal-matrix/osc133.js';

/** Minimal PreviewTerminal surface the engine depends on. PreviewTerminal
 *  satisfies it structurally; tests inject a fake with the same shape. */
export interface TerminalHost {
  readonly isAlive: boolean;
  addRawOutputTap(cb: (chunk: string) => void): () => void;
  markBufferPosition(): BufferMark;
  bytesSinceMark(mark: BufferMark): number;
  sliceFromMark(mark: BufferMark): string[];
  renderForLLM(opts: { mark?: BufferMark }): string;
  write(bytes: string): void;
  resize(cols: number, rows: number): void;
}

export interface PtyEngineOpts {
  /** Terminal that runs the commands. All handles share this one
   *  host — the engine does not spawn or own it. */
  host: TerminalHost;
  /** Monotonic clock override for tests. */
  now?: () => number;
  /** Test hook: force setTimeout to a simulated scheduler. */
  scheduler?: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (t: unknown) => void;
  };
}

export function createPtyCaptureEngine(opts: PtyEngineOpts): CaptureEngine {
  // Per-host inflight lock. Map so future multi-host engines are a
  // trivial extension (key by host identity).
  const inflight = new WeakMap<TerminalHost, true>();

  const now = opts.now ?? Date.now;
  const sched = opts.scheduler ?? {
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };

  return {
    kind: 'pty',
    run(req, ctx) {
      return startRun(req, ctx, opts.host, inflight, now, sched);
    },
  };
}

interface Scheduler {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

function startRun(
  req: ShellRequest,
  ctx: RunCtx,
  host: TerminalHost,
  inflight: WeakMap<TerminalHost, true>,
  now: () => number,
  sched: Scheduler,
): ShellHandle {
  if (inflight.has(host)) {
    throw new Error('PtyCaptureEngine: host already has an inflight command. Caller should queue or spawn a second host.');
  }
  inflight.set(host, true);

  const mode: Exclude<ShellMode, 'auto'> = resolveMode(req.mode);
  const id = `sh-${Math.random().toString(36).slice(2, 10)}`;
  const bookmark = host.markBufferPosition();

  const chunkSubs = new Set<(c: OutputChunk) => void>();
  const boundarySubs = new Set<(ev: BoundaryEvent) => void>();
  const statusSubs = new Set<(s: ShellStatus) => void>();

  let status: ShellStatus = 'running';
  const setStatus = (next: ShellStatus) => {
    if (status === next) return;
    status = next;
    for (const cb of statusSubs) { try { cb(next); } catch { /* isolate */ } };
  };

  const started = now();
  const quietMs = req.quietIdleMs === null
    ? null
    : (req.quietIdleMs ?? DEFAULT_QUIET_IDLE_MS);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUTS[mode];
  const maxOutputBytes = req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // Boundary finalization state. Exactly one of { cmdEnd, timedOut,
  // killed } flips true; `resolveResult` reads them.
  let exitCode: number | undefined;
  let boundarySource: BoundaryEvent['source'] = 'quiet';
  let settled = false;

  let quietTimer: unknown = null;
  let hardTimer: unknown = null;

  const detector = createOsc133Detector(now);
  const resolvers: Array<(r: ShellResult) => void> = [];
  const result = new Promise<ShellResult>((resolve) => { resolvers.push(resolve); });

  const unsubs: Unsubscribe[] = [];

  const emitChunk = (bytes: string) => {
    const chunk: OutputChunk = { stream: 'pty', bytes, ts: now() };
    for (const cb of chunkSubs) { try { cb(chunk); } catch { /* isolate */ } }
  };

  const emitBoundary = (ev: BoundaryEvent) => {
    for (const cb of boundarySubs) { try { cb(ev); } catch { /* isolate */ } }
  };

  const resetQuiet = () => {
    if (quietMs == null) return;
    if (quietTimer) sched.clearTimeout(quietTimer);
    quietTimer = sched.setTimeout(() => {
      finalize({ source: 'quiet' });
    }, quietMs);
  };

  const finalize = (end: {
    source: BoundaryEvent['source'];
    exit?: number;
    interrupted?: boolean;
    timedOut?: boolean;
  }) => {
    if (settled) return;
    settled = true;
    if (quietTimer) sched.clearTimeout(quietTimer);
    if (hardTimer) sched.clearTimeout(hardTimer);
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    boundarySource = end.source;
    if (end.exit !== undefined) exitCode = end.exit;
    emitBoundary({ kind: 'cmd-end', source: end.source, at: now(), exitCode });
    setStatus(end.interrupted ? 'killed' : 'completed');
    inflight.delete(host);
    const r = buildResult(host, bookmark, started, now(), {
      exitCode,
      outcome: outcomeFor(end),
      timedOut: end.timedOut ?? false,
      interrupted: end.interrupted ?? false,
      source: boundarySource,
      maxOutputBytes,
    });
    try { ctx.onSettled?.(r); } catch { /* ignore */ }
    for (const rr of resolvers) rr(r);
  };

  // Raw-tap subscription: forward chunks, feed detector, reset quiet
  // timer. Lives for the full run; finalize() unsubscribes.
  unsubs.push(host.addRawOutputTap((chunk) => {
    if (settled) return;
    emitChunk(chunk);
    resetQuiet();
    const events = detector.consume(chunk);
    for (const ev of events) {
      if (ev.kind === 'cmd-end') {
        // Single-source-of-truth: finalize() is the one place that
        // emits the cmd-end boundary; skip the raw-tap emit here to
        // avoid duplicate notifications.
        finalize({ source: 'osc-133', exit: ev.exitCode });
        return;
      }
      // prompt-start events reset the quiet timer too (useful when
      // the shell redraws a prompt after a long silent op), but do
      // not themselves end the command.
      emitBoundary(ev);
    }
  }));

  // Hard timeout — always armed, even when quietIdle is null.
  hardTimer = sched.setTimeout(() => {
    // SIGINT equivalent first; if the command swallows it, the quiet
    // timer (or next run) will clean up. finalize marks timedOut.
    try { host.write(INTERRUPT_CHORDS.ctrlC); } catch { /* ignore */ }
    finalize({ source: 'timeout', timedOut: true, interrupted: true });
  }, timeoutMs);

  // Prime the quiet timer so a command that emits nothing still ends.
  resetQuiet();

  // Inject the command. String → as-is + CR; array → naive join (first
  // pass; proper shlex quoting lives with the outer dispatcher).
  const cmdText = Array.isArray(req.command)
    ? (req.command as readonly string[]).join(' ')
    : (req.command ?? '');
  if (cmdText.length > 0) host.write(cmdText + '\r');
  if (req.stdin) host.write(req.stdin);

  // caller abort (AbortSignal) → kill path
  if (req.signal) {
    const onAbort = () => finalize({ source: 'timeout', interrupted: true });
    if (req.signal.aborted) onAbort();
    else req.signal.addEventListener('abort', onAbort, { once: true });
  }

  const handle: ShellHandle = {
    id,
    mode,
    get status() { return status; },
    bookmark,
    kill(signal) {
      if (settled) return;
      const b = signal === 'SIGKILL'
        ? INTERRUPT_CHORDS.ctrlBackslash
        : INTERRUPT_CHORDS.ctrlC;
      try { host.write(b); } catch { /* ignore */ }
      finalize({ source: 'timeout', interrupted: true });
    },
    background() {
      // NT-A4 scope: mark status only; registry/surface wiring lives
      // in NT-A6 / B2. The command keeps running and will resolve as
      // normal when boundary fires.
      if (settled || status !== 'running') return false;
      setStatus('backgrounded');
      return true;
    },
    promote(_to: 'modal' | 'vw' | 'inline', _opts?: PromoteOpts) {
      // Placement promotion is a B5 concern; return false so callers
      // that try it prematurely get an honest no-op.
      return false;
    },
    write(bytes) {
      if (settled) return;
      host.write(bytes);
    },
    resize(cols, rows) {
      host.resize(cols, rows);
    },
    onChunk(cb) { chunkSubs.add(cb); return () => chunkSubs.delete(cb); },
    onBoundary(cb) { boundarySubs.add(cb); return () => boundarySubs.delete(cb); },
    onStatus(cb) { statusSubs.add(cb); return () => statusSubs.delete(cb); },
    result,
  };

  return handle;
}

function resolveMode(mode: ShellMode | undefined): Exclude<ShellMode, 'auto'> {
  if (!mode || mode === 'auto') return 'vw';
  return mode;
}

function outcomeFor(end: {
  source: BoundaryEvent['source'];
  exit?: number;
  interrupted?: boolean;
  timedOut?: boolean;
}): ShellResult['outcome'] {
  if (end.timedOut) return 'timeout';
  if (end.interrupted) return 'aborted';
  return 'exit';
}

function buildResult(
  host: TerminalHost,
  mark: BufferMark,
  started: number,
  ended: number,
  meta: {
    exitCode: number | undefined;
    outcome: ShellResult['outcome'];
    timedOut: boolean;
    interrupted: boolean;
    source: BoundaryEvent['source'];
    maxOutputBytes: number;
  },
): ShellResult {
  const full = host.renderForLLM({ mark });
  const { text, truncated, truncatedAfterBytes, tail } = capOutput(full, meta.maxOutputBytes);
  const stream = { text, ...(truncatedAfterBytes !== undefined ? { truncatedAfterBytes } : {}), ...(tail !== undefined ? { tail } : {}) };
  return {
    ...(meta.exitCode !== undefined ? { exitCode: meta.exitCode } : {}),
    stdout: stream,
    stderr: { text: '' }, // PTY cannot split — all output lives in stdout.
    aggregated: stream,
    durationMs: Math.max(0, ended - started),
    timedOut: meta.timedOut,
    interrupted: meta.interrupted,
    truncated,
    outcome: meta.outcome,
    bookmarkId: markId(mark),
  };
}

function markId(m: BufferMark): string {
  return `m${m.row}:${m.bytes}:${m.ts}`;
}

function capOutput(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean; truncatedAfterBytes?: number; tail?: string } {
  const size = Buffer.byteLength(text, 'utf8');
  if (size <= maxBytes) return { text, truncated: false };
  // Preserve head + tail halves; most shell output signatures live
  // at the boundaries. Middle is what we drop.
  const half = Math.floor(maxBytes / 2);
  const buf = Buffer.from(text, 'utf8');
  const head = buf.subarray(0, half).toString('utf8');
  const tail = buf.subarray(size - half).toString('utf8');
  return { text: head, truncated: true, truncatedAfterBytes: half, tail };
}
