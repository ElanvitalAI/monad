import { describe, expect, test } from 'bun:test';

import { DisplayCoordinator } from '../src/display/coordinator.js';
import { composeIdentityHooks } from '../src/display/modal-identity-wiring.js';
import { composeWorkspaceHostHooks } from '../src/display/workspace-host-wiring.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function modal(
  id: string,
  opts: { tier?: ModalSurface['tier']; priority?: number } = {},
): ModalSurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: opts.priority ?? 200,
    tier: opts.tier,
    bounds: { row: 1, col: 1, width: 10, height: 4 },
    render: () => [],
    paint: () => '',
  };
}

describe('U4 adoption · identity hooks + workspace hooks', () => {
  test('mounted popup/dialog/terminal modals populate dashboard-main workspace through composed hooks', () => {
    const hooks = composeWorkspaceHostHooks(composeIdentityHooks());
    const coord = new DisplayCoordinator({ frameMs: 0, hooks });

    coord.pushModal(modal('popup:model', { tier: 'popup', priority: 210 }));
    coord.pushModal(modal('dialog:approval', { tier: 'dialog', priority: 220 }));
    coord.pushModal(modal('term:1', { tier: 'terminal', priority: 230 }));

    expect(hooks.host.getWorkspace('dashboard-main')).toEqual({
      id: 'dashboard-main',
      layoutMode: 'stack',
      focusedMemberId: 'term:1',
      members: [
        { surfaceId: 'popup:model', kind: 'popup', order: 210 },
        { surfaceId: 'dialog:approval', kind: 'dialog', order: 220 },
        { surfaceId: 'term:1', kind: 'terminal', order: 230 },
      ],
    });
  });

  test('popup with explicit ownerWorkspaceId adopts that workspace instead of dashboard-main', () => {
    const hooks = composeWorkspaceHostHooks(composeIdentityHooks());
    const coord = new DisplayCoordinator({ frameMs: 0, hooks });

    coord.pushModal({
      ...modal('popup:vw-owned', { tier: 'popup', priority: 210 }),
      ownerWorkspaceId: 'virtual-window:2',
    });

    expect(hooks.host.getWorkspace('virtual-window:2')).toEqual({
      id: 'virtual-window:2',
      layoutMode: 'stack',
      focusedMemberId: 'popup:vw-owned',
      members: [
        { surfaceId: 'popup:vw-owned', kind: 'popup', order: 210 },
      ],
    });
    expect(hooks.host.getWorkspace('dashboard-main')).toBeUndefined();
  });

  test('disposing a modal through coordinator removes it from the composed workspace host', () => {
    const hooks = composeWorkspaceHostHooks(composeIdentityHooks());
    const coord = new DisplayCoordinator({ frameMs: 0, hooks });

    const handle = coord.pushModal(modal('popup:model', { tier: 'popup', priority: 210 }));
    expect(hooks.host.getWorkspace('dashboard-main')!.members).toHaveLength(1);
    handle.dispose();
    expect(hooks.host.getWorkspace('dashboard-main')).toEqual({
      id: 'dashboard-main',
      layoutMode: 'stack',
      focusedMemberId: null,
      members: [],
    });
  });
});
