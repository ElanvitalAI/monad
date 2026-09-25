import { describe, expect, test } from 'bun:test';

import { bootDashboardConversationPopupRuntime } from '../src/dashboard/conversation-popup-boot.js';

interface TestSession {
  id: string;
  launchSpec: { brand?: string };
}

interface TestEntry {
  session: TestSession;
}

describe('bootDashboardConversationPopupRuntime', () => {
  test('prunes stale popup entries and disposes stale widgets', () => {
    const sessions: TestEntry[] = [{ session: { id: 'live-1', launchSpec: { brand: 'codex' } } }];
    const disposed: string[] = [];
    const boot = bootDashboardConversationPopupRuntime<TestEntry, TestSession, Record<string, unknown>, { tag: string }>({
      listLiveSessions: () => sessions,
      findSessionEntry: (entries, sessionId) => entries.find((entry) => entry.session.id === sessionId),
      getSession: (entry) => entry.session,
      getWidgetId: (entry) => `conversation-widget:${entry.session.id}`,
      getModalTitle: (entry) => `Conversation · ${entry.session.id}`,
      getStatusRecord: () => null,
      findObserver: () => null,
      buildWidgetConfig: async () => ({}),
      getWidget: () => null,
      spawnWidget: () => {},
      applyWidgetConfig: (state) => state,
      disposeWidget: (widgetId) => { disposed.push(widgetId); },
      termSize: () => ({ cols: 120, rows: 40 }),
      workspaceHost: {
        getWorkspace: () => null,
        removeMember: () => {},
        upsertMember: () => {},
        setFocusedMember: () => {},
      },
      resolveLayoutMode: (mode) => mode,
      showModal: () => ({ dispose() {} }),
      draw: () => {},
      now: () => 42,
    });

    boot.conversationPopupHost.upsert({
      sessionId: 'stale-live',
      widgetInstanceId: 'conversation-widget:stale-live',
      modalId: 'conversation-modal:stale-live',
      title: 'stale-live',
    });
    boot.conversationPopupHost.upsert({
      sessionId: 'stale-min',
      widgetInstanceId: 'conversation-widget:stale-min',
      modalId: 'conversation-modal:stale-min',
      title: 'stale-min',
    });
    boot.conversationPopupHost.minimize('stale-min');

    boot.pruneConversationPopupHost();

    const snapshot = boot.conversationPopupHost.snapshot();
    expect(snapshot.live.map((entry) => entry.sessionId)).toEqual([]);
    expect(snapshot.minimized.map((entry) => entry.sessionId)).toEqual([]);
    expect(disposed).toEqual([
      'conversation-widget:stale-live',
      'conversation-widget:stale-min',
    ]);
  });

  test('ensures widget mount and upserts popup host entry', async () => {
    const sessions: TestEntry[] = [{ session: { id: 's1', launchSpec: { brand: 'claude-code' } } }];
    const spawned: Array<{ id: string; config: Record<string, unknown> }> = [];
    const widgets = new Map<string, { state: { tag: string } }>();
    const boot = bootDashboardConversationPopupRuntime<TestEntry, TestSession, { tag: string }, { tag: string }>({
      listLiveSessions: () => sessions,
      findSessionEntry: (entries, sessionId) => entries.find((entry) => entry.session.id === sessionId),
      getSession: (entry) => entry.session,
      getWidgetId: (entry) => `conversation-widget:${entry.session.id}`,
      getModalTitle: (entry) => `Conversation · ${entry.session.id}`,
      getStatusRecord: () => 'status-record',
      findObserver: () => 'observer-record',
      buildWidgetConfig: async (_session, ctx) => ({ tag: `${String(ctx.statusRecord)}:${String(ctx.observer)}` }),
      getWidget: (widgetId) => widgets.get(widgetId),
      spawnWidget: (opts) => {
        spawned.push({ id: opts.id, config: opts.config });
        widgets.set(opts.id, { state: { tag: 'spawned' } });
      },
      applyWidgetConfig: (_state, config) => config,
      disposeWidget: () => {},
      termSize: () => ({ cols: 120, rows: 40 }),
      workspaceHost: {
        getWorkspace: () => null,
        removeMember: () => {},
        upsertMember: () => {},
        setFocusedMember: () => {},
      },
      resolveLayoutMode: (mode) => mode,
      showModal: () => ({ dispose() {} }),
      draw: () => {},
      now: () => 99,
    });

    await expect(boot.ensureConversationWidgetMounted('s1')).resolves.toBe(true);

    expect(spawned).toEqual([{
      id: 'conversation-widget:s1',
      config: { tag: 'status-record:observer-record' },
    }]);
    expect(boot.conversationPopupHost.snapshot().live).toMatchObject([{
      sessionId: 's1',
      widgetInstanceId: 'conversation-widget:s1',
      modalId: 'conversation-modal:s1',
      title: 'Conversation · s1',
      brand: 'claude-code',
      openedAt: 99,
    }]);
  });
});
