// ── Capture substrate · manifest→ACP terminalFrame poller (PLAN P2) ──
//
// The interactive dashboard TUI runs in a SEPARATE process from the NEXUS
// daemon and self-reports its rendered screen into the shared pty-manifest
// (P1 · frame column · S2). But ChannelBus is process-local, so the daemon
// cannot subscribe to the TUI's in-process frame stream — the only
// cross-process channel is the manifest (PLAN §5 · risk note "ChannelBus
// 프로세스-로컬").
//
// This poller closes that gap: on a throttle it reads the manifest for
// live `tui` surfaces with a FRESH frame (frameAt advanced since last
// poll) and fans the frame out to every term-frame-capable ACP peer via
// `getActiveAcpAllSessionsTermFrameBroadcaster()`. The PWA (P2-c) renders
// it as a live mirror of the dashboard TUI (picker/modal 포함).
//
// Design notes:
//   - PULL, not push: the daemon owns no PTY handle for the TUI, so it
//     samples the manifest (same pattern as `/v1/terminals`).
//   - Dedupe by frameAt: only re-broadcast when the frame actually
//     changed — a static screen costs one manifest read per tick, zero
//     fan-out. Cheap early-out when no peers are attached.
//   - kind allowlist (P3): broadcast live framed surfaces of kind 'tui'
//     (dashboard self-report) OR 'pty' (forwarded self-implement child).
//     An explicit allowlist (not "any framed surface") keeps a future
//     frame-populating kind — e.g. 'preview' — from surprise-broadcasting;
//     new self-reporting kinds opt in here deliberately.
//   - fail-soft everywhere — a broken poll never touches the observed TUI.
//   - killswitch `MONAD_TUI_FRAME_BROADCAST=0` for per-run disable
//     (sibling to the producer's `MONAD_TUI_SELF_REPORT=0`).

import { debug } from '../debug/log.js';
import { listPtyManifest, type PtyManifestRow } from '../pty-shell/pty-manifest.js';
import type { MonadTermPayload } from '../acp/monad-extensions.js';

/** Fleet broadcaster shape — `getActiveAcpAllSessionsTermFrameBroadcaster()`. */
export type TermFrameBroadcaster = (
  payload: MonadTermPayload<'terminalFrame'>,
) => Promise<{ delivered: number; fannedTo: number }>;

export interface TuiFrameBroadcasterDeps {
  /** Manifest reader — defaults to `listPtyManifest`. Overridable in tests. */
  listManifest?: () => PtyManifestRow[];
  /** Resolve the active fleet broadcaster (null when no daemon/peers up).
   *  Lazily read each tick so the poller survives ACP server restarts. */
  getBroadcaster?: () => TermFrameBroadcaster | null;
  /** Poll cadence (ms). Default 1000 — the manifest frame column is itself
   *  throttled to ~1.5s, so 1s sampling never misses a distinct frame. */
  intervalMs?: number;
  /** Injected interval scheduler (tests). Defaults to setInterval.
   *  Handle typed `unknown` to bridge DOM (`number`) vs Node (`Timeout`)
   *  setInterval return-type divergence. */
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (h: unknown) => void;
}

/** One poll pass — read the manifest, fan out any tui frame whose
 *  `frameAt` advanced since we last sent it. Exported for unit tests
 *  (drive it synchronously without a timer). Returns the number of
 *  surfaces broadcast this pass. */
export async function pollAndBroadcastTuiFrames(
  lastSentAt: Map<string, number>,
  deps: TuiFrameBroadcasterDeps = {},
): Promise<number> {
  const listManifest = deps.listManifest ?? listPtyManifest;
  const getBroadcaster = deps.getBroadcaster ?? (() => null);
  const broadcaster = getBroadcaster();
  if (!broadcaster) return 0; // no daemon / no peers path — cheap early-out
  let sent = 0;
  let rows: PtyManifestRow[];
  try {
    rows = listManifest();
  } catch {
    return 0; // fail-soft — manifest read error never propagates
  }
  for (const row of rows) {
    // Live · has a rendered frame · allowlisted kind (P3: tui + forwarded pty).
    if (!row.alive || !row.frame || row.frameAt <= 0) continue;
    if (row.kind !== 'tui' && row.kind !== 'pty') continue;
    const prev = lastSentAt.get(row.id) ?? 0;
    if (row.frameAt <= prev) continue; // unchanged — skip fan-out
    lastSentAt.set(row.id, row.frameAt);
    try {
      await broadcaster({
        terminalId: row.id,
        frame: row.frame,
        instance: row.instance,
        at: row.frameAt,
      });
      sent += 1;
    } catch {
      /* swallow — best-effort; retry on next tick with same frameAt gate */
    }
  }
  // Forget surfaces that vanished from the manifest so the map can't grow
  // unbounded across long daemon lifetimes.
  if (lastSentAt.size > 0) {
    const liveIds = new Set(rows.map((r) => r.id));
    for (const id of lastSentAt.keys()) {
      if (!liveIds.has(id)) lastSentAt.delete(id);
    }
  }
  return sent;
}

/** Start the manifest→terminalFrame poller. Returns a stop thunk.
 *  No-op (returns a no-op stop) when disabled via env killswitch. */
export function startTuiFrameBroadcaster(deps: TuiFrameBroadcasterDeps = {}): () => void {
  if (process.env.MONAD_TUI_FRAME_BROADCAST === '0') {
    if (debug.enabled) debug.log('capture.tui-frame-bcast', 'disabled', { reason: 'killswitch' });
    return () => {};
  }
  const intervalMs = deps.intervalMs ?? 1000;
  const setIntervalFn: (fn: () => void, ms: number) => unknown = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn: (h: unknown) => void =
    deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const lastSentAt = new Map<string, number>();
  let inFlight = false;
  const handle = setIntervalFn(() => {
    if (inFlight) return; // don't overlap slow broadcasts
    inFlight = true;
    void pollAndBroadcastTuiFrames(lastSentAt, deps).finally(() => { inFlight = false; });
  }, intervalMs);
  // Node/Bun: don't keep the process alive just for this poller.
  (handle as { unref?: () => void }).unref?.();
  if (debug.enabled) debug.log('capture.tui-frame-bcast', 'started', { intervalMs });
  return () => {
    clearIntervalFn(handle);
    if (debug.enabled) debug.log('capture.tui-frame-bcast', 'stopped', {});
  };
}
