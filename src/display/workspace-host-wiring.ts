import type { DisplayHooks, DisplaySurface } from './types.js';
import { DASHBOARD_MAIN_WORKSPACE_ID, normalizeWorkspaceOwnerId } from './workspace-affinity.js';
import type {
  WorkspaceHost,
  WorkspaceLayoutMode,
  WorkspaceMemberDescriptor,
  WorkspaceMemberKind,
} from './workspace-host.js';
import { createWorkspaceHost } from './workspace-host.js';

export interface WorkspaceWiringOpts {
  readonly host?: WorkspaceHost;
  /** Resolve which workspace a mounted surface belongs to. Return
   *  null/undefined to ignore the surface entirely. */
  readonly workspaceIdOf?: (surface: DisplaySurface) => string | null | undefined;
  readonly workspaceLabelOf?: (surface: DisplaySurface) => string | undefined;
  readonly layoutModeOf?: (surface: DisplaySurface) => WorkspaceLayoutMode | undefined;
  readonly softCapOf?: (surface: DisplaySurface) => number | undefined;
  readonly memberOf?: (surface: DisplaySurface) => WorkspaceMemberDescriptor | null | undefined;
}

export interface WorkspaceWiringHandle extends DisplayHooks {
  readonly host: WorkspaceHost;
  workspaceIdFor(surfaceId: string): string | undefined;
  dispose(): void;
}

export function composeWorkspaceHostHooks(
  base: DisplayHooks = {},
  opts: WorkspaceWiringOpts = {},
): WorkspaceWiringHandle {
  const host = opts.host ?? createWorkspaceHost();
  const workspaceIdOf = opts.workspaceIdOf ?? defaultWorkspaceIdOf;
  const memberOf = opts.memberOf ?? defaultMemberOf;
  const workspaceLabelOf = opts.workspaceLabelOf ?? (() => undefined);
  const layoutModeOf = opts.layoutModeOf ?? (() => undefined);
  const softCapOf = opts.softCapOf ?? (() => undefined);
  const membership = new Map<string, string>();
  let active = true;

  const hooks: WorkspaceWiringHandle = {
    host,
    workspaceIdFor(surfaceId) {
      return membership.get(surfaceId);
    },
    dispose() {
      active = false;
      membership.clear();
    },
    onSurfaceMounted(surface) {
      try {
        if (active) {
          const workspaceId = workspaceIdOf(surface);
          const member = workspaceId ? memberOf(surface) : null;
          if (workspaceId && member) {
            host.ensureWorkspace({
              id: workspaceId,
              ...(workspaceLabelOf(surface) !== undefined ? { label: workspaceLabelOf(surface) } : {}),
              ...(layoutModeOf(surface) !== undefined ? { layoutMode: layoutModeOf(surface) } : {}),
              ...(softCapOf(surface) !== undefined ? { softCap: softCapOf(surface) } : {}),
            });
            host.upsertMember(workspaceId, member);
            membership.set(surface.id, workspaceId);
          }
        }
      } finally {
        base.onSurfaceMounted?.(surface);
      }
    },
    onSurfaceDisposed(surface) {
      try {
        if (active) {
          const workspaceId = membership.get(surface.id);
          if (workspaceId) {
            const member = host.getMember(workspaceId, surface.id);
            if (member?.minimized === true || member?.docked === true) {
              if (host.getWorkspace(workspaceId)?.focusedMemberId === surface.id) {
                host.setFocusedMember(workspaceId, null);
              }
            } else {
              host.removeMember(workspaceId, surface.id);
            }
            membership.delete(surface.id);
          }
        }
      } finally {
        base.onSurfaceDisposed?.(surface);
      }
    },
    onFocusChanged(prev, next, reason) {
      try {
        if (active) {
          const workspaceId = membership.get(next);
          if (workspaceId) {
            host.setFocusedMember(workspaceId, next);
          }
        }
      } finally {
        base.onFocusChanged?.(prev, next, reason);
      }
    },
    ...(base.beforeRender ? { beforeRender: base.beforeRender } : {}),
    ...(base.afterRender ? { afterRender: base.afterRender } : {}),
  };

  return hooks;
}

function defaultWorkspaceIdOf(surface: DisplaySurface): string | null {
  if (surface.kind !== 'modal') return null;
  if (surface.ownerWorkspaceId) return normalizeWorkspaceOwnerId(surface.ownerWorkspaceId);
  if (surface.tier === 'popup' || surface.tier === 'dialog' || surface.tier === 'terminal') {
    return DASHBOARD_MAIN_WORKSPACE_ID;
  }
  return null;
}

function defaultMemberOf(surface: DisplaySurface): WorkspaceMemberDescriptor | null {
  if (surface.kind !== 'modal') return null;
  const kind = surfaceKindToWorkspaceKind(surface);
  return {
    surfaceId: surface.id,
    kind,
    order: surface.priority,
  };
}

function surfaceKindToWorkspaceKind(surface: DisplaySurface): WorkspaceMemberKind {
  switch (surface.tier) {
    case 'dialog':
      return 'dialog';
    case 'terminal':
      return 'terminal';
    case 'popup':
    case 'menu':
    case 'tooltip':
    case 'picker':
      return 'popup';
    default:
      return surface.kind === 'pane' ? 'pane' : 'authored';
  }
}
