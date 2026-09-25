import { describe, expect, test } from 'bun:test';

import { composeWorkspaceHostHooks } from '../src/display/workspace-host-wiring.js';
import { createWorkspaceHost } from '../src/display/workspace-host.js';
import type { DisplayHooks, DisplaySurface } from '../src/display/types.js';

function makeModal(id: string, tier: DisplaySurface['tier'], priority = 100): DisplaySurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority,
    ...(tier !== undefined ? { tier } : {}),
    render: () => [],
  };
}

function makePane(id: string): DisplaySurface {
  return {
    id,
    kind: 'pane',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
  };
}

describe('workspace-host wiring', () => {
  test('default wiring groups popup/dialog/terminal modals into dashboard-main', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, { host });
    hooks.onSurfaceMounted!(makeModal('popup:model', 'popup', 210));
    hooks.onSurfaceMounted!(makeModal('dialog:approval', 'dialog', 220));
    hooks.onSurfaceMounted!(makeModal('term:1', 'terminal', 230));
    expect(host.getWorkspace('dashboard-main')).toEqual({
      id: 'dashboard-main',
      layoutMode: 'stack',
      focusedMemberId: 'popup:model',
      members: [
        { surfaceId: 'popup:model', kind: 'popup', order: 210 },
        { surfaceId: 'dialog:approval', kind: 'dialog', order: 220 },
        { surfaceId: 'term:1', kind: 'terminal', order: 230 },
      ],
    });
  });

  test('non-modal surfaces are ignored by default', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, { host });
    hooks.onSurfaceMounted!(makePane('pane:left'));
    expect(host.listWorkspaces()).toEqual([]);
  });

  test('disposing a wired surface removes it from the workspace', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, { host });
    const modal = makeModal('popup:model', 'popup', 210);
    hooks.onSurfaceMounted!(modal);
    hooks.onSurfaceDisposed!(modal);
    expect(host.getWorkspace('dashboard-main')).toEqual({
      id: 'dashboard-main',
      layoutMode: 'stack',
      focusedMemberId: null,
      members: [],
    });
  });

  test('disposing a minimized+docked surface preserves it as a dock entry', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, { host });
    const modal = makeModal('popup:model', 'popup', 210);
    hooks.onSurfaceMounted!(modal);
    host.minimizeMember('dashboard-main', 'popup:model', { docked: true });
    hooks.onSurfaceDisposed!(modal);
    expect(host.getWorkspace('dashboard-main')).toEqual({
      id: 'dashboard-main',
      layoutMode: 'stack',
      focusedMemberId: null,
      members: [{
        surfaceId: 'popup:model',
        kind: 'popup',
        order: 210,
        minimized: true,
        docked: true,
      }],
    });
  });

  test('focus changes update the workspace focused member', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, { host });
    hooks.onSurfaceMounted!(makeModal('a', 'popup', 10));
    hooks.onSurfaceMounted!(makeModal('b', 'dialog', 20));
    hooks.onFocusChanged!(null, 'b', 'mount');
    expect(host.getWorkspace('dashboard-main')!.focusedMemberId).toBe('b');
  });

  test('custom workspaceIdOf/memberOf can shard surfaces across multiple workspaces', () => {
    const host = createWorkspaceHost();
    const hooks = composeWorkspaceHostHooks({}, {
      host,
      workspaceIdOf: (surface) => surface.id.startsWith('left:') ? 'left' : 'right',
      layoutModeOf: (surface) => surface.id.startsWith('left:') ? 'columns' : 'rows',
      memberOf: (surface) => ({
        surfaceId: surface.id,
        kind: 'popup',
        order: surface.priority,
      }),
    });
    hooks.onSurfaceMounted!(makeModal('left:1', 'popup', 10));
    hooks.onSurfaceMounted!(makeModal('right:1', 'popup', 20));
    expect(host.getWorkspace('left')).toEqual({
      id: 'left',
      layoutMode: 'columns',
      focusedMemberId: 'left:1',
      members: [{ surfaceId: 'left:1', kind: 'popup', order: 10 }],
    });
    expect(host.getWorkspace('right')).toEqual({
      id: 'right',
      layoutMode: 'rows',
      focusedMemberId: 'right:1',
      members: [{ surfaceId: 'right:1', kind: 'popup', order: 20 }],
    });
  });

  test('base hooks still fire alongside workspace wiring', () => {
    const host = createWorkspaceHost();
    const mounted: string[] = [];
    const focused: string[] = [];
    const base: DisplayHooks = {
      onSurfaceMounted: (surface) => mounted.push(surface.id),
      onFocusChanged: (_prev, next) => focused.push(next),
    };
    const hooks = composeWorkspaceHostHooks(base, { host });
    hooks.onSurfaceMounted!(makeModal('popup:model', 'popup'));
    hooks.onFocusChanged!(null, 'popup:model', 'mount');
    expect(mounted).toEqual(['popup:model']);
    expect(focused).toEqual(['popup:model']);
  });
});
