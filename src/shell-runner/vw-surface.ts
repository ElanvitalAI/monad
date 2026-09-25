// ── VwSurface (NT-B4) ──
//
// Surface adapter for ShellMode='vw' — the session-nt default.
// Hosts a running handle inside a VW pane that the user can see and
// scroll, while *not* stealing focus (`focusPolicy='output-only'`).
//
// Two responsibilities that aren't shared with the other surfaces:
//
// 1. **Focus policy enforcement.** In output-only mode the pane is
//    excluded from focus rotation (Alt+N / ^B Tab). The VW-side
//    integration (NT-C wiring) reads `focusPolicy` off this surface
//    to decide whether to include the pane in its next-focus list.
//
// 2. **Interrupt-chord forwarding.** §7#6 decision: only Ctrl+C /
//    Ctrl+D / Ctrl+\\ are forwarded to the running command when
//    the pane is unfocused. Every other key is dropped. We expose
//    `forwardKeyByte(byte)` so the VW key router can call into the
//    surface without having to know the allow-list; the surface
//    returns true when it accepted the byte (and wrote it to the
//    handle), false when the byte was filtered.
//
// VwSnapshot is richer than ModalSnapshot: it includes the attached
// handle's bookmark so the dashboard can render "command 3/5 in
// runner" style breadcrumbs later (not wired here).

import type {
  BoundaryEvent,
  BufferMark,
  FocusPolicy,
  ShellHandle,
  ShellStatus,
  ShellSurface,
  Unsubscribe,
} from './types.js';
import { INTERRUPT_CHORDS } from './types.js';
import type { TerminalExposureSnapshot } from '../terminal/posture.js';
import { classifyVwTerminalExposure, exposureEqual } from '../terminal/posture.js';
import { resolveTerminalInteractionPolicy } from '../terminal/tui-policy.js';

export interface VwSnapshot {
  id: string;
  /** VW label this surface is pinned to — normally 'runner' by
   *  default. */
  vwLabel: string;
  focusPolicy: FocusPolicy;
  status: ShellStatus;
  finished: boolean;
  exitCode?: number;
  timedOut: boolean;
  elapsedMs: number;
  idleMs: number;
  totalBytes: number;
  bookmark: BufferMark | null;
  exposure: TerminalExposureSnapshot;
}

export interface VwSurfaceOpts {
  /** Default focus policy applied when a handle attaches. mode='vw'
   *  requests typically set this to 'output-only' via ShellRequest.vw;
   *  the dispatcher echoes it here. */
  focusPolicy?: FocusPolicy;
  /** Label of the VW this surface owns. Used by the registry's
   *  findVwRunner(label) lookup. */
  vwLabel?: string;
  onUpdate?: (snap: VwSnapshot) => void;
  now?: () => number;
}

export interface VwSurface extends ShellSurface {
  readonly focusPolicy: FocusPolicy;
  readonly vwLabel: string;
  snapshot(): VwSnapshot | null;
  /** VW key router hook. Returns true when the byte was consumed
   *  (written to the running handle's stdin), false when it was
   *  filtered out per focusPolicy.
   *
   *  Behavior:
   *    • focusPolicy='interactive'  → forward all bytes.
   *    • focusPolicy='output-only'  → forward ONLY the three
   *                                   INTERRUPT_CHORDS; drop others.
   *    • no attached handle         → always false (nothing to write). */
  forwardKeyByte(byte: string): boolean;
  /** Runtime policy flip — used by Surface promote (NT-B5) and
   *  explicit "^B <n>" focus grab which promotes the pane to
   *  interactive for that session. Returns the previous policy. */
  setFocusPolicy(next: FocusPolicy): FocusPolicy;
}

const DEFAULT_FOCUS_POLICY: FocusPolicy = 'output-only';

export function createVwSurface(opts: VwSurfaceOpts = {}): VwSurface {
  const now = opts.now ?? Date.now;
  const onUpdate = opts.onUpdate;
  const vwLabel = opts.vwLabel ?? 'runner';

  let focusPolicy: FocusPolicy = opts.focusPolicy ?? DEFAULT_FOCUS_POLICY;
  let attached: ShellHandle | null = null;
  let unsubs: Unsubscribe[] = [];
  let started = now();
  let lastActivity = now();
  let totalBytes = 0;
  let finished = false;
  let exitCode: number | undefined;
  let timedOut = false;
  let status: ShellStatus = 'running';
  let latestSnap: VwSnapshot | null = null;

  // PR-1 G7 — posture subscribers fire on real exposure transitions only
  // (focusPolicy flip · status change · attach · detach). Chunk events
  // do not propagate — that level of churn belongs to onUpdate, not to
  // posture-changed.
  const postureSubs = new Set<(next: TerminalExposureSnapshot | null) => void>();
  let lastExposure: TerminalExposureSnapshot | null = null;
  const computeExposure = (): TerminalExposureSnapshot | null => {
    if (!attached) return null;
    return classifyVwTerminalExposure(focusPolicy, status);
  };
  const firePostureMaybe = () => {
    const next = computeExposure();
    if (exposureEqual(lastExposure, next)) return;
    lastExposure = next;
    for (const cb of postureSubs) {
      try { cb(next); } catch { /* isolate */ }
    }
  };

  const buildSnap = (): VwSnapshot => ({
    id: attached?.id ?? '',
    vwLabel,
    focusPolicy,
    status,
    finished,
    ...(exitCode !== undefined ? { exitCode } : {}),
    timedOut,
    elapsedMs: Math.max(0, now() - started),
    idleMs: Math.max(0, now() - lastActivity),
    totalBytes,
    bookmark: attached?.bookmark ?? null,
    exposure: classifyVwTerminalExposure(focusPolicy, status),
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
    kind: 'vw',
    get focusPolicy() { return focusPolicy; },
    get vwLabel() { return vwLabel; },
    attach(handle) {
      if (attached) detach();
      attached = handle;
      started = now();
      lastActivity = now();
      totalBytes = 0;
      finished = false;
      exitCode = undefined;
      timedOut = false;
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
    snapshot() { return attached ? buildSnap() : latestSnap; },
    forwardKeyByte(byte: string): boolean {
      if (!attached) return false;
      const interaction = resolveTerminalInteractionPolicy(
        classifyVwTerminalExposure(focusPolicy, status),
      );
      switch (interaction.keyboardParticipation) {
        case 'full':
          attached.write(byte);
          return true;
        case 'interrupt-only':
          if (
            byte === INTERRUPT_CHORDS.ctrlC ||
            byte === INTERRUPT_CHORDS.ctrlD ||
            byte === INTERRUPT_CHORDS.ctrlBackslash
          ) {
            attached.write(byte);
            return true;
          }
          return false;
        case 'none':
          return false;
      }
    },
    setFocusPolicy(next: FocusPolicy): FocusPolicy {
      const prev = focusPolicy;
      focusPolicy = next;
      emit();
      firePostureMaybe();
      return prev;
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
