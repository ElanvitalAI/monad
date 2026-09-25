import { describe, expect, mock, test } from 'bun:test';

import { createConversationPopupRuntime } from '../src/dashboard/conversation-popup-runtime.js';

describe('dashboard conversation popup runtime', () => {
  test('syncConversationPopupModals updates workspace members and mounts live frames', () => {
    const removeMember = mock((_ownerId: string, _surfaceId: string) => {});
    const upsertMember = mock((_ownerId: string, _member: unknown) => {});
    const setFocusedMember = mock((_ownerId: string, _surfaceId: string | null) => {});
    const showModal = mock((_opts: unknown) => ({ dispose: mock(() => {}) }));

    const runtime = createConversationPopupRuntime({
      conversationPopupHost: {
        snapshot: () => ({
          layoutMode: 'cascade',
          focusedSessionId: 's1',
          live: [{
            sessionId: 's1',
            widgetInstanceId: 'w1',
            modalId: 'conversation-modal:s1',
            title: 'Session 1',
            state: 'live',
            zIndex: 1,
          }],
          minimized: [],
        }),
        setLayoutMode: mock((_mode: 'cascade' | 'tile' | 'stack') => {}),
        restore: mock((_sessionId: string) => true),
        focus: mock((_sessionId: string) => true),
        cycleFocus: mock((_direction?: 1 | -1) => 's1'),
        remove: mock((_sessionId: string) => true),
        minimize: mock((_sessionId: string) => true),
      },
      pruneConversationPopupHost: mock(() => {}),
      ensureConversationWidgetMounted: mock(async (_sessionId: string) => true),
      termSize: () => ({ cols: 120, rows: 40 }),
      workspaceHost: {
        getWorkspace: () => ({ members: [{ surfaceId: 'conversation-modal:stale' }] }),
        removeMember,
        upsertMember,
        setFocusedMember,
      },
      resolveLayoutMode: (mode) => mode,
      listLiveSessions: () => [{ id: 's1', title: 'Session 1' }],
      findSessionEntry: (entries, sessionId) => entries.find((e) => e.id === sessionId),
      getSessionId: (entry) => entry.id,
      getWidgetId: (_entry) => 'w1',
      getModalTitle: (entry) => entry.title,
      showModal,
      draw: mock(() => {}),
    });

    runtime.syncConversationPopupModals();

    expect(removeMember).toHaveBeenCalledWith('dashboard-main', 'conversation-modal:stale');
    expect(upsertMember).toHaveBeenCalled();
    expect(setFocusedMember).toHaveBeenCalledWith('dashboard-main', 'conversation-modal:s1');
    expect(showModal).toHaveBeenCalled();
  });

  test('openConversationModal restores and focuses mounted sessions', async () => {
    const restore = mock((_sessionId: string) => true);
    const focus = mock((_sessionId: string) => true);
    const runtime = createConversationPopupRuntime({
      conversationPopupHost: {
        snapshot: () => ({ layoutMode: 'cascade', focusedSessionId: null, live: [], minimized: [] }),
        setLayoutMode: mock((_mode: 'cascade' | 'tile' | 'stack') => {}),
        restore,
        focus,
        cycleFocus: mock((_direction?: 1 | -1) => null),
        remove: mock((_sessionId: string) => true),
        minimize: mock((_sessionId: string) => true),
      },
      pruneConversationPopupHost: mock(() => {}),
      ensureConversationWidgetMounted: mock(async (_sessionId: string) => true),
      termSize: () => ({ cols: 120, rows: 40 }),
      workspaceHost: {
        getWorkspace: () => null,
        removeMember: mock((_ownerId: string, _surfaceId: string) => {}),
        upsertMember: mock((_ownerId: string, _member: unknown) => {}),
        setFocusedMember: mock((_ownerId: string, _surfaceId: string | null) => {}),
      },
      resolveLayoutMode: (mode) => mode,
      listLiveSessions: () => [],
      findSessionEntry: (_entries, _sessionId) => undefined,
      getSessionId: (_entry) => '',
      getWidgetId: (_entry) => '',
      getModalTitle: (_entry) => '',
      showModal: mock((_opts: unknown) => ({ dispose: mock(() => {}) })),
      draw: mock(() => {}),
    });

    expect(await runtime.openConversationModal('s1')).toBe(true);
    expect(restore).toHaveBeenCalledWith('s1');
    expect(focus).toHaveBeenCalledWith('s1');
  });

  test('focusConversationPopup removes missing sessions when ensure mount fails', async () => {
    const remove = mock((_sessionId: string) => true);
    const runtime = createConversationPopupRuntime({
      conversationPopupHost: {
        snapshot: () => ({ layoutMode: 'cascade', focusedSessionId: null, live: [], minimized: [] }),
        setLayoutMode: mock((_mode: 'cascade' | 'tile' | 'stack') => {}),
        restore: mock((_sessionId: string) => true),
        focus: mock((_sessionId: string) => true),
        cycleFocus: mock((_direction?: 1 | -1) => 'gone'),
        remove,
        minimize: mock((_sessionId: string) => true),
      },
      pruneConversationPopupHost: mock(() => {}),
      ensureConversationWidgetMounted: mock(async (_sessionId: string) => false),
      termSize: () => ({ cols: 120, rows: 40 }),
      workspaceHost: {
        getWorkspace: () => null,
        removeMember: mock((_ownerId: string, _surfaceId: string) => {}),
        upsertMember: mock((_ownerId: string, _member: unknown) => {}),
        setFocusedMember: mock((_ownerId: string, _surfaceId: string | null) => {}),
      },
      resolveLayoutMode: (mode) => mode,
      listLiveSessions: () => [],
      findSessionEntry: (_entries, _sessionId) => undefined,
      getSessionId: (_entry) => '',
      getWidgetId: (_entry) => '',
      getModalTitle: (_entry) => '',
      showModal: mock((_opts: unknown) => ({ dispose: mock(() => {}) })),
      draw: mock(() => {}),
    });

    expect(await runtime.focusConversationPopup(1)).toBeNull();
    expect(remove).toHaveBeenCalledWith('gone');
  });
});
