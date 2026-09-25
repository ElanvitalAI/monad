import { describe, expect, mock, test } from 'bun:test';

import { createMouseHoverRuntime } from '../src/dashboard/input/mouse-hover-runtime.js';

describe('createMouseHoverRuntime', () => {
  test('forwards widget hover events unchanged', () => {
    const dispatchHoverToWidget = mock((_paneId: string, _event: unknown) => {});
    const runtime = createMouseHoverRuntime({
      dispatchHoverToWidget,
      setConversationHoverLabel: () => {},
      clearConversationHoverLabel: () => {},
      conversationHoverHudLabel: () => '',
    });

    const event = { kind: 'enter', row: 2, col: 3 } as never;
    runtime.dispatchHoverToWidget?.('browser', event);

    expect(dispatchHoverToWidget).toHaveBeenCalledWith('browser', event);
  });

  test('sets hover label for conversation-message hits and clears otherwise', () => {
    const setConversationHoverLabel = mock((_label: string) => {});
    const clearConversationHoverLabel = mock(() => {});
    const runtime = createMouseHoverRuntime({
      dispatchHoverToWidget: () => {},
      setConversationHoverLabel,
      clearConversationHoverLabel,
      conversationHoverHudLabel: (hit) => `${hit.role}:${hit.turnId}`,
    });

    runtime.onPaneHoverEvent?.({
      target: {
        hit: {
          kind: 'conversation-message',
          sessionId: 's1',
          turnId: 't1',
          role: 'assistant',
        },
      },
    } as never);
    runtime.onPaneHoverEvent?.({ target: { hit: null } } as never);

    expect(setConversationHoverLabel).toHaveBeenCalledWith('assistant:t1');
    expect(clearConversationHoverLabel).toHaveBeenCalled();
  });
});
