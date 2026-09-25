import type { DragManager, DropTarget } from './primitives/drag-session/index.js';

export function registerDropZones(
  manager: DragManager,
  dropZones: readonly DropTarget[],
): () => void {
  const disposers = dropZones.map((zone) => manager.registerTarget(zone));
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers) {
      try { dispose(); } catch { /* swallow */ }
    }
  };
}
