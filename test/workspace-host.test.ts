import { describe, expect, test } from 'bun:test';

import { createWorkspaceHost } from '../src/display/workspace-host.js';

describe('WorkspaceHost', () => {
  test('ensureWorkspace creates and updates workspace metadata', () => {
    const host = createWorkspaceHost();
    expect(host.ensureWorkspace({ id: 'ws-a', label: 'Alpha' })).toEqual({
      id: 'ws-a',
      label: 'Alpha',
      layoutMode: 'stack',
      focusedMemberId: null,
      members: [],
    });
    expect(host.ensureWorkspace({ id: 'ws-a', layoutMode: 'grid', softCap: 4 })).toEqual({
      id: 'ws-a',
      label: 'Alpha',
      layoutMode: 'grid',
      softCap: 4,
      focusedMemberId: null,
      members: [],
    });
  });

  test('upsertMember creates workspace on demand and focuses first member', () => {
    const host = createWorkspaceHost();
    const ws = host.upsertMember('ws-a', { surfaceId: 'popup:1', kind: 'popup', order: 2 });
    expect(ws.focusedMemberId).toBe('popup:1');
    expect(ws.members).toEqual([{ surfaceId: 'popup:1', kind: 'popup', order: 2 }]);
  });

  test('members stay sorted by order then surfaceId', () => {
    const host = createWorkspaceHost();
    host.upsertMember('ws-a', { surfaceId: 'b', kind: 'popup', order: 3 });
    host.upsertMember('ws-a', { surfaceId: 'a', kind: 'dialog', order: 1 });
    host.upsertMember('ws-a', { surfaceId: 'c', kind: 'terminal', order: 3 });
    expect(host.getWorkspace('ws-a')!.members).toEqual([
      { surfaceId: 'a', kind: 'dialog', order: 1 },
      { surfaceId: 'b', kind: 'popup', order: 3 },
      { surfaceId: 'c', kind: 'terminal', order: 3 },
    ]);
  });

  test('cycleFocus skips minimized members', () => {
    const host = createWorkspaceHost();
    host.upsertMember('ws-a', { surfaceId: 'a', kind: 'popup', order: 1 });
    host.upsertMember('ws-a', { surfaceId: 'b', kind: 'popup', order: 2, minimized: true });
    host.upsertMember('ws-a', { surfaceId: 'c', kind: 'popup', order: 3 });
    host.setFocusedMember('ws-a', 'a');
    expect(host.cycleFocus('ws-a', 1)).toBe('c');
    expect(host.cycleFocus('ws-a', 1)).toBe('a');
  });

  test('removeMember re-homes focus to first remaining member', () => {
    const host = createWorkspaceHost();
    host.upsertMember('ws-a', { surfaceId: 'a', kind: 'popup', order: 1 });
    host.upsertMember('ws-a', { surfaceId: 'b', kind: 'popup', order: 2 });
    host.setFocusedMember('ws-a', 'b');
    const ws = host.removeMember('ws-a', 'b')!;
    expect(ws.focusedMemberId).toBe('a');
    expect(ws.members).toEqual([{ surfaceId: 'a', kind: 'popup', order: 1 }]);
  });

  test('minimizeMember marks member minimized and optionally docked', () => {
    const host = createWorkspaceHost();
    host.upsertMember('ws-a', { surfaceId: 'a', kind: 'popup', order: 1, label: 'Alpha' });
    const ws = host.minimizeMember('ws-a', 'a', { docked: true })!;
    expect(ws.members).toEqual([{
      surfaceId: 'a',
      kind: 'popup',
      order: 1,
      label: 'Alpha',
      minimized: true,
      docked: true,
    }]);
    expect(host.getMember('ws-a', 'a')).toEqual({
      surfaceId: 'a',
      kind: 'popup',
      order: 1,
      label: 'Alpha',
      minimized: true,
      docked: true,
    });
  });

  test('restoreMember clears minimized+docked flags and can recover focus', () => {
    const host = createWorkspaceHost();
    host.upsertMember('ws-a', { surfaceId: 'a', kind: 'popup', order: 1, minimized: true, docked: true });
    const ws = host.restoreMember('ws-a', 'a')!;
    expect(ws.members).toEqual([{
      surfaceId: 'a',
      kind: 'popup',
      order: 1,
      minimized: false,
      docked: false,
    }]);
    expect(ws.focusedMemberId).toBe('a');
  });

  test('onChange emits workspace/member/focus lifecycle', () => {
    const host = createWorkspaceHost();
    const seen: string[] = [];
    host.onChange((event) => {
      seen.push(`${event.type}:${event.workspaceId}:${event.member?.surfaceId ?? event.focusedMemberId ?? '-'}`);
    });
    host.ensureWorkspace({ id: 'ws-a' });
    host.upsertMember('ws-a', { surfaceId: 'popup:1', kind: 'popup' });
    host.setFocusedMember('ws-a', 'popup:1');
    host.cycleFocus('ws-a', 1);
    host.removeMember('ws-a', 'popup:1');
    host.disposeWorkspace('ws-a');
    expect(seen).toEqual([
      'workspace-added:ws-a:-',
      'member-upserted:ws-a:popup:1',
      'focus-changed:ws-a:popup:1',
      'member-removed:ws-a:popup:1',
      'workspace-removed:ws-a:-',
    ]);
  });

  test('onChange emits minimize/restore/dock lifecycle', () => {
    const host = createWorkspaceHost();
    const seen: string[] = [];
    host.onChange((event) => {
      seen.push(`${event.type}:${event.workspaceId}:${event.member?.surfaceId ?? '-'}`);
    });
    host.upsertMember('ws-a', { surfaceId: 'popup:1', kind: 'popup' });
    host.minimizeMember('ws-a', 'popup:1', { docked: true });
    host.restoreMember('ws-a', 'popup:1');
    host.dockMember('ws-a', 'popup:1');
    host.undockMember('ws-a', 'popup:1');
    expect(seen).toEqual([
      'workspace-added:ws-a:-',
      'member-upserted:ws-a:popup:1',
      'member-minimized:ws-a:popup:1',
      'member-restored:ws-a:popup:1',
      'member-docked:ws-a:popup:1',
      'member-undocked:ws-a:popup:1',
    ]);
  });
});
