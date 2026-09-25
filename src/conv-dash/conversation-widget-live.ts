import type { WidgetHost } from '../widgets/host.js';
import type { WidgetInstance } from '../widgets/types.js';
import type { EmbodiedAgentSession } from '../agent/embodiment.js';
import type { AgentStatusRecord, AgentStatusStore } from '../agent-status/store.js';
import type { TransportObserver } from '../agent/transport-observer.js';
import {
  applyConversationWidgetConfig,
  buildConversationWidgetConfig,
  type ConversationWidgetStateLike,
} from './conversation-widget-model.js';
import type { MessageBlock, MessageBlockStream } from '../conv-substrate/message-block.js';
import { globalAcpEventRouter } from '../acp/event-router.js';

export interface ConversationWidgetLiveEntry {
  readonly session: EmbodiedAgentSession;
  readonly paneId?: string;
  readonly windowId?: number;
}

export interface ConversationWidgetLiveBridgeDeps {
  widgetHost: Pick<WidgetHost, 'get' | 'onMount' | 'onDispose'>;
  listSessions: () => readonly ConversationWidgetLiveEntry[];
  agentStatusStore: Pick<AgentStatusStore, 'getRecord' | 'subscribe'>;
  findObserver?: (sessionId: string) => TransportObserver | undefined;
  requestRender: () => void;
  pollMs?: number;
  schedulePoll?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearPoll?: (handle: ReturnType<typeof setInterval>) => void;
  /** PR-CL3 (B.3) — message-block stream lookup for the given session.
   *  Default: `globalAcpEventRouter().getStream(sessionId).snapshot()`.
   *  Tests inject a stub router so behaviour can be asserted without
   *  the global singleton in scope. Returning an empty array OR
   *  `undefined` means "no ACP stream for this session" — the widget
   *  falls back to channel/raw snapshot. */
  findMessageBlocks?: (sessionId: string) => readonly MessageBlock[] | undefined;
  /** PR-CL3 — subscribe to the session's message-block stream so widget
   *  refresh fires on append/update events (mouse-click-free redraw,
   *  matching PR #1040 "pane update → render request bridge"). Default
   *  attaches via the global router. Returns unsubscribe; null/undefined
   *  means the bridge falls back to the polling cadence. */
  subscribeMessageBlocks?: (
    sessionId: string,
    onChange: () => void,
  ) => (() => void) | null;
}

export function createConversationWidgetLiveBridge(
  deps: ConversationWidgetLiveBridgeDeps,
): () => void {
  const tracked = new Set<string>();
  // PR-CL3 (B.3) — per-widget stream subscription so append/update
  // events trigger immediate refresh without waiting for the polling
  // cadence. Mirrors the PR #1040 pane-update→render-request bridge for
  // the widget surface.
  const streamSubs = new Map<string, () => void>();
  const pollMs = deps.pollMs ?? 500;
  const schedulePoll = deps.schedulePoll ?? ((cb, ms) => setInterval(cb, ms));
  const clearPoll = deps.clearPoll ?? ((handle) => clearInterval(handle));

  const attachStream = (widgetId: string, sessionId: string): void => {
    if (streamSubs.has(widgetId)) return;
    const subscriber = deps.subscribeMessageBlocks ?? defaultSubscribeMessageBlocks;
    const unsub = subscriber(sessionId, () => {
      void refreshConversationWidgetById(widgetId, deps);
    });
    if (unsub) streamSubs.set(widgetId, unsub);
  };

  const detachStream = (widgetId: string): void => {
    const unsub = streamSubs.get(widgetId);
    if (!unsub) return;
    try { unsub(); } catch { /* swallow per-widget cleanup errors */ }
    streamSubs.delete(widgetId);
  };

  const mountDispose = deps.widgetHost.onMount((ev) => {
    if (ev.type !== 'conversation') return;
    tracked.add(ev.instanceId);
    // First refresh resolves the session id from the widget instance,
    // so we attach the stream subscription opportunistically after the
    // refresh has populated state.sessionId.
    void refreshConversationWidgetById(ev.instanceId, deps).then(() => {
      const inst = deps.widgetHost.get(ev.instanceId);
      if (isConversationWidgetInstance(inst)) {
        attachStream(ev.instanceId, inst.state.sessionId);
      }
    });
  });
  const unmountDispose = deps.widgetHost.onDispose((ev) => {
    if (ev.type !== 'conversation') return;
    tracked.delete(ev.instanceId);
    detachStream(ev.instanceId);
  });
  const statusDispose = deps.agentStatusStore.subscribe((sessionId, _record) => {
    for (const widgetId of tracked) {
      const inst = deps.widgetHost.get(widgetId);
      if (!isConversationWidgetInstance(inst)) continue;
      if (inst.state.sessionId !== sessionId) continue;
      void refreshConversationWidgetById(widgetId, deps);
    }
  });
  const pollHandle = schedulePoll(() => {
    for (const widgetId of tracked) {
      void refreshConversationWidgetById(widgetId, deps);
    }
  }, pollMs);

  return () => {
    mountDispose();
    unmountDispose();
    statusDispose();
    clearPoll(pollHandle);
    for (const unsub of streamSubs.values()) {
      try { unsub(); } catch { /* swallow */ }
    }
    streamSubs.clear();
  };
}

export async function refreshConversationWidgetById(
  widgetId: string,
  deps: Omit<ConversationWidgetLiveBridgeDeps, 'pollMs' | 'schedulePoll' | 'clearPoll'>,
): Promise<boolean> {
  const inst = deps.widgetHost.get(widgetId);
  if (!isConversationWidgetInstance(inst)) return false;
  const state = inst.state;
  const entry = deps.listSessions().find((candidate) => candidate.session.id === state.sessionId);
  if (!entry) return false;
  // PR-CL3 (B.3) — message-block stream snapshot 을 buildConfig 에
  // 전달. ACP-backed session 의 router stream 이 비어있으면 채널/raw
  // snapshot path 가 그대로 활성화 (back-compat).
  const findMessageBlocks = deps.findMessageBlocks ?? defaultFindMessageBlocks;
  const messageBlocks = findMessageBlocks(state.sessionId);
  const buildOpts: Parameters<typeof buildConversationWidgetConfig>[1] = {
    statusRecord: deps.agentStatusStore.getRecord(state.sessionId),
    observer: deps.findObserver?.(state.sessionId),
  };
  if (messageBlocks && messageBlocks.length > 0) {
    buildOpts.messageBlocks = messageBlocks;
  }
  const nextConfig = await buildConversationWidgetConfig(entry.session, buildOpts);
  inst.state = applyConversationWidgetConfig(state, nextConfig);
  deps.requestRender();
  return true;
}

// ─── Default router wiring ──────────────────────────────────────────

function defaultFindMessageBlocks(
  sessionId: string,
): readonly MessageBlock[] | undefined {
  const router = globalAcpEventRouter();
  // Don't auto-create a stream for non-ACP sessions — they'd appear as
  // empty arrays here regardless. listSessions filters out unknown ids.
  if (!router.listSessions().includes(sessionId)) return undefined;
  return router.getStream(sessionId).snapshot();
}

function defaultSubscribeMessageBlocks(
  sessionId: string,
  onChange: () => void,
): (() => void) | null {
  const router = globalAcpEventRouter();
  // Same gate — only subscribe when the session has a registered stream.
  if (!router.listSessions().includes(sessionId)) return null;
  const stream: MessageBlockStream = router.getStream(sessionId);
  const unsubAppend = stream.on('append', onChange);
  const unsubUpdate = stream.on('update', onChange);
  return (): void => {
    unsubAppend();
    unsubUpdate();
  };
}

function isConversationWidgetInstance(
  inst: WidgetInstance | null,
): inst is WidgetInstance<ConversationWidgetStateLike> {
  return !!inst
    && inst.type === 'conversation'
    && !!inst.state
    && typeof (inst.state as { sessionId?: unknown }).sessionId === 'string';
}
