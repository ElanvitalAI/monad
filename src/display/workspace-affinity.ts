import type { SurfaceId } from './types.js';

export const DASHBOARD_MAIN_WORKSPACE_ID = 'dashboard-main' as const;

export function workspaceOwnerIdForVirtualWindow(windowId: number): SurfaceId {
  return `virtual-window:${windowId}`;
}

export function normalizeWorkspaceOwnerId(
  ownerWorkspaceId?: SurfaceId | null,
): SurfaceId {
  return ownerWorkspaceId ?? DASHBOARD_MAIN_WORKSPACE_ID;
}

export function attachSurfaceToWorkspace<T extends { ownerWorkspaceId?: SurfaceId }>(
  surface: T,
  ownerWorkspaceId?: SurfaceId | null,
): T {
  surface.ownerWorkspaceId = normalizeWorkspaceOwnerId(ownerWorkspaceId);
  return surface;
}
