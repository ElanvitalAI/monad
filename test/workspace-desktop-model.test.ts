import { describe, expect, test } from 'bun:test';

import { createWorkspaceHost } from '../src/display/workspace-host.js';
import {
  buildWorkspaceDesktopModel,
  buildWorkspaceDesktopModelFromHost,
  summarizeWorkspaceDesktopShell,
} from '../src/display/workspace-desktop-model.js';

describe('workspace desktop model', () => {
  test('partitions workspace members into live, dock, and dormant buckets', () => {
    const host = createWorkspaceHost();
    host.ensureWorkspace({ id: 'dashboard-main', label: 'Dashboard', layoutMode: 'desktop' });
    host.upsertMember('dashboard-main', {
      surfaceId: 'popup:model',
      kind: 'popup',
      label: 'Model',
      order: 10,
    });
    host.upsertMember('dashboard-main', {
      surfaceId: 'dialog:approval',
      kind: 'dialog',
      label: 'Approval',
      order: 20,
      minimized: true,
      docked: true,
    });
    host.upsertMember('dashboard-main', {
      surfaceId: 'popup:search',
      kind: 'popup',
      order: 30,
      minimized: true,
    });
    host.setFocusedMember('dashboard-main', 'popup:model');

    const model = buildWorkspaceDesktopModelFromHost(host, 'dashboard-main')!;
    expect(model.workspaceId).toBe('dashboard-main');
    expect(model.layoutMode).toBe('desktop');
    expect(model.liveEntries.map((entry) => entry.surfaceId)).toEqual(['popup:model']);
    expect(model.dockEntries.map((entry) => entry.surfaceId)).toEqual(['dialog:approval']);
    expect(model.dormantEntries.map((entry) => entry.surfaceId)).toEqual(['popup:search']);
    expect(model.counts).toEqual({
      total: 3,
      live: 1,
      parked: 2,
      docked: 1,
      dormant: 1,
    });
    expect(model.parkedEntries.map((entry) => entry.surfaceId)).toEqual([
      'dialog:approval',
      'popup:search',
    ]);
  });

  test('entry labels fall back to surfaceId and focused flag is projected', () => {
    const model = buildWorkspaceDesktopModel({
      id: 'ws-a',
      layoutMode: 'stack',
      focusedMemberId: 'popup:1',
      members: [
        { surfaceId: 'popup:1', kind: 'popup', order: 1 },
        { surfaceId: 'popup:2', kind: 'popup', order: 2, minimized: true, docked: true },
      ],
    });
    expect(model.liveEntries[0]).toEqual({
      surfaceId: 'popup:1',
      kind: 'popup',
      label: 'popup:1',
      order: 1,
      focused: true,
      minimized: false,
      docked: false,
    });
    expect(model.dockEntries[0]?.focused).toBe(false);
  });

  test('focused live entry sorts first and shell summary reuses parked entries', () => {
    const model = buildWorkspaceDesktopModel({
      id: 'ws-b',
      layoutMode: 'desktop',
      focusedMemberId: 'popup:2',
      members: [
        { surfaceId: 'popup:1', kind: 'popup', label: 'One', order: 20 },
        { surfaceId: 'popup:2', kind: 'popup', label: 'Two', order: 30 },
        { surfaceId: 'popup:3', kind: 'popup', label: 'Three', order: 10, minimized: true },
      ],
    });
    expect(model.liveEntries.map((entry) => entry.surfaceId)).toEqual(['popup:2', 'popup:1']);
    expect(summarizeWorkspaceDesktopShell(model)).toEqual({
      parkedCount: 1,
      dockedCount: 0,
      dormantCount: 1,
      leadLabel: 'Three',
    });
  });

  test('shell summary handles null model', () => {
    expect(summarizeWorkspaceDesktopShell(null)).toEqual({
      parkedCount: 0,
      dockedCount: 0,
      dormantCount: 0,
      leadLabel: null,
    });
  });

  test('returns null when workspace is absent', () => {
    const host = createWorkspaceHost();
    expect(buildWorkspaceDesktopModelFromHost(host, 'missing')).toBeNull();
  });
});
