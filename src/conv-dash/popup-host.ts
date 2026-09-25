export type ConversationPopupLayoutMode = 'cascade' | 'tile' | 'stack';
export type ConversationPopupState = 'live' | 'minimized';

export interface ConversationPopupHostMember {
  readonly sessionId: string;
  readonly widgetInstanceId: string;
  readonly modalId?: string;
  readonly title: string;
  readonly brand?: string;
  readonly openedAt?: number;
}

export interface ConversationPopupHostEntry extends ConversationPopupHostMember {
  readonly state: ConversationPopupState;
  readonly zIndex: number;
}

export interface ConversationPopupFrame {
  readonly sessionId: string;
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
  readonly focused: boolean;
}

export interface ConversationPopupProjection {
  readonly layoutMode: ConversationPopupLayoutMode;
  readonly focusedSessionId: string | null;
  readonly liveFrames: readonly ConversationPopupFrame[];
  readonly minimized: readonly ConversationPopupHostEntry[];
}

export interface ConversationPopupWorkspaceMemberProjection {
  readonly sessionId: string;
  readonly surfaceId: string;
  readonly label: string;
  readonly order: number;
  readonly minimized: boolean;
  readonly docked: boolean;
}

export interface ConversationPopupHostSnapshot {
  readonly layoutMode: ConversationPopupLayoutMode;
  readonly focusedSessionId: string | null;
  readonly live: readonly ConversationPopupHostEntry[];
  readonly minimized: readonly ConversationPopupHostEntry[];
}

export interface ConversationPopupHost {
  upsert(member: ConversationPopupHostMember): ConversationPopupHostEntry;
  remove(sessionId: string): boolean;
  minimize(sessionId: string): boolean;
  restore(sessionId: string): boolean;
  focus(sessionId: string): boolean;
  setLayoutMode(mode: ConversationPopupLayoutMode): void;
  cycleFocus(direction?: 1 | -1): string | null;
  snapshot(): ConversationPopupHostSnapshot;
  project(termCols: number, termRows: number): ConversationPopupProjection;
}

export function createConversationPopupHost(): ConversationPopupHost {
  const entries = new Map<string, ConversationPopupHostEntry>();
  let order: string[] = [];
  let focusedSessionId: string | null = null;
  let layoutMode: ConversationPopupLayoutMode = 'cascade';
  let zSeq = 0;

  const sortedLive = (): ConversationPopupHostEntry[] =>
    order
      .map((sessionId) => entries.get(sessionId))
      .filter((entry): entry is ConversationPopupHostEntry => !!entry && entry.state === 'live');

  const sortedMinimized = (): ConversationPopupHostEntry[] =>
    order
      .map((sessionId) => entries.get(sessionId))
      .filter((entry): entry is ConversationPopupHostEntry => !!entry && entry.state === 'minimized');

  const ensureFocus = (): void => {
    if (focusedSessionId) {
      const entry = entries.get(focusedSessionId);
      if (entry && entry.state === 'live') return;
    }
    focusedSessionId = sortedLive()[0]?.sessionId ?? null;
  };

  const touchZ = (sessionId: string): number => {
    zSeq += 1;
    return zSeq;
  };

  return {
    upsert(member) {
      const prev = entries.get(member.sessionId);
      const next: ConversationPopupHostEntry = {
        ...member,
        state: prev?.state ?? 'live',
        zIndex: prev?.zIndex ?? touchZ(member.sessionId),
      };
      entries.set(member.sessionId, next);
      if (!order.includes(member.sessionId)) order.push(member.sessionId);
      if (next.state === 'live') {
        focusedSessionId = member.sessionId;
        entries.set(member.sessionId, { ...next, zIndex: touchZ(member.sessionId) });
      } else {
        ensureFocus();
      }
      return entries.get(member.sessionId)!;
    },

    remove(sessionId) {
      const existed = entries.delete(sessionId);
      if (!existed) return false;
      order = order.filter((id) => id !== sessionId);
      if (focusedSessionId === sessionId) ensureFocus();
      return true;
    },

    minimize(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry || entry.state === 'minimized') return false;
      entries.set(sessionId, { ...entry, state: 'minimized' });
      if (focusedSessionId === sessionId) ensureFocus();
      return true;
    },

    restore(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry || entry.state === 'live') return false;
      const next = { ...entry, state: 'live' as const, zIndex: touchZ(sessionId) };
      entries.set(sessionId, next);
      focusedSessionId = sessionId;
      return true;
    },

    focus(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry || entry.state !== 'live') return false;
      focusedSessionId = sessionId;
      entries.set(sessionId, { ...entry, zIndex: touchZ(sessionId) });
      return true;
    },

    setLayoutMode(mode) {
      layoutMode = mode;
      ensureFocus();
    },

    cycleFocus(direction = 1) {
      const live = sortedLive();
      if (live.length === 0) {
        focusedSessionId = null;
        return null;
      }
      const currentIdx = focusedSessionId
        ? live.findIndex((entry) => entry.sessionId === focusedSessionId)
        : -1;
      const nextIdx = currentIdx < 0
        ? 0
        : (currentIdx + direction + live.length) % live.length;
      const next = live[nextIdx]!;
      focusedSessionId = next.sessionId;
      entries.set(next.sessionId, { ...next, zIndex: touchZ(next.sessionId) });
      return next.sessionId;
    },

    snapshot() {
      ensureFocus();
      return {
        layoutMode,
        focusedSessionId,
        live: sortedLive().sort((a, b) => a.zIndex - b.zIndex),
        minimized: sortedMinimized(),
      };
    },

    project(termCols, termRows) {
      ensureFocus();
      const live = sortedLive().sort((a, b) => a.zIndex - b.zIndex);
      return {
        layoutMode,
        focusedSessionId,
        liveFrames: projectConversationPopups(live, layoutMode, termCols, termRows, focusedSessionId),
        minimized: sortedMinimized(),
      };
    },
  };
}

export function projectConversationPopups(
  entries: readonly ConversationPopupHostEntry[],
  layoutMode: ConversationPopupLayoutMode,
  termCols: number,
  termRows: number,
  focusedSessionId: string | null = null,
): readonly ConversationPopupFrame[] {
  const live = entries.filter((entry) => entry.state === 'live');
  if (live.length === 0) return [];
  switch (layoutMode) {
    case 'tile':
      return projectTile(live, termCols, termRows, focusedSessionId);
    case 'stack':
      return projectStack(live, termCols, termRows, focusedSessionId);
    case 'cascade':
    default:
      return projectCascade(live, termCols, termRows, focusedSessionId);
  }
}

export function buildConversationPopupWorkspaceMembers(
  snapshot: ConversationPopupHostSnapshot,
): readonly ConversationPopupWorkspaceMemberProjection[] {
  const live = snapshot.live.map((entry, index) => ({
    sessionId: entry.sessionId,
    surfaceId: entry.modalId ?? `conversation-modal:${entry.sessionId}`,
    label: entry.title,
    order: 320 + index,
    minimized: false,
    docked: false,
  }));
  const minimized = snapshot.minimized.map((entry, index) => ({
    sessionId: entry.sessionId,
    surfaceId: entry.modalId ?? `conversation-modal:${entry.sessionId}`,
    label: entry.title,
    order: 320 + live.length + index,
    minimized: true,
    docked: true,
  }));
  return [...live, ...minimized];
}

function projectCascade(
  entries: readonly ConversationPopupHostEntry[],
  termCols: number,
  termRows: number,
  focusedSessionId: string | null,
): readonly ConversationPopupFrame[] {
  const width = clamp(Math.floor(termCols * 0.68), 44, Math.max(44, termCols - 4));
  const height = clamp(Math.floor(termRows * 0.62), 10, Math.max(10, termRows - 4));
  const offsetRow = Math.max(1, Math.floor(termRows / 12));
  const offsetCol = Math.max(2, Math.floor(termCols / 18));
  const maxRow = Math.max(1, termRows - height + 1);
  const maxCol = Math.max(1, termCols - width + 1);
  return entries.map((entry, idx) => ({
    sessionId: entry.sessionId,
    row: clamp(2 + idx * offsetRow, 1, maxRow),
    col: clamp(3 + idx * offsetCol, 1, maxCol),
    width,
    height,
    focused: entry.sessionId === focusedSessionId,
  }));
}

function projectTile(
  entries: readonly ConversationPopupHostEntry[],
  termCols: number,
  termRows: number,
  focusedSessionId: string | null,
): readonly ConversationPopupFrame[] {
  const cols = entries.length <= 2 ? entries.length : 2;
  const rows = Math.ceil(entries.length / cols);
  const gutter = 1;
  const width = Math.max(28, Math.floor((termCols - gutter * (cols - 1)) / cols));
  const height = Math.max(8, Math.floor((termRows - gutter * (rows - 1)) / rows));
  return entries.map((entry, idx) => {
    const gridRow = Math.floor(idx / cols);
    const gridCol = idx % cols;
    return {
      sessionId: entry.sessionId,
      row: 1 + gridRow * (height + gutter),
      col: 1 + gridCol * (width + gutter),
      width,
      height,
      focused: entry.sessionId === focusedSessionId,
    };
  });
}

function projectStack(
  entries: readonly ConversationPopupHostEntry[],
  termCols: number,
  termRows: number,
  focusedSessionId: string | null,
): readonly ConversationPopupFrame[] {
  const gutter = 1;
  const width = Math.max(36, termCols - 2);
  const height = Math.max(7, Math.floor((termRows - gutter * (entries.length - 1)) / entries.length));
  return entries.map((entry, idx) => ({
    sessionId: entry.sessionId,
    row: 1 + idx * (height + gutter),
    col: 1,
    width,
    height,
    focused: entry.sessionId === focusedSessionId,
  }));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
