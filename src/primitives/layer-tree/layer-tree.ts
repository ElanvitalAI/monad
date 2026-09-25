// ─────────────────────────────────────────────────────────────────
// LayerTree Primitive — reference impl
// · H1.2 of PLAN-compositor-w1-layer-tree.md
//
// Owned primitive — the LayerTree instance is the source of truth for
// layer nodes, parent-child relations, z-order, and mutation events.
// Coordinator.ts (H1.3) will attach as an observer that mirrors into
// its existing modal stack during a stability window. External
// callers do NOT reach into coordinator state for layer queries once
// the attach lands.
//
// Contract spec lives in 내부 문서 `PLAN-compositor-w1-layer-tree` §3.
// Design convergence points — see ROADMAP §2.2 · RESEARCH §W1:
//   - Wayland wl_surface + wl_subsurface tree
//   - Android SurfaceFlinger layer tree
//   - Flutter RenderObject tree + Layer subclass
//   - Notcurses ncplane pile
//   - Chromium LayerTreeHost + property trees
//
// This module is pure (no I/O, no timers). All state lives behind
// the returned LayerTree handle; two trees are independent.
// ─────────────────────────────────────────────────────────────────

import type {
  LayerId,
  LayerNode,
  LayerSpec,
  LayerHandle,
  LayerTree,
  LayerTreeDebugSnapshot,
  LayerTreeEvent,
  LayerTreeEventKind,
  LayerTreeEventListener,
  Rect,
} from './index.js';
import { createLayerHandle } from './handle.js';
import { sortLayersByZ } from './z-order.js';

/** Mutable internal record. LayerNode (public) is built on demand
 *  from this so callers never see a reference that mutates under
 *  them — aligns with ModalLifecycle's immutable-snapshot contract. */
interface LayerRecord {
  id: LayerId;
  generation: number;
  bounds: Rect;
  zTier: LayerSpec['zTier'];
  zIndex: number;
  opacity: number;
  opaque: boolean;
  clip?: Rect;
  parent: LayerId | null;
  children: LayerId[];
  /** W3 (H2.1) — subtree isolation flag. Spec 의 undefined 는 false
   *  로 normalize · snapshot 은 항상 concrete boolean 반환. */
  repaintBoundary: boolean;
  /** Monotonic insertion index — tie-break for sortLayersByZ. */
  insertionOrder: number;
}

export function createLayerTree(): LayerTree {
  const layers = new Map<LayerId, LayerRecord>();
  const listeners = new Map<LayerTreeEventKind, Set<LayerTreeEventListener>>();
  let nextGeneration = 0;
  let insertionCounter = 0;

  function snapshot(rec: LayerRecord): LayerNode {
    return {
      id: rec.id,
      generation: rec.generation,
      bounds: rec.bounds,
      zTier: rec.zTier,
      zIndex: rec.zIndex,
      opacity: rec.opacity,
      opaque: rec.opaque,
      clip: rec.clip,
      parent: rec.parent,
      children: [...rec.children],
      repaintBoundary: rec.repaintBoundary,
    };
  }

  function emit(kind: LayerTreeEventKind, layerId: LayerId, generation: number, reason?: LayerTreeEvent['reason']): void {
    const set = listeners.get(kind);
    if (!set || set.size === 0) return;
    const ev: LayerTreeEvent = { kind, layerId, reason, generation };
    for (const cb of set) {
      try { cb(ev); }
      catch {
        // Per §3.5 invariant — one broken listener must not block
        // siblings. Swallow silently; debug.log is out of scope for
        // a pure primitive module.
      }
    }
  }

  function emitWithPayload(
    kind: LayerTreeEventKind,
    layerId: LayerId,
    generation: number,
    reason: LayerTreeEvent['reason'],
    extra: Pick<LayerTreeEvent, 'previousBounds' | 'currentBounds'>,
  ): void {
    const set = listeners.get(kind);
    if (!set || set.size === 0) return;
    const ev: LayerTreeEvent = { kind, layerId, reason, generation, ...extra };
    for (const cb of set) {
      try { cb(ev); }
      catch {
        // Per §3.5 invariant — one broken listener must not block
        // siblings. Swallow silently; debug.log is out of scope for
        // a pure primitive module.
      }
    }
  }

  function addLayer(spec: LayerSpec): LayerHandle {
    if (layers.has(spec.id)) {
      throw new Error(`LayerTree.addLayer · id '${spec.id}' already mounted · dispose previous handle first`);
    }
    if (spec.parent && !layers.has(spec.parent)) {
      throw new Error(`LayerTree.addLayer · parent '${spec.parent}' not mounted`);
    }
    const generation = nextGeneration++;
    const rec: LayerRecord = {
      id: spec.id,
      generation,
      bounds: spec.bounds,
      zTier: spec.zTier,
      zIndex: spec.zIndex ?? 0,
      opacity: spec.opacity ?? 1,
      opaque: spec.opaque ?? false,
      clip: spec.clip,
      parent: spec.parent ?? null,
      children: [],
      repaintBoundary: spec.repaintBoundary ?? false,
      insertionOrder: insertionCounter++,
    };
    layers.set(spec.id, rec);
    if (rec.parent) {
      const parentRec = layers.get(rec.parent);
      if (parentRec) parentRec.children.push(spec.id);
    }
    emit('added', spec.id, generation);
    return createLayerHandle(spec.id, generation, () => {
      doRemove(spec.id, generation);
    });
  }

  function doRemove(id: LayerId, expectedGeneration: number): void {
    const rec = layers.get(id);
    if (!rec) return;  // already removed
    if (rec.generation !== expectedGeneration) return;  // stale handle
    const previousBounds = rec.bounds;
    // Re-parent children to root (default policy · PLAN §5.3).
    for (const childId of rec.children) {
      const child = layers.get(childId);
      if (child) child.parent = null;
    }
    if (rec.parent) {
      const parent = layers.get(rec.parent);
      if (parent) {
        const idx = parent.children.indexOf(id);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
    }
    layers.delete(id);
    emitWithPayload('removed', id, expectedGeneration, 'dispose', {
      previousBounds,
      currentBounds: undefined,
    });
  }

  function removeLayer(id: LayerId): void {
    const rec = layers.get(id);
    if (!rec) return;  // idempotent
    doRemove(id, rec.generation);
  }

  function moveLayer(id: LayerId, zIndex: number): void {
    const rec = layers.get(id);
    if (!rec) throw new Error(`LayerTree.moveLayer · id '${id}' not mounted`);
    if (rec.zIndex === zIndex) return;  // no-op, no event
    rec.zIndex = zIndex;
    emit('moved', id, rec.generation, 'zIndex');
  }

  function setParent(id: LayerId, parent: LayerId | null): void {
    const rec = layers.get(id);
    if (!rec) throw new Error(`LayerTree.setParent · id '${id}' not mounted`);
    if (parent === id) throw new Error(`LayerTree.setParent · self-parent not allowed · id '${id}'`);
    if (parent !== null) {
      const newParent = layers.get(parent);
      if (!newParent) throw new Error(`LayerTree.setParent · parent '${parent}' not mounted`);
      // Cycle detection: walk up from `parent`; if we hit `id`, cycle.
      let probe: LayerId | null = parent;
      while (probe !== null) {
        if (probe === id) {
          throw new Error(`LayerTree.setParent · cycle detected · '${id}' is an ancestor of '${parent}'`);
        }
        const probeRec = layers.get(probe);
        probe = probeRec?.parent ?? null;
      }
    }
    if (rec.parent === parent) return;  // no-op
    // Detach from old parent.
    if (rec.parent) {
      const oldParent = layers.get(rec.parent);
      if (oldParent) {
        const idx = oldParent.children.indexOf(id);
        if (idx >= 0) oldParent.children.splice(idx, 1);
      }
    }
    // Attach to new parent.
    rec.parent = parent;
    if (parent !== null) {
      const newParent = layers.get(parent)!;
      newParent.children.push(id);
    }
    emit('moved', id, rec.generation, 'parent');
  }

  function setBounds(id: LayerId, bounds: Rect): void {
    const rec = layers.get(id);
    if (!rec) throw new Error(`LayerTree.setBounds · id '${id}' not mounted`);
    const previousBounds = rec.bounds;
    if (
      previousBounds.row === bounds.row
      && previousBounds.col === bounds.col
      && previousBounds.width === bounds.width
      && previousBounds.height === bounds.height
    ) {
      return;
    }
    rec.bounds = bounds;
    emitWithPayload('dirty', id, rec.generation, 'bounds', {
      previousBounds,
      currentBounds: bounds,
    });
  }

  function setOpacity(id: LayerId, opacity: number): void {
    const rec = layers.get(id);
    if (!rec) throw new Error(`LayerTree.setOpacity · id '${id}' not mounted`);
    rec.opacity = opacity;
    emit('dirty', id, rec.generation, 'opacity');
  }

  function setRepaintBoundary(id: LayerId, flag: boolean): void {
    const rec = layers.get(id);
    if (!rec) throw new Error(`LayerTree.setRepaintBoundary · id '${id}' not mounted`);
    if (rec.repaintBoundary === flag) return;  // no-op · same value
    rec.repaintBoundary = flag;
    emit('dirty', id, rec.generation, 'repaintBoundary');
  }

  function getLayer(id: LayerId): LayerNode | undefined {
    const rec = layers.get(id);
    return rec ? snapshot(rec) : undefined;
  }

  function pathTo(id: LayerId): readonly LayerNode[] {
    const rec = layers.get(id);
    if (!rec) return [];
    const path: LayerNode[] = [];
    let cur: LayerRecord | undefined = rec;
    while (cur) {
      path.unshift(snapshot(cur));
      cur = cur.parent ? layers.get(cur.parent) : undefined;
    }
    return path;
  }

  function sortedByZ(): readonly LayerNode[] {
    const snapshots = [...layers.values()].map(snapshot);
    return sortLayersByZ(snapshots);
  }

  function roots(): readonly LayerNode[] {
    const out: LayerNode[] = [];
    for (const rec of layers.values()) {
      if (rec.parent === null) out.push(snapshot(rec));
    }
    return out;
  }

  function on(kind: LayerTreeEventKind, cb: LayerTreeEventListener): () => void {
    let set = listeners.get(kind);
    if (!set) { set = new Set(); listeners.set(kind, set); }
    set.add(cb);
    return () => {
      const s = listeners.get(kind);
      if (s) s.delete(cb);
    };
  }

  function debug(): LayerTreeDebugSnapshot {
    let listenerCount = 0;
    for (const s of listeners.values()) listenerCount += s.size;
    return {
      layerCount: layers.size,
      nextGeneration,
      listenerCount,
    };
  }

  return {
    addLayer,
    removeLayer,
    moveLayer,
    setParent,
    setBounds,
    setOpacity,
    setRepaintBoundary,
    getLayer,
    pathTo,
    sortedByZ,
    roots,
    on,
    debug,
  };
}
