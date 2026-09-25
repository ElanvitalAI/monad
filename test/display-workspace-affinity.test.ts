import { describe, expect, test } from 'bun:test';

import {
  DASHBOARD_MAIN_WORKSPACE_ID,
  attachSurfaceToWorkspace,
  normalizeWorkspaceOwnerId,
  workspaceOwnerIdForVirtualWindow,
} from '../src/display/workspace-affinity.js';

describe('workspace-affinity', () => {
  test('normalizes missing owners to dashboard-main', () => {
    expect(normalizeWorkspaceOwnerId()).toBe(DASHBOARD_MAIN_WORKSPACE_ID);
    expect(normalizeWorkspaceOwnerId(null)).toBe(DASHBOARD_MAIN_WORKSPACE_ID);
  });

  test('builds canonical virtual-window owner ids', () => {
    expect(workspaceOwnerIdForVirtualWindow(7)).toBe('virtual-window:7');
  });

  test('attaches normalized owner ids to popup surfaces', () => {
    const surface = { id: 'picker:1' };
    attachSurfaceToWorkspace(surface);
    expect(surface.ownerWorkspaceId).toBe(DASHBOARD_MAIN_WORKSPACE_ID);

    attachSurfaceToWorkspace(surface, workspaceOwnerIdForVirtualWindow(3));
    expect(surface.ownerWorkspaceId).toBe('virtual-window:3');
  });
});
