import { describe, expect, test } from 'bun:test';

import { DisplayCoordinator } from '../src/display/coordinator.js';

describe('U4 · workspaceHostAPI()', () => {
  test('returns a stable handle across calls', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    expect(coord.workspaceHostAPI()).toBe(coord.workspaceHostAPI());
  });

  test('workspace host stores grouped popup metadata without touching modal stack', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    coord.workspaceHostAPI().ensureWorkspace({ id: 'ws-main', layoutMode: 'grid' });
    coord.workspaceHostAPI().upsertMember('ws-main', { surfaceId: 'popup:model', kind: 'popup', order: 1 });
    coord.workspaceHostAPI().upsertMember('ws-main', { surfaceId: 'popup:mode', kind: 'popup', order: 2 });
    expect(coord.workspaceHostAPI().getWorkspace('ws-main')).toEqual({
      id: 'ws-main',
      layoutMode: 'grid',
      focusedMemberId: 'popup:model',
      members: [
        { surfaceId: 'popup:model', kind: 'popup', order: 1 },
        { surfaceId: 'popup:mode', kind: 'popup', order: 2 },
      ],
    });
    expect(coord.modalStack()).toEqual([]);
  });
});
