// ─────────────────────────────────────────────────────────────────
// RenderCoordinator Primitive — reference impl
// · H1.5 of PLAN-compositor-w2-render-coordinator.md
//
// Pure module. Owns dirty queue + frame boundary events. Caller
// handles actual paint (subscribe to 'before-flush') and any stdout
// writes (DECSET 2026 wrap is a coord-level concern at H1.6).
//
// Re-entry semantics:
//   - flush() snapshots the dirty queue at entry, clears the live
//     queue, then fires events. A markNeedsPaint from inside a
//     subscriber accumulates on the NEW (empty) queue and lands in
//     the next frame. This matches Flutter's PipelineOwner behavior
//     where mid-flush dirty marks schedule a follow-up frame.
// ─────────────────────────────────────────────────────────────────

import type {
  DirtyEntry,
  LayerId,
  Rect,
  RenderCoordinator,
  RenderCoordinatorDebugSnapshot,
  RenderCoordinatorEvent,
  RenderCoordinatorEventKind,
  RenderCoordinatorEventListener,
  RenderCoordinatorOptions,
} from './index.js';

/** Internal mutable record · transformed to DirtyEntry snapshot on
 *  emit / getDirtyRegions call. */
interface DirtyRecord {
  layerId: LayerId;
  regions: Rect[];
}

export function createRenderCoordinator(opts: RenderCoordinatorOptions = {}): RenderCoordinator {
  const schedule = opts.schedule;
  const listeners = new Map<RenderCoordinatorEventKind, Set<RenderCoordinatorEventListener>>();
  let dirty = new Map<LayerId, DirtyRecord>();
  let frameCount = 0;
  let pendingRequestFrame = false;
  let cancelScheduled: (() => void) | null = null;

  function snapshotEntries(source: Map<LayerId, DirtyRecord>): DirtyEntry[] {
    const out: DirtyEntry[] = [];
    for (const rec of source.values()) {
      out.push({ layerId: rec.layerId, regions: [...rec.regions] });
    }
    return out;
  }

  function emit(kind: RenderCoordinatorEventKind, entries: readonly DirtyEntry[]): void {
    const set = listeners.get(kind);
    if (!set || set.size === 0) return;
    const ev: RenderCoordinatorEvent = { kind, entries, frameCount };
    for (const cb of set) {
      try { cb(ev); }
      catch {
        // Per §3.5 invariant — listener isolation. Swallow silently.
      }
    }
  }

  /** Rect equality — structural compare on 4 numeric fields. Used by
   *  markNeedsPaint to de-duplicate an exact repeat. */
  function sameRect(a: Rect, b: Rect): boolean {
    return a.row === b.row && a.col === b.col && a.width === b.width && a.height === b.height;
  }

  function markNeedsPaint(layerId: LayerId, region?: Rect): void {
    let rec = dirty.get(layerId);
    if (!rec) {
      rec = { layerId, regions: [] };
      dirty.set(layerId, rec);
    }
    if (region !== undefined) {
      // De-dupe exact repeats; preserve insertion order otherwise.
      const already = rec.regions.some((r) => sameRect(r, region));
      if (!already) rec.regions.push(region);
    }
    // Fire event with current accumulated snapshot so subscribers can
    // react incrementally if they wish (W4 DamageRegion · dashboard
    // status badge etc.).
    emit('dirty-added', snapshotEntries(dirty));
  }

  function requestFrame(): void {
    if (pendingRequestFrame) return;
    pendingRequestFrame = true;
    if (schedule) {
      const cancel = schedule(() => {
        cancelScheduled = null;
        flush();
      });
      if (typeof cancel === 'function') {
        cancelScheduled = cancel;
      } else {
        cancelScheduled = null;
      }
    } else {
      // Default: synchronous — flush immediately. Matches "no-frame"
      // semantics useful for tests + REPL usage.
      flush();
    }
  }

  function flush(): void {
    // Any scheduled cancel hook is no longer needed — either we are
    // *inside* the scheduled callback, or the caller invoked flush()
    // directly and we should drop the pending schedule.
    if (cancelScheduled) {
      try { cancelScheduled(); }
      catch { /* best-effort; don't break the frame */ }
      cancelScheduled = null;
    }
    pendingRequestFrame = false;
    if (dirty.size === 0) return;  // no-op flush: no events, no bump
    // Re-entry guard: snapshot the queue at entry, clear the live
    // queue, then emit. Any markNeedsPaint from inside subscribers
    // lands on the fresh queue and will be picked up on the next
    // flush (Flutter PipelineOwner behavior).
    const flushingEntries = snapshotEntries(dirty);
    const nextDirty = new Map<LayerId, DirtyRecord>();
    dirty = nextDirty;
    frameCount += 1;
    emit('before-flush', flushingEntries);
    emit('after-flush', flushingEntries);
  }

  function isDirty(): boolean {
    return dirty.size > 0;
  }

  function getDirtyRegions(layerId: LayerId): readonly Rect[] | undefined {
    const rec = dirty.get(layerId);
    if (!rec) return undefined;
    return [...rec.regions];
  }

  function on(kind: RenderCoordinatorEventKind, cb: RenderCoordinatorEventListener): () => void {
    let set = listeners.get(kind);
    if (!set) { set = new Set(); listeners.set(kind, set); }
    set.add(cb);
    return () => {
      const s = listeners.get(kind);
      if (s) s.delete(cb);
    };
  }

  function debug(): RenderCoordinatorDebugSnapshot {
    let listenerCount = 0;
    for (const s of listeners.values()) listenerCount += s.size;
    return {
      dirtyLayerCount: dirty.size,
      frameCount,
      pendingRequestFrame,
      listenerCount,
    };
  }

  return {
    markNeedsPaint,
    requestFrame,
    flush,
    isDirty,
    getDirtyRegions,
    on,
    debug,
  };
}
