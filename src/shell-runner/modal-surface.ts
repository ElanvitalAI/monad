// ── ModalSurface (NT-B3) ──
//
// Surface adapter for ShellMode='modal'. Hosts a single running
// handle inside a centered modal. The legacy
// `src/interactive-terminal-modal.ts` already owns modal chrome +
// PTY rendering; this adapter's job is to (a) translate ShellHandle
// lifecycle into ModalSnapshot objects the coordinator can react to,
// and (b) enforce the "one handle per modal" invariant.
//
// Why a separate snapshot type rather than reuse the legacy modal
// handle? The Shell Runner world deals in ShellHandles, not
// PreviewTerminals; the modal coordinator still wants to know things
// like `interrupted / exitCode / last-chunk-ts` to decide when to
// auto-dismiss the modal (e.g. 'transient' mode). This adapter is
// the translation layer.
//
// Legacy-bug fix: src/dashboard-transient-modal.ts:150 subtracted
// the top border twice (`contentRows = innerHeight - 1` where
// `innerHeight` had already reserved both borders), leaving one
// content row unpainted. That's the "깨져 보이는" symptom the user
// reported. Fixed in the same commit as this adapter.

import type {
  BoundaryEvent,
  ShellHandle,
  ShellStatus,
  ShellSurface,
  Unsubscribe,
} from './types.js';
import type { TerminalExposureSnapshot } from '../terminal/posture.js';
import { classifyModalTerminalExposure, exposureEqual } from '../terminal/posture.js';

export interface ModalSnapshot {
  id: string;
  status: ShellStatus;
  finished: boolean;
  exitCode?: number;
  timedOut: boolean;
  interrupted: boolean;
  /** ms since attach. */
  elapsedMs: number;
  /** ms since the last chunk — used by the transient-modal auto-
   *  dismiss timer (idle>TTL → close). */
  idleMs: number;
  /** Total raw bytes pushed through the handle. */
  totalBytes: number;
  exposure: TerminalExposureSnapshot;
}

export interface ModalSurfaceOpts {
  onUpdate?: (snap: ModalSnapshot) => void;
  now?: () => number;
}

export interface ModalSurface extends ShellSurface {
  snapshot(): ModalSnapshot | null;
}

export function createModalSurface(opts: ModalSurfaceOpts = {}): ModalSurface {
  const now = opts.now ?? Date.now;
  const onUpdate = opts.onUpdate;

  let attached: ShellHandle | null = null;
  let unsubs: Unsubscribe[] = [];
  let started = now();
  let lastActivity = now();
  let totalBytes = 0;
  let finished = false;
  let exitCode: number | undefined;
  let timedOut = false;
  let interrupted = false;
  let status: ShellStatus = 'running';
  let latestSnap: ModalSnapshot | null = null;

  // PR-1 G7 — posture subscriber bus. Fires only on real exposure transitions
  // (status change · attach · detach). Modal posture never depends on a
  // focusPolicy flip because modal is always user-interactive while alive.
  const postureSubs = new Set<(next: TerminalExposureSnapshot | null) => void>();
  let lastExposure: TerminalExposureSnapshot | null = null;
  const computeExposure = (): TerminalExposureSnapshot | null => {
    if (!attached) return null;
    return classifyModalTerminalExposure(status);
  };
  const firePostureMaybe = () => {
    const next = computeExposure();
    if (exposureEqual(lastExposure, next)) return;
    lastExposure = next;
    for (const cb of postureSubs) {
      try { cb(next); } catch { /* isolate */ }
    }
  };

  const buildSnap = (): ModalSnapshot => ({
    id: attached?.id ?? '',
    status,
    finished,
    ...(exitCode !== undefined ? { exitCode } : {}),
    timedOut,
    interrupted,
    elapsedMs: Math.max(0, now() - started),
    idleMs: Math.max(0, now() - lastActivity),
    totalBytes,
    exposure: classifyModalTerminalExposure(status),
  });

  const emit = () => {
    latestSnap = buildSnap();
    if (onUpdate) { try { onUpdate(latestSnap); } catch { /* isolate */ } }
  };

  const detach = () => {
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    unsubs = [];
    attached = null;
    firePostureMaybe();
  };

  return {
    kind: 'modal',
    attach(handle) {
      if (attached) detach();
      attached = handle;
      started = now();
      lastActivity = now();
      totalBytes = 0;
      finished = false;
      exitCode = undefined;
      timedOut = false;
      interrupted = false;
      status = handle.status;
      unsubs.push(handle.onChunk((c) => {
        totalBytes += Buffer.byteLength(c.bytes, 'utf8');
        lastActivity = now();
        emit();
      }));
      unsubs.push(handle.onStatus((s) => {
        status = s;
        lastActivity = now();
        if (s === 'completed' || s === 'killed') finished = true;
        if (s === 'killed') interrupted = true;
        emit();
        firePostureMaybe();
      }));
      unsubs.push(handle.onBoundary((ev: BoundaryEvent) => {
        if (ev.kind !== 'cmd-end') return;
        finished = true;
        lastActivity = now();
        if (ev.exitCode !== undefined) exitCode = ev.exitCode;
        if (ev.source === 'timeout') timedOut = true;
        emit();
      }));
      emit();
      firePostureMaybe();
    },
    detach,
    snapshot() {
      // Live recompute so consumers polling once per dashboard frame
      // see up-to-date elapsed/idle values even during quiet spells.
      // Falls back to the last emitted snapshot when nothing has been
      // attached yet.
      return attached ? buildSnap() : latestSnap;
    },
    posture(): TerminalExposureSnapshot | null {
      return computeExposure();
    },
    onPostureChanged(cb): () => void {
      postureSubs.add(cb);
      return () => { postureSubs.delete(cb); };
    },
  };
}
