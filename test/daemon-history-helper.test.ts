// MVP cleanup C1 — daemon history helper tests.
//
// Unit tests for the shared turn-building helpers. The bug they fix:
// across N turns with the same sessionId, prior user messages were
// silently lost from the LLM's view of history.

import { describe, expect, test } from 'bun:test';

import {
  appendUserAndBuildMessages,
  appendAssistantMessages,
} from '../src/boot/daemon-history-helper.js';
import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';

describe('appendUserAndBuildMessages', () => {
  test('first turn persists user + injects systemPrompt', () => {
    const h = new DaemonSessionHistory();
    const msgs = appendUserAndBuildMessages(h, 's1', 'hello', 'sys-prompt');
    expect(h.get('s1')).toEqual([{ role: 'user', content: 'hello' }]);
    expect(msgs).toEqual([
      { role: 'system', content: 'sys-prompt' },
      { role: 'user', content: 'hello' },
    ]);
  });

  test('first turn without systemPrompt: just user', () => {
    const h = new DaemonSessionHistory();
    const msgs = appendUserAndBuildMessages(h, 's1', 'hi');
    expect(msgs).toEqual([{ role: 'user', content: 'hi' }]);
    expect(h.get('s1')).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('second turn does NOT inject systemPrompt again', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'first', 'sys');
    appendAssistantMessages(h, 's1', [
      { role: 'assistant', content: 'reply1' },
    ]);
    const msgs = appendUserAndBuildMessages(h, 's1', 'second', 'sys');
    expect(msgs.find((m) => m.role === 'system')).toBeUndefined();
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  test('multi-turn: history accumulates BOTH sides (the C1 bug fix)', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'q1');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a1' }]);
    appendUserAndBuildMessages(h, 's1', 'q2');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a2' }]);
    appendUserAndBuildMessages(h, 's1', 'q3');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a3' }]);

    expect(h.get('s1').map((m) => m.role)).toEqual([
      'user', 'assistant',
      'user', 'assistant',
      'user', 'assistant',
    ]);
    expect(h.get('s1').map((m) => m.content)).toEqual([
      'q1', 'a1', 'q2', 'a2', 'q3', 'a3',
    ]);
  });

  test('per-session isolation', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'A1');
    appendUserAndBuildMessages(h, 's2', 'B1');
    expect(h.get('s1').length).toBe(1);
    expect(h.get('s2').length).toBe(1);
    expect(h.get('s1')[0]!.content).toBe('A1');
    expect(h.get('s2')[0]!.content).toBe('B1');
  });
});

describe('appendAssistantMessages', () => {
  test('appends multiple messages preserving order', () => {
    const h = new DaemonSessionHistory();
    appendAssistantMessages(h, 's1', [
      { role: 'assistant', content: 'a' },
      { role: 'tool', content: 'b' } as never, // tool messages allowed downstream
    ]);
    expect(h.get('s1').length).toBe(2);
  });

  test('no-op on empty array', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'q');
    appendAssistantMessages(h, 's1', []);
    expect(h.get('s1').length).toBe(1);
  });
});
