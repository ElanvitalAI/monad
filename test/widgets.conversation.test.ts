import { describe, expect, test } from 'bun:test';

import conversationWidget from '../widgets/conversation/widget.js';
import type { RenderCtx, WidgetContext } from '../src/widgets/types.js';

const renderCtx = (overrides: Partial<RenderCtx> = {}): RenderCtx => ({
  width: 32,
  height: 10,
  focused: true,
  ...overrides,
});

const widgetCtx = {
  widgetId: 'conv-1',
  widgetType: 'conversation',
  character: 'Conversation',
  state: undefined as unknown,
  setState: () => {},
  requestRender: () => {},
  dismiss: () => {},
  log: () => {},
} as unknown as WidgetContext<unknown>;

describe('conversation widget', () => {
  test('initialState builds transcript-backed state from config', () => {
    const state = conversationWidget.initialState({
      sessionId: 'emb-1',
      brand: 'codex',
      status: 'running',
      transports: [{ kind: 'pty', id: 'pty-1' }],
      channelSnapshots: { message: 'hello world' },
    });

    expect(state.sessionId).toBe('emb-1');
    expect(state.messages).toHaveLength(1);
    expect(state.lines.some((line) => line.text.includes('hello world'))).toBe(true);
  });

  test('render produces title and transcript body', () => {
    const state = conversationWidget.initialState({
      sessionId: 'emb-1',
      brand: 'codex',
      title: 'codex [repo]',
      status: 'running',
      transports: [{ kind: 'pty', id: 'pty-1' }],
      channelSnapshots: { message: 'hello world' },
    });
    const out = conversationWidget.render(state, renderCtx(), 'Conversation');

    expect(out).toHaveLength(10);
    expect(out[0]).toContain('Conversation');
    expect(out.some((line) => line.includes('hello world'))).toBe(true);
  });

  test('describeHit returns conversation-message descriptor for body rows', () => {
    const state = conversationWidget.initialState({
      sessionId: 'emb-1',
      brand: 'codex',
      status: 'running',
      transports: [{ kind: 'pty', id: 'pty-1' }],
      channelSnapshots: { message: 'hello world' },
    });
    conversationWidget.render(state, renderCtx(), 'Conversation');

    const hit = conversationWidget.describeHit?.(state, widgetCtx, 5, 0);
    expect(hit).toMatchObject({
      kind: 'conversation-message',
      sessionId: 'emb-1',
      messageId: 'channel:message',
      role: 'assistant',
    });
  });

  test('onHover toggles hoveredMessageId for conversation hits', () => {
    const state = conversationWidget.initialState({
      sessionId: 'emb-1',
      brand: 'codex',
      status: 'running',
      transports: [{ kind: 'pty', id: 'pty-1' }],
      channelSnapshots: { message: 'hello world' },
    });

    conversationWidget.onHover?.({
      kind: 'hover-enter',
      hit: {
        kind: 'conversation-message',
        sessionId: 'emb-1',
        messageId: 'channel:message',
        role: 'assistant',
        rangeStart: 5,
        rangeEnd: 6,
      },
    }, state, widgetCtx as any);
    expect(state.hoveredMessageId).toBe('channel:message');

    conversationWidget.onHover?.({
      kind: 'hover-leave',
      hit: {
        kind: 'conversation-message',
        sessionId: 'emb-1',
        messageId: 'channel:message',
        role: 'assistant',
        rangeStart: 5,
        rangeEnd: 6,
      },
    }, state, widgetCtx as any);
    expect(state.hoveredMessageId).toBeNull();
  });
});
