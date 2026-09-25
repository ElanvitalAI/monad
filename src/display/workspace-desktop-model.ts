import type {
  WorkspaceDescriptor,
  WorkspaceHost,
  WorkspaceMemberDescriptor,
} from './workspace-host.js';

export interface WorkspaceDesktopEntry {
  readonly surfaceId: string;
  readonly kind: WorkspaceMemberDescriptor['kind'];
  readonly label: string;
  readonly order?: number;
  readonly focused: boolean;
  readonly minimized: boolean;
  readonly docked: boolean;
}

export interface WorkspaceDesktopModel {
  readonly workspaceId: string;
  readonly label?: string;
  readonly layoutMode: WorkspaceDescriptor['layoutMode'];
  readonly focusedMemberId: string | null;
  readonly liveEntries: readonly WorkspaceDesktopEntry[];
  readonly dockEntries: readonly WorkspaceDesktopEntry[];
  readonly dormantEntries: readonly WorkspaceDesktopEntry[];
  readonly parkedEntries: readonly WorkspaceDesktopEntry[];
  readonly counts: {
    readonly total: number;
    readonly live: number;
    readonly parked: number;
    readonly docked: number;
    readonly dormant: number;
  };
}

export function buildWorkspaceDesktopModel(workspace: WorkspaceDescriptor): WorkspaceDesktopModel {
  const entries = workspace.members.map((member) => toEntry(member, workspace.focusedMemberId));
  const liveEntries = sortDesktopEntries(entries.filter((entry) => entry.minimized !== true));
  const dockEntries = sortDesktopEntries(entries.filter((entry) => entry.docked === true));
  const dormantEntries = sortDesktopEntries(entries.filter((entry) => entry.minimized === true && entry.docked !== true));
  const parkedEntries = [...dockEntries, ...dormantEntries];
  return {
    workspaceId: workspace.id,
    ...(workspace.label !== undefined ? { label: workspace.label } : {}),
    layoutMode: workspace.layoutMode,
    focusedMemberId: workspace.focusedMemberId,
    liveEntries,
    dockEntries,
    dormantEntries,
    parkedEntries,
    counts: {
      total: entries.length,
      live: liveEntries.length,
      parked: parkedEntries.length,
      docked: dockEntries.length,
      dormant: dormantEntries.length,
    },
  };
}

export function buildWorkspaceDesktopModelFromHost(
  host: WorkspaceHost,
  workspaceId: string,
): WorkspaceDesktopModel | null {
  const workspace = host.getWorkspace(workspaceId);
  return workspace ? buildWorkspaceDesktopModel(workspace) : null;
}

export interface WorkspaceDesktopShellSummary {
  readonly parkedCount: number;
  readonly dockedCount: number;
  readonly dormantCount: number;
  readonly leadLabel: string | null;
}

export function summarizeWorkspaceDesktopShell(
  model: WorkspaceDesktopModel | null | undefined,
): WorkspaceDesktopShellSummary {
  if (!model) {
    return { parkedCount: 0, dockedCount: 0, dormantCount: 0, leadLabel: null };
  }
  return {
    parkedCount: model.counts.parked,
    dockedCount: model.counts.docked,
    dormantCount: model.counts.dormant,
    leadLabel: model.parkedEntries[0]?.label ?? null,
  };
}

function toEntry(
  member: WorkspaceMemberDescriptor,
  focusedMemberId: string | null,
): WorkspaceDesktopEntry {
  return {
    surfaceId: member.surfaceId,
    kind: member.kind,
    label: member.label ?? member.surfaceId,
    ...(member.order !== undefined ? { order: member.order } : {}),
    focused: focusedMemberId === member.surfaceId,
    minimized: member.minimized === true,
    docked: member.docked === true,
  };
}

function sortDesktopEntries(entries: WorkspaceDesktopEntry[]): WorkspaceDesktopEntry[] {
  return [...entries].sort((a, b) =>
    Number(b.focused) - Number(a.focused)
    || (a.order ?? 0) - (b.order ?? 0)
    || a.surfaceId.localeCompare(b.surfaceId));
}
