import { describe, expect, mock, test } from 'bun:test';

import { createMouseConversationPopupRuntime } from '../src/dashboard/input/mouse-conversation-popup-runtime.js';

describe('createMouseConversationPopupRuntime', () => {
  test('restores minimized sessions before mounting', async () => {
    const restore = mock((_sessionId: string) => {});
    const focus = mock((_sessionId: string) => {});
    const remove = mock((_sessionId: string) => {});
    const syncConversationPopupModals = mock(() => {});
    const redraw = mock(() => {});
    const runtime = createMouseConversationPopupRuntime({
      conversationPopupHost: {
        snapshot: () => ({
          minimized: [{ sessionId: 's1' }],
          live: [],
          focusedSessionId: null,
        }) as never,
        restore,
        focus,
        remove,
      },
      ensureConversationWidgetMounted: async () => true,
      syncConversationPopupModals,
      redraw,
    });

    await runtime.onConversationPopupPick?.('s1');

    expect(restore).toHaveBeenCalledWith('s1');
    expect(focus).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(syncConversationPopupModals).toHaveBeenCalled();
    expect(redraw).toHaveBeenCalled();
  });

  test('removes session when widget mount fails', async () => {
    const restore = mock((_sessionId: string) => {});
    const focus = mock((_sessionId: string) => {});
    const remove = mock((_sessionId: string) => {});
    const runtime = createMouseConversationPopupRuntime({
      conversationPopupHost: {
        snapshot: () => ({
          minimized: [],
          live: [{ sessionId: 's2' }],
          focusedSessionId: 's2',
        }) as never,
        restore,
        focus,
        remove,
      },
      ensureConversationWidgetMounted: async () => false,
      syncConversationPopupModals: () => {},
      redraw: () => {},
    });

    await runtime.onConversationPopupPick?.('s2');

    expect(focus).toHaveBeenCalledWith('s2');
    expect(remove).toHaveBeenCalledWith('s2');
    expect(restore).not.toHaveBeenCalled();
  });
});
