// ── InlineSurface (NT-B1) ──
//
// Surface adapter for ShellMode='inline'. Translates ShellHandle
// chunk/status/boundary events into `InlineSnapshot`s that the chat
// log renderer (src/pty-activity-log.ts and peers, wired in NT-C1)
// can paint without needing to know engine internals.
//
// Contract:
//   • `onUpdate` fires with the current snapshot after every chunk
//     and on every status/boundary change. Consumers that only want
//     the final state can ignore everything until `finished === true`.
//   • The surface buffers a *tail* of stdout/stderr (last N lines)
//     — anything older lives in the engine's sinks. The tail is what
//     a chat log's "collapsed preview" line typically shows.
//   • attach()/detach() are idempotent. detach() unsubscribes from
//     the handle; the last emitted snapshot stays available via
//     `latest()` so late renders can catch up.
//
// Design choice: Surface owns only the view model. It does NOT call
// back into the handle (kill/promote/etc) — that's the caller's
// concern. Keeps the adapter stateless-ish and prevents surface
// code from accidentally tangling with engine lifecycle.

import type {
  BoundaryEvent,
  OutputChunk,
  ShellHandle,
  ShellStatus,
  ShellSurface,
  Unsubscribe,
} from './types.js';

export interface InlineSnapshot {
  /** Handle id this snapshot describes. */
  id: string;
  /** One-line headline — the chat log's collapsed row. Format:
   *  `<status-glyph> <description|command> — <elapsed> (<bytes>)`. */
  headline: string;
  /** `completed` / `backgrounded` / `killed` once done; else running. */
  status: ShellStatus;
  /** Last N lines the engine emitted on stdout. Trailing newlines
   *  stripped so the caller can render them as list rows. */
  stdoutTail: string[];
  /** Last N lines on stderr. */
  stderrTail: string[];
  /** Total bytes received so far (stdout + stderr). */
  totalBytes: number;
  /** ms since attach. */
  elapsedMs: number;
  /** Exit code once the boundary fired. */
  exitCode?: number;
  /** True once a boundary event (cmd-end) has arrived. */
  finished: boolean;
}

export interface InlineSurfaceOpts {
  /** Fires with the current snapshot. Same reference each call —
   *  consumers should treat the object as mutable or copy as needed. */
  onUpdate?: (snapshot: InlineSnapshot) => void;
  /** Tail ring size. Default 5 lines per stream. */
  tailLines?: number;
  /** Optional description shown in the headline when the request
   *  didn't provide one. Defaults to "running…". */
  headlineFallback?: string;
  /** Clock override. */
  now?: () => number;
}

export interface InlineSurface extends ShellSurface {
  /** Return the most recently emitted snapshot (or null before the
   *  first update). Useful for re-rendering on dashboard redraws
   *  without replaying all chunks. */
  latest(): InlineSnapshot | null;
}

export function createInlineSurface(opts: InlineSurfaceOpts = {}): InlineSurface {
  const tailLimit = opts.tailLines ?? 5;
  const now = opts.now ?? Date.now;
  const onUpdate = opts.onUpdate;
  const fallback = opts.headlineFallback ?? 'running…';

  let started = now();
  let attached: ShellHandle | null = null;
  let latestSnap: InlineSnapshot | null = null;
  let unsubs: Unsubscribe[] = [];

  // Per-stream carry for partial lines that arrive without a
  // trailing newline. Keeps the tail ring line-accurate.
  let stdoutCarry = '';
  let stderrCarry = '';
  const stdoutTail: string[] = [];
  const stderrTail: string[] = [];
  let totalBytes = 0;
  let finished = false;
  let exitCode: number | undefined;
  let status: ShellStatus = 'running';

  const pushLines = (ring: string[], carry: string, chunk: string): string => {
    const combined = carry + chunk;
    const parts = combined.split('\n');
    const rest = parts.pop() ?? '';
    for (const line of parts) {
      ring.push(line);
      if (ring.length > tailLimit) ring.shift();
    }
    return rest;
  };

  const buildSnapshot = (): InlineSnapshot => {
    const headline = describeHeadline(status, attached, totalBytes, started, now, exitCode, fallback);
    return {
      id: attached?.id ?? '',
      headline,
      status,
      stdoutTail: finalizedTail(stdoutTail, stdoutCarry),
      stderrTail: finalizedTail(stderrTail, stderrCarry),
      totalBytes,
      elapsedMs: Math.max(0, now() - started),
      ...(exitCode !== undefined ? { exitCode } : {}),
      finished,
    };
  };

  const emit = () => {
    latestSnap = buildSnapshot();
    if (onUpdate) { try { onUpdate(latestSnap); } catch { /* isolate */ } }
  };

  const onChunk = (c: OutputChunk) => {
    totalBytes += Buffer.byteLength(c.bytes, 'utf8');
    if (c.stream === 'stderr') stderrCarry = pushLines(stderrTail, stderrCarry, c.bytes);
    else stdoutCarry = pushLines(stdoutTail, stdoutCarry, c.bytes);
    emit();
  };

  const onStatus = (s: ShellStatus) => {
    status = s;
    if (s === 'completed' || s === 'killed') finished = true;
    emit();
  };

  const onBoundary = (ev: BoundaryEvent) => {
    if (ev.kind === 'cmd-end') {
      finished = true;
      if (ev.exitCode !== undefined) exitCode = ev.exitCode;
      emit();
    }
  };

  const detach = () => {
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    unsubs = [];
    attached = null;
  };

  const attach = (handle: ShellHandle) => {
    if (attached) detach(); // idempotent
    attached = handle;
    started = now();
    stdoutTail.length = 0;
    stderrTail.length = 0;
    stdoutCarry = '';
    stderrCarry = '';
    totalBytes = 0;
    finished = false;
    exitCode = undefined;
    status = handle.status;
    unsubs.push(handle.onChunk(onChunk));
    unsubs.push(handle.onStatus(onStatus));
    unsubs.push(handle.onBoundary(onBoundary));
    emit();
  };

  return {
    kind: 'inline',
    attach,
    detach,
    latest() { return latestSnap; },
  };
}

function finalizedTail(ring: string[], carry: string): string[] {
  // Expose the accumulated carry as a visible "partial last line"
  // so consumers see progress before the newline arrives.
  if (carry === '') return ring.slice();
  return [...ring, carry];
}

function describeHeadline(
  status: ShellStatus,
  handle: ShellHandle | null,
  totalBytes: number,
  started: number,
  now: () => number,
  exitCode: number | undefined,
  fallback: string,
): string {
  const glyph = glyphFor(status, exitCode);
  const title = fallback;
  const elapsedMs = Math.max(0, now() - started);
  const elapsed = formatElapsed(elapsedMs);
  const bytes = formatBytes(totalBytes);
  const tail = exitCode !== undefined ? ` exit=${exitCode}` : '';
  return `${glyph} ${title} — ${elapsed} · ${bytes}${tail}`;
}

function glyphFor(status: ShellStatus, exitCode: number | undefined): string {
  if (status === 'running') return '⏳';
  if (status === 'backgrounded') return '⇣';
  if (status === 'killed') return '✖';
  // status === 'completed'. No exit code reported (quiet-idle /
  // timeout path) is treated as success — the engine only marks
  // a handle 'completed' when no interrupt fired.
  if (exitCode === undefined || exitCode === 0) return '✓';
  return '✗';
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m${rem}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
