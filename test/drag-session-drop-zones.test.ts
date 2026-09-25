import { describe, expect, test } from 'bun:test';
import { registerDropZones } from '../src/drag-session-drop-zones.js';
import {
  createDragManager,
  type DropTarget,
} from '../src/primitives/drag-session/index.js';
import type { SurfaceId } from '../src/display/types.js';

function zone(surfaceId: string, acceptKinds: readonly string[]): DropTarget {
  return {
    surfaceId: surfaceId as SurfaceId,
    acceptKinds,
    onDrop() {
      return { type: 'cancelled', reason: 'test' };
    },
  };
}

describe('R8f · registerDropZones helper', () => {
  test('registers every drop zone with the manager', () => {
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    registerDropZones(manager, [
      zone('input::chat-main', ['file-path[]']),
      zone('wd-scratch', ['file-path[]']),
    ]);

    const targets = manager.targetsFor(['file-path[]']);
    expect(targets.map((t) => String(t.surfaceId)).sort()).toEqual([
      'input::chat-main',
      'wd-scratch',
    ]);
  });

  test('returned disposer unregisters all zones and is idempotent', () => {
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    const dispose = registerDropZones(manager, [
      zone('input::chat-main', ['file-path[]']),
      zone('wd-scratch', ['file-path[]']),
    ]);

    dispose();
    dispose();

    expect(manager.targetsFor(['file-path[]'])).toHaveLength(0);
  });
});
