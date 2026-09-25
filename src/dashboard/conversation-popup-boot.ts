import {
  createConversationPopupHost,
  type ConversationPopupHost,
  type ConversationPopupLayoutMode,
} from '../conv-dash/popup-host.js';
import {
  createConversationPopupRuntime,
  type ConversationPopupModalHandle,
  type ConversationPopupRuntime,
  type ConversationPopupWorkspaceHost,
} from './conversation-popup-runtime.js';
import type { SurfaceId } from '../display/types.js';

interface ConversationPopupSessionLike {
  readonly id: string;
  readonly launchSpec: {
    readonly brand?: string;
  };
}

interface ConversationPopupWidgetLike<WidgetState> {
  state: WidgetState;
}

export interface DashboardConversationPopupBootDeps<
  SessionEntry,
  Session extends ConversationPopupSessionLike,
  WidgetConfig,
  WidgetState,
  StatusRecord,
  Observer,
> {
  createConversationPopupHost?: typeof createConversationPopupHost;
  listLiveSessions: () => readonly SessionEntry[];
  findSessionEntry: (entries: readonly SessionEntry[], sessionId: string) => SessionEntry | undefined;
  getSession: (entry: SessionEntry) => Session;
  getWidgetId: (entry: SessionEntry) => string;
  getModalTitle: (entry: SessionEntry) => string;
  getStatusRecord: (sessionId: string) => StatusRecord;
  findObserver: (sessionId: string) => Observer;
  buildWidgetConfig: (
    session: Session,
    deps: { statusRecord: StatusRecord; observer: Observer },
  ) => Promise<WidgetConfig>;
  getWidget: (widgetId: string) => ConversationPopupWidgetLike<WidgetState> | null | undefined;
  spawnWidget: (opts: {
    type: 'conversation';
    id: string;
    character: string;
    config: Record<string, unknown>;
  }) => void;
  // Method syntax (bivariant params) — DI callback whose WidgetState may
  // infer to `unknown` at the call site; strictFunctionTypes must not reject
  // a concrete `(state: ConversationWidgetStateLike, …)` implementation.
  applyWidgetConfig(state: WidgetState, config: WidgetConfig): WidgetState;
  disposeWidget: (widgetId: string) => void;
  termSize: () => { cols: number; rows: number };
  workspaceHost: ConversationPopupWorkspaceHost;
  resolveLayoutMode: (
    mode: ConversationPopupLayoutMode,
    cols: number,
    rows: number,
    liveCount: number,
  ) => ConversationPopupLayoutMode;
  showModal: (opts: {
    id: SurfaceId;
    title: string;
    widgetId: string;
    cols: number;
    rows: number;
    bounds: { row: number; col: number; width: number; height: number };
    onDispose: () => void;
  }) => ConversationPopupModalHandle;
  draw: () => void;
  now?: () => number;
}

export interface DashboardConversationPopupBootResult {
  conversationPopupHost: ConversationPopupHost;
  pruneConversationPopupHost: () => void;
  ensureConversationWidgetMounted: (sessionId: string) => Promise<boolean>;
  conversationPopupRuntime: ConversationPopupRuntime;
}

export function bootDashboardConversationPopupRuntime<
  SessionEntry,
  Session extends ConversationPopupSessionLike,
  WidgetConfig,
  WidgetState,
  StatusRecord,
  Observer,
>(
  deps: DashboardConversationPopupBootDeps<
    SessionEntry,
    Session,
    WidgetConfig,
    WidgetState,
    StatusRecord,
    Observer
  >,
): DashboardConversationPopupBootResult {
  const conversationPopupHost = (deps.createConversationPopupHost ?? createConversationPopupHost)();

  const pruneConversationPopupHost = (): void => {
    const liveSessionIds = new Set(deps.listLiveSessions().map((entry) => deps.getSession(entry).id));
    for (const sessionId of conversationPopupHost.snapshot().live.map((entry) => entry.sessionId)) {
      if (!liveSessionIds.has(sessionId)) {
        conversationPopupHost.remove(sessionId);
        try { deps.disposeWidget(`conversation-widget:${sessionId}`); } catch { /* absent */ }
      }
    }
    for (const sessionId of conversationPopupHost.snapshot().minimized.map((entry) => entry.sessionId)) {
      if (!liveSessionIds.has(sessionId)) {
        conversationPopupHost.remove(sessionId);
        try { deps.disposeWidget(`conversation-widget:${sessionId}`); } catch { /* absent */ }
      }
    }
  };

  const ensureConversationWidgetMounted = async (sessionId: string): Promise<boolean> => {
    const entry = deps.findSessionEntry(deps.listLiveSessions(), sessionId);
    if (!entry) return false;
    const session = deps.getSession(entry);
    const widgetId = deps.getWidgetId(entry);
    const existing = deps.getWidget(widgetId);
    const config = await deps.buildWidgetConfig(session, {
      statusRecord: deps.getStatusRecord(session.id),
      observer: deps.findObserver(session.id),
    });
    if (!existing) {
      deps.spawnWidget({
        type: 'conversation',
        id: widgetId,
        character: 'Conversation',
        config: config as unknown as Record<string, unknown>,
      });
    } else {
      existing.state = deps.applyWidgetConfig(existing.state, config);
    }
    conversationPopupHost.upsert({
      sessionId: session.id,
      widgetInstanceId: widgetId,
      modalId: `conversation-modal:${session.id}`,
      title: deps.getModalTitle(entry),
      brand: session.launchSpec.brand,
      openedAt: deps.now?.() ?? Date.now(),
    });
    return true;
  };

  const conversationPopupRuntime = createConversationPopupRuntime({
    conversationPopupHost,
    pruneConversationPopupHost,
    ensureConversationWidgetMounted,
    termSize: deps.termSize,
    workspaceHost: deps.workspaceHost,
    resolveLayoutMode: deps.resolveLayoutMode,
    listLiveSessions: deps.listLiveSessions,
    findSessionEntry: deps.findSessionEntry,
    getSessionId: (entry) => deps.getSession(entry).id,
    getWidgetId: deps.getWidgetId,
    getModalTitle: deps.getModalTitle,
    showModal: deps.showModal,
    draw: deps.draw,
  });

  return {
    conversationPopupHost,
    pruneConversationPopupHost,
    ensureConversationWidgetMounted,
    conversationPopupRuntime,
  };
}
