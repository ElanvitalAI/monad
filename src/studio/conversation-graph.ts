export type ConversationGraphEdgeKind =
  | 'spawn'
  | 'handoff'
  | 'cascade'
  | 'reply'
  | 'inject'
  | 'fork'
  | 'merge'
  | 'pin';

export interface ConversationGraphNodeRef {
  readonly sessionId: string;
  readonly messageId?: string;
}

export interface ConversationGraphEdgeRecord {
  readonly edgeId: string;
  readonly workspaceId: string;
  readonly from: ConversationGraphNodeRef;
  readonly to: ConversationGraphNodeRef;
  readonly kind: ConversationGraphEdgeKind;
  readonly at: number;
  readonly payloadRef?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface RecordConversationEdgeOpts {
  readonly workspaceId: string;
  readonly from: ConversationGraphNodeRef;
  readonly to: ConversationGraphNodeRef;
  readonly kind: ConversationGraphEdgeKind;
  readonly payloadRef?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly edgeId?: string;
  readonly now?: () => number;
}

export interface ListConversationEdgesOpts {
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly kind?: ConversationGraphEdgeKind;
}

export interface ConversationGraphSummary {
  readonly workspaceId: string;
  readonly totalEdges: number;
  readonly pinCount: number;
  readonly lastEventAt: number | null;
  readonly participants: readonly string[];
  readonly kindCounts: Readonly<Partial<Record<ConversationGraphEdgeKind, number>>>;
}

export interface ConversationGraphStore {
  recordEdge(opts: RecordConversationEdgeOpts): ConversationGraphEdgeRecord;
  listEdges(opts?: ListConversationEdgesOpts): readonly ConversationGraphEdgeRecord[];
  summarizeWorkspace(workspaceId: string): ConversationGraphSummary;
  listWorkspaceIds(): readonly string[];
  reset(): void;
}

export function createConversationGraphStore(): ConversationGraphStore {
  const edges: ConversationGraphEdgeRecord[] = [];
  let counter = 0;

  function mintId(): string {
    const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    counter += 1;
    return `studio-edge-${Date.now().toString(16)}-${counter.toString(16)}`;
  }

  function filterEdges(opts: ListConversationEdgesOpts = {}): ConversationGraphEdgeRecord[] {
    return edges.filter((edge) => {
      if (opts.workspaceId !== undefined && edge.workspaceId !== opts.workspaceId) return false;
      if (opts.kind !== undefined && edge.kind !== opts.kind) return false;
      if (opts.sessionId !== undefined
        && edge.from.sessionId !== opts.sessionId
        && edge.to.sessionId !== opts.sessionId) return false;
      return true;
    });
  }

  return {
    recordEdge(opts) {
      const edge: ConversationGraphEdgeRecord = {
        edgeId: opts.edgeId ?? mintId(),
        workspaceId: opts.workspaceId,
        from: opts.from,
        to: opts.to,
        kind: opts.kind,
        at: (opts.now ?? Date.now)(),
        ...(opts.payloadRef !== undefined ? { payloadRef: opts.payloadRef } : {}),
        ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
      };
      edges.push(edge);
      return edge;
    },

    listEdges(opts = {}) {
      return filterEdges(opts);
    },

    summarizeWorkspace(workspaceId) {
      const scoped = filterEdges({ workspaceId });
      const participants = new Set<string>();
      const kindCounts: Partial<Record<ConversationGraphEdgeKind, number>> = {};
      let pinCount = 0;
      let lastEventAt: number | null = null;

      for (const edge of scoped) {
        participants.add(edge.from.sessionId);
        participants.add(edge.to.sessionId);
        kindCounts[edge.kind] = (kindCounts[edge.kind] ?? 0) + 1;
        if (edge.kind === 'pin') pinCount += 1;
        if (lastEventAt === null || edge.at > lastEventAt) lastEventAt = edge.at;
      }

      return {
        workspaceId,
        totalEdges: scoped.length,
        pinCount,
        lastEventAt,
        participants: [...participants].sort(),
        kindCounts,
      };
    },

    listWorkspaceIds() {
      return [...new Set(edges.map((edge) => edge.workspaceId))].sort();
    },

    reset() {
      edges.length = 0;
      counter = 0;
    },
  };
}
