export interface DashboardSidebarToolbeltStatusRecord {
  status: string;
  updatedAt: number;
  lastEvent?: string | null;
}

export interface DashboardSidebarToolbeltAttachNoBlock {
  kind: 'no-block';
}

export interface DashboardSidebarToolbeltAttachOk {
  kind: 'attached';
  attachmentId: string;
  lines: number;
  bytes: number;
  total: number;
}

export type DashboardSidebarToolbeltAttachResult =
  | DashboardSidebarToolbeltAttachNoBlock
  | DashboardSidebarToolbeltAttachOk;

export function formatDashboardSidebarToolbeltAction(
  action: string,
  sessionId: string,
  deps: {
    getStatusRecord: (sessionId: string) => DashboardSidebarToolbeltStatusRecord | null;
    attachBlock: (sessionId: string) => DashboardSidebarToolbeltAttachResult;
  },
): { tone: 'muted' | 'info'; message: string } {
  if (action === 'status') {
    const record = deps.getStatusRecord(sessionId);
    if (!record) {
      return {
        tone: 'muted',
        message: `[toolbelt] ${sessionId}: no status tracked yet.`,
      };
    }
    const ts = new Date(record.updatedAt).toISOString().replace('T', ' ').slice(0, 19);
    const tag = record.lastEvent ? ` · ${record.lastEvent}` : '';
    return {
      tone: 'info',
      message: `[toolbelt] ${sessionId} status=${record.status} @ ${ts}${tag}`,
    };
  }
  if (action === 'attach') {
    const result = deps.attachBlock(sessionId);
    if (result.kind === 'no-block') {
      return {
        tone: 'muted',
        message: `[toolbelt] no block captured yet for ${sessionId} — interact with the agent first.`,
      };
    }
    const kb = (result.bytes / 1024).toFixed(1);
    const queue = result.total > 1 ? ` [queue ${result.total}]` : '';
    return {
      tone: 'info',
      message: `[toolbelt] 📎 attached ${result.attachmentId} from ${sessionId} (${result.lines} lines, ${kb}KB)${queue} — next chat send will include this as context.`,
    };
  }
  if (action === 'review') {
    return {
      tone: 'muted',
      message: '[toolbelt] review — coming soon (future session).',
    };
  }
  return {
    tone: 'muted',
    message: `[toolbelt] unknown action: ${action}`,
  };
}
