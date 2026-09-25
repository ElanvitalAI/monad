import { describe, expect, test } from 'bun:test';
import {
  conversationHoverHudLabel,
  conversationModalTitle,
  conversationModalWidgetId,
  findConversationSessionEntry,
} from '../src/conv-dash/conversation-widget-open.js';

describe('conversation-widget-open helpers', () => {
  test('finds a live session entry by session id', () => {
    const entries = [
      {
        session: {
          id: 'sess-a',
          launchSpec: { brand: 'codex-app-server' },
          state: () => ({ title: 'Alpha' }),
        },
        paneId: 'pane-a',
        windowId: 1,
      },
      {
        session: {
          id: 'sess-b',
          launchSpec: { brand: 'gemini' },
          state: () => ({ title: 'Beta' }),
        },
      },
    ] as const;
    expect(findConversationSessionEntry(entries, 'sess-b')?.session.launchSpec.brand).toBe('gemini');
    expect(findConversationSessionEntry(entries, 'missing')).toBeUndefined();
  });

  test('builds a stable widget id for modal-hosted conversation widgets', () => {
    expect(conversationModalWidgetId('sess:1/foo bar')).toBe('conv-widget:sess:1-foo-bar');
  });

  test('prefers session title for modal chrome title', () => {
    expect(conversationModalTitle({
      id: 'sess-a',
      launchSpec: { brand: 'codex-app-server' },
      state: () => ({ title: 'Research Thread' }),
    })).toBe('Conversation · Research Thread');
  });

  test('falls back to brand + id when session title is empty', () => {
    expect(conversationModalTitle({
      id: 'sess-a',
      launchSpec: { brand: 'codex-app-server' },
      state: () => ({ title: '   ' }),
    })).toBe('Conversation · codex · sess-a');
  });

  test('formats hover HUD labels from conversation-message hits', () => {
    expect(conversationHoverHudLabel({
      kind: 'conversation-message',
      sessionId: 'sess-a',
      messageId: 'msg-1',
      role: 'reasoning',
      channel: 'plan',
      rangeStart: 4,
      rangeEnd: 8,
    })).toBe('conversation reasoning · plan · msg-1');
  });
});
