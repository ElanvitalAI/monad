import { describe, expect, test } from 'bun:test';
import {
  detectNewlyFinalizedAssistantMessages,
  type ShowroomPanelTtsState,
} from './use-showroom-tts';
import type { ChatMessage } from '@/lib/chat-runtime';

function msg(role: 'user' | 'assistant', text: string, idSuffix = ''): ChatMessage {
  return {
    id: `m-${role}-${idSuffix || text.slice(0, 4)}`,
    role,
    text,
    timestamp: 0,
  };
}

function state(opts: {
  messages?: ChatMessage[];
  partial?: string;
  streaming?: boolean;
  error?: string | null;
}): ShowroomPanelTtsState {
  return {
    messages: opts.messages ?? [],
    partial: opts.partial ?? '',
    streaming: opts.streaming ?? false,
    error: opts.error ?? null,
  };
}

describe('use-showroom-tts · detectNewlyFinalizedAssistantMessages', () => {
  test('detects streaming true → false with new assistant message', () => {
    const prev = { p1: state({ messages: [msg('user', 'hi')], streaming: true }) };
    const next = {
      p1: state({
        messages: [msg('user', 'hi'), msg('assistant', '안녕하세요')],
        streaming: false,
      }),
    };
    const out = detectNewlyFinalizedAssistantMessages(prev, next);
    expect(out).toEqual([{ panelId: 'p1', text: '안녕하세요' }]);
  });

  test('returns nothing when streaming did not flip to false', () => {
    const prev = { p1: state({ messages: [msg('user', 'hi')], streaming: true }) };
    const next = {
      p1: state({
        messages: [msg('user', 'hi'), msg('assistant', '...')],
        partial: 'partial chunk',
        streaming: true,
      }),
    };
    expect(detectNewlyFinalizedAssistantMessages(prev, next)).toEqual([]);
  });

  test('returns nothing when streaming flipped but no new message landed', () => {
    const prev = { p1: state({ messages: [msg('user', 'hi')], streaming: true }) };
    const next = {
      p1: state({ messages: [msg('user', 'hi')], streaming: false }),
    };
    expect(detectNewlyFinalizedAssistantMessages(prev, next)).toEqual([]);
  });

  test('skips empty assistant text (prevents empty utterance)', () => {
    const prev = { p1: state({ messages: [msg('user', 'hi')], streaming: true }) };
    const next = {
      p1: state({
        messages: [msg('user', 'hi'), msg('assistant', '   ')],
        streaming: false,
      }),
    };
    expect(detectNewlyFinalizedAssistantMessages(prev, next)).toEqual([]);
  });

  test('skips when last message is not assistant (defensive)', () => {
    const prev = { p1: state({ messages: [msg('user', 'first')], streaming: true }) };
    const next = {
      p1: state({
        messages: [msg('user', 'first'), msg('user', 'second')],
        streaming: false,
      }),
    };
    expect(detectNewlyFinalizedAssistantMessages(prev, next)).toEqual([]);
  });

  test('multiple panels finalize same tick → all returned', () => {
    const prev = {
      a: state({ messages: [msg('user', 'q1')], streaming: true }),
      b: state({ messages: [msg('user', 'q2')], streaming: true }),
    };
    const next = {
      a: state({
        messages: [msg('user', 'q1'), msg('assistant', '답변 A', 'aA')],
        streaming: false,
      }),
      b: state({
        messages: [msg('user', 'q2'), msg('assistant', '답변 B', 'aB')],
        streaming: false,
      }),
    };
    const out = detectNewlyFinalizedAssistantMessages(prev, next);
    expect(out).toHaveLength(2);
    const byId = Object.fromEntries(out.map((x) => [x.panelId, x.text]));
    expect(byId.a).toBe('답변 A');
    expect(byId.b).toBe('답변 B');
  });

  test('panel newly added between snapshots (no prior streaming) → no false fire', () => {
    const prev = {};
    const next = {
      p1: state({ messages: [msg('assistant', 'should not speak')], streaming: false }),
    };
    expect(detectNewlyFinalizedAssistantMessages(prev, next)).toEqual([]);
  });

  test('idempotent — same snapshot twice yields nothing', () => {
    const same = {
      p1: state({
        messages: [msg('user', 'hi'), msg('assistant', '예')],
        streaming: false,
      }),
    };
    expect(detectNewlyFinalizedAssistantMessages(same, same)).toEqual([]);
  });
});
