// ── ShellRegistry (NT-A6) ──
//
// In-process registry of live ShellHandle instances plus two
// automatic policies:
//
//   1. auto-bg — a 'running' handle that is still alive after
//      `backgroundAfterMs` (default 15_000, claude-code rule) flips
//      to 'backgrounded'. Surface managers subscribe and relocate
//      the surface accordingly; the engine keeps running.
//
//   2. bg TTL — a 'backgrounded' handle that does not complete
//      within `bgTtlMs` (default 300_000, §7#8 confirmed = codex
//      DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS) is force-killed.
//
// findVwRunner(label) lets the RunShell tool reuse an existing VW
// terminal rather than spawning a fresh one for every invocation.
// The registry itself doesn't spawn PTYs — it just tracks them and
// indexes them by the VW label their surface reports.

import type {
  ShellHandle,
  ShellListFilter,
  ShellMode,
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry as IShellRegistry,
  ShellRegistryEvent,
  ShellRegistrySubscriber,
  ShellStatus,
  ShellSurface,
  Unsubscribe,
} from './types.js';
import {
  DEFAULT_BACKGROUND_AFTER_MS,
  DEFAULT_TIMEOUTS,
  DEFAULT_VW_RUNNER_LABEL,
} from './types.js';
import {
  classifyBackgroundTerminalExposure,
  exposureEqual,
  type TerminalExposureSnapshot,
} from '../terminal/posture.js';
import { debug } from '../debug/log.js';

export interface ShellRegistryOpts {
  /** Foreground → background auto-flip delay. Default 15_000ms. */
  backgroundAfterMs?: number;
  /** Background handle hard-kill TTL. Default 300_000ms (5 min). */
  bgTtlMs?: number;
  /** N3 — how long a completed/killed handle is kept visible to the
   *  default `list()` before being hidden (stays in the map, just
   *  filtered out). Default 30_000ms. Callers pass
   *  `list({includeSettled:true})` to see them anyway. */
  settledTtlMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Scheduler override — same shape as pty-engine's for symmetry. */
  scheduler?: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (t: unknown) => void;
  };
  /** SP-B — fires after a handle is registered + its policy timers
   *  are armed. Meant for observers that want to mirror the registry
   *  contents elsewhere (e.g. BackgroundSurface rollup for the
   *  status-bar pill). Throwing in the callback is isolated. */
  onRegister?: (handle: ShellHandle) => void;
  /** SP-B — fires right before a handle is removed from the registry
   *  (explicit unregister). Paired with onRegister. */
  onUnregister?: (id: string) => void;
}

/** N3 — default visibility window for settled handles (30s). Matches
 *  the status-bar pill's implicit behavior (completed handles never
 *  appear there) + gives slash/popup callers the same "what's live"
 *  bias without extra work. */
export const DEFAULT_SETTLED_TTL_MS = 30_000;

interface Entry {
  handle: ShellHandle;
  /** VW label (set via `tagVwRunner`) for findVwRunner lookup. */
  vwLabel?: string;
  autoBgTimer: unknown;
  bgTtlTimer: unknown;
  /** N3 — wall clock (ms) at which handle entered a settled state
   *  (completed / killed). Undefined while running or backgrounded.
   *  Default `list()` filters entries whose settledAt is older than
   *  DEFAULT_SETTLED_TTL_MS so the "what's live" UX stays focused. */
  settledAt?: number;
  /** Remembered unsubs so drop() cleans up. */
  unsubs: Array<() => void>;
  /** PR-1 — surfaces attached for posture lazy-proxy. Insertion order
   *  preserved so describePosture deterministically returns first
   *  non-null. */
  surfaces: Array<{
    surface: ShellSurface;
    unsubInner?: () => void;
  }>;
  /** PR-1 — last computed posture (exposure-level). Used by registry
   *  to diff and only fire subscribePosture on real changes (G7). */
  lastPosture: TerminalExposureSnapshot | null;
}

export interface ShellRegistry extends IShellRegistry {
  /** Associate a VW label with a handle (so findVwRunner can locate
   *  it later). Typically called by the VW surface right after a
   *  terminal is placed into its pane. */
  tagVwRunner(id: string, label: string): void;
  /** Count of entries currently tracked — exposed for tests /
   *  debugging. */
  size(): number;
  /** Dispose all timers + subscriptions. Does not kill live handles;
   *  caller should kill() them beforehand if termination is desired. */
  dispose(): void;
}

export function createShellRegistry(opts: ShellRegistryOpts = {}): ShellRegistry {
  const backgroundAfterMs = opts.backgroundAfterMs ?? DEFAULT_BACKGROUND_AFTER_MS;
  const bgTtlMs = opts.bgTtlMs ?? DEFAULT_TIMEOUTS.bg;
  const settledTtlMs = opts.settledTtlMs ?? DEFAULT_SETTLED_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const sched = opts.scheduler ?? {
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };

  const entries = new Map<string, Entry>();

  // B-10-α — multi-subscriber bus for Phase P7-γ (ShellRegistry →
  // SurfaceRegistry bridge). Independent of opts.onRegister/onUnregister
  // so SP-B wiring and the SurfaceRegistry mirror coexist.
  const subs = new Set<ShellRegistrySubscriber>();
  const emit = (event: ShellRegistryEvent): void => {
    for (const cb of subs) {
      try { cb(event); } catch { /* isolate per-subscriber */ }
    }
  };

  // PR-1 — posture subscriber bus (per G2 dashboard 1 subscriber this arc;
  // facade in PR-3 will mirror to external hosts). Diff happens registry-
  // side so surface chunk events that don't move exposure don't propagate.
  const postureSubs = new Set<ShellPostureSubscriber>();
  const emitPosture = (event: ShellPostureEvent): void => {
    if (debug.enabled) {
      debug.log('shell.registry.posture-changed', event.shellId, {
        prev: event.prev?.userExposure ?? null,
        next: event.next?.userExposure ?? null,
        agentInteractivePrev: event.prev?.agentInteractive ?? null,
        agentInteractiveNext: event.next?.agentInteractive ?? null,
      });
    }
    for (const cb of postureSubs) {
      try { cb(event); } catch { /* isolate */ }
    }
  };

  /** PR-1 — compute current posture for a handle, walking attached
   *  surfaces in insertion order. bg-mode fallback when no surface. */
  const computePosture = (id: string): TerminalExposureSnapshot | null => {
    const e = entries.get(id);
    if (!e) return null;
    for (const { surface } of e.surfaces) {
      const p = surface.posture?.();
      if (p) return p;
    }
    // mode='bg' fallback — BackgroundSurface tracks bg handles centrally
    // (no per-handle attach), so registry synthesizes from status.
    if (e.handle.mode === 'bg') {
      return classifyBackgroundTerminalExposure(e.handle.status);
    }
    return null;
  };

  /** PR-1 — recompute posture and fire subscribePosture only when the
   *  exposure actually changed (G7). */
  const refreshPosture = (id: string): void => {
    const e = entries.get(id);
    if (!e) return;
    const next = computePosture(id);
    const prev = e.lastPosture;
    if (exposureEqual(prev, next)) return;
    e.lastPosture = next;
    emitPosture({ kind: 'posture-changed', shellId: id, prev, next });
  };

  const armBgTtl = (entry: Entry) => {
    if (entry.bgTtlTimer) sched.clearTimeout(entry.bgTtlTimer);
    entry.bgTtlTimer = sched.setTimeout(() => {
      if (entry.handle.status === 'backgrounded') {
        try { entry.handle.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, bgTtlMs);
  };

  const cancelTimers = (entry: Entry) => {
    if (entry.autoBgTimer) sched.clearTimeout(entry.autoBgTimer);
    if (entry.bgTtlTimer) sched.clearTimeout(entry.bgTtlTimer);
    entry.autoBgTimer = null;
    entry.bgTtlTimer = null;
  };

  const register = (handle: ShellHandle): void => {
    if (entries.has(handle.id)) return;
    const entry: Entry = {
      handle,
      autoBgTimer: null,
      bgTtlTimer: null,
      unsubs: [],
      surfaces: [],
      lastPosture: null,
    };
    entries.set(handle.id, entry);

    // Foreground → bg auto-flip (skip bg/modal/vw modes that are
    // already non-blocking UX-wise).
    if (handle.mode === 'inline') {
      entry.autoBgTimer = sched.setTimeout(() => {
        if (handle.status === 'running') {
          handle.background();
        }
      }, backgroundAfterMs);
    }

    // Status transitions — arm/disarm TTL accordingly.
    entry.unsubs.push(handle.onStatus((s) => {
      if (s === 'backgrounded') {
        if (entry.autoBgTimer) {
          sched.clearTimeout(entry.autoBgTimer);
          entry.autoBgTimer = null;
        }
        armBgTtl(entry);
      } else if (s === 'completed' || s === 'killed') {
        cancelTimers(entry);
        // N3 — record settle time so default list() can hide this
        // entry once settledTtlMs elapses. Entry stays in the map —
        // callers with includeSettled:true still see it. Prior
        // behaviour (leave forever) is equivalent to includeSettled.
        entry.settledAt = now();
      }
      // PR-1 G7 — bg-mode fallback posture follows handle.status, so
      // we must refresh on every status transition. Surfaces with their
      // own posture() also fire onPostureChanged separately, which
      // routes through refreshPosture too — diffing keeps both safe.
      refreshPosture(handle.id);
    }));

    // Initial posture seed (bg fallback engages immediately for bg mode).
    entry.lastPosture = computePosture(handle.id);

    // SP-B — observer hook for UI mirrors (status-bar pill).
    if (opts.onRegister) { try { opts.onRegister(handle); } catch { /* isolate */ } }
    // B-10-α — emit on the multi-subscriber bus (SurfaceRegistry bridge,
    // skill-runner telemetry, test spies). Fires after SP-B so the pill
    // is updated first; bus consumers see the same ordering.
    emit({ kind: 'register', handle });
  };

  const unregister = (id: string) => {
    const e = entries.get(id);
    if (!e) return;
    cancelTimers(e);
    for (const u of e.unsubs) { try { u(); } catch { /* ignore */ } }
    // PR-1 — emit a final posture-changed (next=null) before removing
    // so subscribers see the entry leave with a clean signal rather
    // than just disappearing.
    if (e.lastPosture !== null) {
      emitPosture({ kind: 'posture-changed', shellId: id, prev: e.lastPosture, next: null });
      e.lastPosture = null;
    }
    for (const { unsubInner } of e.surfaces) {
      if (unsubInner) { try { unsubInner(); } catch { /* ignore */ } }
    }
    e.surfaces = [];
    entries.delete(id);
    if (opts.onUnregister) { try { opts.onUnregister(id); } catch { /* isolate */ } }
    emit({ kind: 'unregister', id });
  };

  const subscribe = (cb: ShellRegistrySubscriber): Unsubscribe => {
    subs.add(cb);
    return () => { subs.delete(cb); };
  };

  const subscribePosture = (cb: ShellPostureSubscriber): Unsubscribe => {
    postureSubs.add(cb);
    return () => { postureSubs.delete(cb); };
  };

  const attachSurface = (id: string, surface: ShellSurface): Unsubscribe => {
    const e = entries.get(id);
    if (!e) {
      // Handle no longer registered — return a no-op unsubscribe
      // rather than throwing. Caller may have lost the race with
      // unregister; surface will be garbage-collected normally.
      if (debug.enabled) {
        debug.log('shell.surface.attach.miss', id, { kind: surface.kind });
      }
      return () => { /* noop */ };
    }
    const slot: { surface: ShellSurface; unsubInner?: () => void } = { surface };
    if (surface.onPostureChanged) {
      slot.unsubInner = surface.onPostureChanged(() => {
        refreshPosture(id);
      });
    }
    e.surfaces.push(slot);
    if (debug.enabled) {
      debug.log('shell.surface.attach', id, {
        kind: surface.kind,
        surfaceCount: e.surfaces.length,
      });
    }
    refreshPosture(id);
    return () => {
      const ent = entries.get(id);
      if (!ent) return;
      const idx = ent.surfaces.indexOf(slot);
      if (idx === -1) return;
      ent.surfaces.splice(idx, 1);
      if (slot.unsubInner) { try { slot.unsubInner(); } catch { /* ignore */ } }
      if (debug.enabled) {
        debug.log('shell.surface.detach', id, {
          kind: surface.kind,
          surfaceCount: ent.surfaces.length,
        });
      }
      refreshPosture(id);
    };
  };

  const describePosture = (id: string): TerminalExposureSnapshot | null => {
    return computePosture(id);
  };

  const listWithPosture = (filter?: ShellListFilter) => {
    return list(filter).map((handle) => ({
      handle,
      posture: computePosture(handle.id),
    }));
  };

  const get = (id: string) => entries.get(id)?.handle ?? null;

  const list = (filter?: ShellListFilter) => {
    const out: ShellHandle[] = [];
    const tNow = now();
    const includeSettled = filter?.includeSettled === true;
    // Explicit status filter — user asked for that status, so don't
    // also hide settled ones (otherwise `list({status:'completed'})`
    // would be perpetually empty, which is surprising).
    const statusRequested = filter?.status !== undefined;
    for (const entry of entries.values()) {
      const handle = entry.handle;
      if (filter?.status && handle.status !== filter.status) continue;
      if (filter?.mode && handle.mode !== filter.mode) continue;
      if (!includeSettled && !statusRequested
          && entry.settledAt !== undefined
          && tNow - entry.settledAt >= settledTtlMs) {
        continue;
      }
      out.push(handle);
    }
    return out;
  };

  const findVwRunner = (label: string = DEFAULT_VW_RUNNER_LABEL) => {
    for (const e of entries.values()) {
      if (e.vwLabel === label && e.handle.status !== 'completed' && e.handle.status !== 'killed') {
        return e.handle;
      }
    }
    return null;
  };

  const tagVwRunner = (id: string, label: string) => {
    const e = entries.get(id);
    if (e) e.vwLabel = label;
  };

  const getVwLabel = (id: string) => entries.get(id)?.vwLabel ?? null;

  const size = () => entries.size;

  const dispose = () => {
    for (const e of entries.values()) {
      cancelTimers(e);
      for (const u of e.unsubs) { try { u(); } catch { /* ignore */ } }
      for (const { unsubInner } of e.surfaces) {
        if (unsubInner) { try { unsubInner(); } catch { /* ignore */ } }
      }
      e.surfaces = [];
    }
    entries.clear();
    subs.clear();
    postureSubs.clear();
  };

  return {
    register, unregister, get, list, findVwRunner, tagVwRunner, getVwLabel,
    size, dispose, subscribe,
    attachSurface, describePosture, listWithPosture, subscribePosture,
  };
}

// ── Process-wide singleton ────────────────────────────────────────

let singleton: ShellRegistry | null = null;

export function initShellRegistry(opts?: ShellRegistryOpts): ShellRegistry {
  if (singleton) singleton.dispose();
  singleton = createShellRegistry(opts);
  return singleton;
}

export function getShellRegistry(): ShellRegistry {
  if (!singleton) singleton = createShellRegistry();
  return singleton;
}

export function resetShellRegistry(): void {
  singleton?.dispose();
  singleton = null;
}

/** Exposed for tests that want to assert "singleton is clean". */
export function _peekSingleton(): ShellRegistry | null {
  return singleton;
}

/** Re-export the mode enum narrow types for callers constructing
 *  filters. Avoids forcing consumers to also import from types.js. */
export type { ShellMode, ShellStatus };
