export type WorkspaceLayoutMode =
  | 'stack'
  | 'grid'
  | 'columns'
  | 'rows'
  | 'desktop';

export type WorkspaceMemberKind =
  | 'popup'
  | 'dialog'
  | 'terminal'
  | 'authored'
  | 'pane';

export interface WorkspaceMemberDescriptor {
  readonly surfaceId: string;
  readonly kind: WorkspaceMemberKind;
  readonly label?: string;
  readonly order?: number;
  readonly minimized?: boolean;
  readonly docked?: boolean;
}

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly layoutMode: WorkspaceLayoutMode;
  readonly softCap?: number;
  readonly focusedMemberId: string | null;
  readonly members: readonly WorkspaceMemberDescriptor[];
}

export interface WorkspaceEnsureSpec {
  readonly id: string;
  readonly label?: string;
  readonly layoutMode?: WorkspaceLayoutMode;
  readonly softCap?: number;
}

export interface WorkspaceHostChangeEvent {
  readonly type:
    | 'workspace-added'
    | 'workspace-updated'
    | 'workspace-removed'
    | 'member-upserted'
    | 'member-removed'
    | 'focus-changed'
    | 'member-minimized'
    | 'member-restored'
    | 'member-docked'
    | 'member-undocked';
  readonly workspaceId: string;
  readonly member?: WorkspaceMemberDescriptor;
  readonly focusedMemberId?: string | null;
}

export interface WorkspaceHost {
  ensureWorkspace(spec: WorkspaceEnsureSpec): WorkspaceDescriptor;
  getWorkspace(id: string): WorkspaceDescriptor | undefined;
  getMember(workspaceId: string, surfaceId: string): WorkspaceMemberDescriptor | undefined;
  listWorkspaces(): readonly WorkspaceDescriptor[];
  upsertMember(workspaceId: string, member: WorkspaceMemberDescriptor): WorkspaceDescriptor;
  removeMember(workspaceId: string, surfaceId: string): WorkspaceDescriptor | undefined;
  minimizeMember(
    workspaceId: string,
    surfaceId: string,
    opts?: { docked?: boolean },
  ): WorkspaceDescriptor | undefined;
  restoreMember(workspaceId: string, surfaceId: string): WorkspaceDescriptor | undefined;
  dockMember(workspaceId: string, surfaceId: string): WorkspaceDescriptor | undefined;
  undockMember(workspaceId: string, surfaceId: string): WorkspaceDescriptor | undefined;
  setLayoutMode(workspaceId: string, layoutMode: WorkspaceLayoutMode): WorkspaceDescriptor | undefined;
  setFocusedMember(workspaceId: string, surfaceId: string | null): WorkspaceDescriptor | undefined;
  cycleFocus(workspaceId: string, dir?: 1 | -1): string | null;
  disposeWorkspace(id: string): void;
  onChange(cb: (event: WorkspaceHostChangeEvent) => void): () => void;
}

interface WorkspaceRecord {
  id: string;
  label?: string;
  layoutMode: WorkspaceLayoutMode;
  softCap?: number;
  focusedMemberId: string | null;
  members: WorkspaceMemberDescriptor[];
}

export function createWorkspaceHost(): WorkspaceHost {
  const workspaces = new Map<string, WorkspaceRecord>();
  const subs = new Set<(event: WorkspaceHostChangeEvent) => void>();

  function emit(event: WorkspaceHostChangeEvent): void {
    for (const sub of [...subs]) {
      try {
        sub(event);
      } catch {
        // Workspace observers must not destabilize the coordinator path.
      }
    }
  }

  function snapshot(record: WorkspaceRecord): WorkspaceDescriptor {
    return {
      id: record.id,
      ...(record.label !== undefined ? { label: record.label } : {}),
      layoutMode: record.layoutMode,
      ...(record.softCap !== undefined ? { softCap: record.softCap } : {}),
      focusedMemberId: record.focusedMemberId,
      members: [...record.members],
    };
  }

  function sortedMembers(members: WorkspaceMemberDescriptor[]): WorkspaceMemberDescriptor[] {
    return [...members].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0)
      || a.surfaceId.localeCompare(b.surfaceId));
  }

  function ensure(spec: WorkspaceEnsureSpec): WorkspaceRecord {
    const existing = workspaces.get(spec.id);
    if (existing) {
      let changed = false;
      if (spec.label !== undefined && spec.label !== existing.label) {
        existing.label = spec.label;
        changed = true;
      }
      if (spec.layoutMode !== undefined && spec.layoutMode !== existing.layoutMode) {
        existing.layoutMode = spec.layoutMode;
        changed = true;
      }
      if (spec.softCap !== undefined && spec.softCap !== existing.softCap) {
        existing.softCap = spec.softCap;
        changed = true;
      }
      if (changed) emit({ type: 'workspace-updated', workspaceId: existing.id });
      return existing;
    }
    const record: WorkspaceRecord = {
      id: spec.id,
      ...(spec.label !== undefined ? { label: spec.label } : {}),
      layoutMode: spec.layoutMode ?? 'stack',
      ...(spec.softCap !== undefined ? { softCap: spec.softCap } : {}),
      focusedMemberId: null,
      members: [],
    };
    workspaces.set(record.id, record);
    emit({ type: 'workspace-added', workspaceId: record.id });
    return record;
  }

  return {
    ensureWorkspace(spec): WorkspaceDescriptor {
      return snapshot(ensure(spec));
    },

    getWorkspace(id): WorkspaceDescriptor | undefined {
      const record = workspaces.get(id);
      return record ? snapshot(record) : undefined;
    },

    getMember(workspaceId, surfaceId): WorkspaceMemberDescriptor | undefined {
      return workspaces.get(workspaceId)?.members.find((entry) => entry.surfaceId === surfaceId);
    },

    listWorkspaces(): readonly WorkspaceDescriptor[] {
      return [...workspaces.values()].map(snapshot).sort((a, b) => a.id.localeCompare(b.id));
    },

    upsertMember(workspaceId, member): WorkspaceDescriptor {
      const record = ensure({ id: workspaceId });
      const index = record.members.findIndex((entry) => entry.surfaceId === member.surfaceId);
      if (index >= 0) {
        record.members[index] = member;
      } else {
        record.members.push(member);
      }
      record.members = sortedMembers(record.members);
      if (!record.focusedMemberId || !record.members.some((entry) => entry.surfaceId === record.focusedMemberId)) {
        record.focusedMemberId = member.surfaceId;
      }
      emit({ type: 'member-upserted', workspaceId, member, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    removeMember(workspaceId, surfaceId): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const index = record.members.findIndex((entry) => entry.surfaceId === surfaceId);
      if (index < 0) return snapshot(record);
      record.members.splice(index, 1);
      if (record.focusedMemberId === surfaceId) {
        record.focusedMemberId = record.members[0]?.surfaceId ?? null;
      }
      emit({ type: 'member-removed', workspaceId, member: { surfaceId, kind: 'popup' }, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    minimizeMember(workspaceId, surfaceId, opts): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const index = record.members.findIndex((entry) => entry.surfaceId === surfaceId);
      if (index < 0) return snapshot(record);
      const next: WorkspaceMemberDescriptor = {
        ...record.members[index]!,
        minimized: true,
        ...(opts?.docked ? { docked: true } : {}),
      };
      record.members[index] = next;
      if (record.focusedMemberId === surfaceId) {
        record.focusedMemberId = record.members.find((entry) =>
          entry.surfaceId !== surfaceId && entry.minimized !== true)?.surfaceId ?? null;
      }
      emit({ type: 'member-minimized', workspaceId, member: next, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    restoreMember(workspaceId, surfaceId): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const index = record.members.findIndex((entry) => entry.surfaceId === surfaceId);
      if (index < 0) return snapshot(record);
      const next: WorkspaceMemberDescriptor = {
        ...record.members[index]!,
        minimized: false,
        docked: false,
      };
      record.members[index] = next;
      if (!record.focusedMemberId) record.focusedMemberId = surfaceId;
      emit({ type: 'member-restored', workspaceId, member: next, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    dockMember(workspaceId, surfaceId): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const index = record.members.findIndex((entry) => entry.surfaceId === surfaceId);
      if (index < 0) return snapshot(record);
      const next: WorkspaceMemberDescriptor = {
        ...record.members[index]!,
        docked: true,
      };
      record.members[index] = next;
      emit({ type: 'member-docked', workspaceId, member: next, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    undockMember(workspaceId, surfaceId): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const index = record.members.findIndex((entry) => entry.surfaceId === surfaceId);
      if (index < 0) return snapshot(record);
      const next: WorkspaceMemberDescriptor = {
        ...record.members[index]!,
        docked: false,
      };
      record.members[index] = next;
      emit({ type: 'member-undocked', workspaceId, member: next, focusedMemberId: record.focusedMemberId });
      return snapshot(record);
    },

    setLayoutMode(workspaceId, layoutMode): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      if (record.layoutMode !== layoutMode) {
        record.layoutMode = layoutMode;
        emit({ type: 'workspace-updated', workspaceId });
      }
      return snapshot(record);
    },

    setFocusedMember(workspaceId, surfaceId): WorkspaceDescriptor | undefined {
      const record = workspaces.get(workspaceId);
      if (!record) return undefined;
      const next = surfaceId === null
        ? null
        : record.members.some((entry) => entry.surfaceId === surfaceId)
          ? surfaceId
          : record.focusedMemberId;
      if (record.focusedMemberId !== next) {
        record.focusedMemberId = next;
        emit({ type: 'focus-changed', workspaceId, focusedMemberId: record.focusedMemberId });
      }
      return snapshot(record);
    },

    cycleFocus(workspaceId, dir = 1): string | null {
      const record = workspaces.get(workspaceId);
      if (!record || record.members.length === 0) return null;
      const live = record.members.filter((entry) => entry.minimized !== true);
      if (live.length === 0) return null;
      const currentIndex = live.findIndex((entry) => entry.surfaceId === record.focusedMemberId);
      const start = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (start + (dir >= 0 ? 1 : -1) + live.length) % live.length;
      record.focusedMemberId = live[nextIndex]!.surfaceId;
      emit({ type: 'focus-changed', workspaceId, focusedMemberId: record.focusedMemberId });
      return record.focusedMemberId;
    },

    disposeWorkspace(id): void {
      if (!workspaces.has(id)) return;
      workspaces.delete(id);
      emit({ type: 'workspace-removed', workspaceId: id });
    },

    onChange(cb): () => void {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
