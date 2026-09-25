// ─────────────────────────────────────────────────────────────────
// LayerTree Primitive — LayerHandle
// · H1.2 of PLAN-compositor-w1-layer-tree.md · ROADMAP §4.1 H1.2
//
// Branded handle issued by LayerTree.addLayer. Bundles the layer id
// with a generation counter so a dispose+re-add cycle produces a
// distinct handle — stale handles from the previous mount return
// isDisposed === true instead of silently operating on the new layer.
//
// Design pattern ported from:
// - AppCUI-rs `handle.rs:19-96` Handle<T> = arena idx + generation
// - ModalLifecycle primitive (B-series · PR #266/#269)
// - FocusManager primitive (F-series · PR #284)
//
// TC39 Explicit Resource Management (`using handle = tree.addLayer(...)`)
// is wired via `Symbol.dispose` so callers can scope the lifetime
// lexically without an explicit `handle.dispose()`.
// ─────────────────────────────────────────────────────────────────

import type { LayerId } from './index.js';

export interface LayerHandle {
  readonly id: LayerId;
  readonly generation: number;
  isDisposed(): boolean;
  dispose(): void;
  [Symbol.dispose](): void;
}

/** Internal factory — only LayerTree impl should call this. The
 *  disposer callback owns the actual removal; handle just tracks
 *  whether dispose already ran (idempotent from caller's side). */
export function createLayerHandle(
  id: LayerId,
  generation: number,
  doDispose: () => void,
): LayerHandle {
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    doDispose();
  };
  return {
    id,
    generation,
    isDisposed: () => disposed,
    dispose,
    [Symbol.dispose]: dispose,
  };
}
