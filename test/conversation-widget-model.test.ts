import { describe, expect, test } from 'bun:test';

import {
  buildConversationTranscript,
  buildConversationWidgetConfig,
} from '../src/conv-dash/conversation-widget-model.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeSession(): EmbodiedAgentSession {
  return {
    id: 'emb-1',
    launchSpec: { brand: 'codex' },
    transports: [{ kind: 'pty', id: 'pty-1', label: 'vw-pane' }],
    snapshotChannels: ['message', 'tool-call'],
    state() {
      return {
        status: 'running',
        title: 'codex [repo]',
        startedAt: 1234,
      };
    },
    async send() {},
    async interrupt() {},
    async snapshot() {
      return 'raw snapshot body';
    },
    async dispose() {},
  };
}

describe('conversation-widget-model', () => {
  test('buildConversationWidgetConfig prefers observer channels when present', async () => {
    const session = makeSession();
    const config = await buildConversationWidgetConfig(session, {
      statusRecord: { status: 'running', updatedAt: 2000, lastEvent: 'streaming' },
      observer: {
        snapshotChannels() {
          return {
            message: 'assistant line',
            'tool-call': 'Tool: exec',
          };
        },
      } as any,
    });

    expect(config.channelSnapshots).toEqual({
      message: 'assistant line',
      'tool-call': 'Tool: exec',
    });
    expect(config.snapshotText).toBeUndefined();
    expect(config.lastEvent).toBe('streaming');
  });

  test('buildConversationWidgetConfig falls back to raw snapshot when observer is missing', async () => {
    const config = await buildConversationWidgetConfig(makeSession());
    expect(config.snapshotText).toBe('raw snapshot body');
    expect(config.channelSnapshots).toBeUndefined();
  });

  test('buildConversationTranscript maps channels into labeled blocks', () => {
    const transcript = buildConversationTranscript({
      sessionId: 'emb-1',
      brand: 'codex',
      status: 'running',
      transports: [{ kind: 'pty', id: 'pty-1' }],
      channelSnapshots: {
        message: 'hello',
        'tool-call': 'Tool: exec',
      },
    });

    expect(transcript.messages.map((m) => m.id)).toEqual([
      'channel:message',
      'channel:tool-call',
    ]);
    expect(transcript.lines.some((line) => line.text.includes('Assistant'))).toBe(true);
    expect(transcript.lines.some((line) => line.text.includes('Tool call'))).toBe(true);
  });

  test('buildConversationTranscript falls back to waiting status when empty', () => {
    const transcript = buildConversationTranscript({
      sessionId: 'emb-1',
      brand: 'codex',
      status: 'pending',
      transports: [],
    });

    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]?.role).toBe('status');
    expect(transcript.lines.some((line) => line.text.includes('No conversation output captured yet.'))).toBe(true);
  });
});
