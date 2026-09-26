// W8-A 후속 #1 (2026-05-14) — agent-cli cross-backend aggregator tests.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildCrossBackendHistoryPrefix,
  buildSessionHistoryPrefix,
  createInMemoryAgentCliConversationStore,
  createSqliteAgentCliConversationStore,
} from '../src/nexus/api/agent-cli-conversation-store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('agent-cli conversation store', () => {
  test('append + recent (basic round-trip)', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('chat-1', { role: 'user', backendId: 'claude', text: 'hi', at: 1 });
    store.append('chat-1', { role: 'agent', backendId: 'claude', text: 'hello', at: 2 });
    const recent = store.recent('chat-1');
    expect(recent).toHaveLength(2);
    expect(recent[0]!.text).toBe('hi');
    expect(recent[1]!.text).toBe('hello');
  });

  test('multi-backend mixing in same chat', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('chat-1', { role: 'user', backendId: 'claude', text: 'q1', at: 1 });
    store.append('chat-1', { role: 'agent', backendId: 'claude', text: 'r1', at: 2 });
    store.append('chat-1', { role: 'user', backendId: 'gemini', text: 'q2', at: 3 });
    store.append('chat-1', { role: 'agent', backendId: 'gemini', text: 'r2', at: 4 });
    const recent = store.recent('chat-1');
    expect(recent.map((t) => t.backendId)).toEqual(['claude', 'claude', 'gemini', 'gemini']);
  });

  test('chat isolation', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('chat-1', { role: 'user', backendId: 'c', text: 'a', at: 1 });
    store.append('chat-2', { role: 'user', backendId: 'g', text: 'b', at: 2 });
    expect(store.recent('chat-1')).toHaveLength(1);
    expect(store.recent('chat-2')).toHaveLength(1);
    expect(store.recent('chat-1')[0]!.text).toBe('a');
  });

  test('limit (last N) — recent honors cap', () => {
    const store = createInMemoryAgentCliConversationStore();
    for (let i = 0; i < 20; i++) {
      store.append('c', { role: 'user', backendId: 'b', text: `t${i}`, at: i });
    }
    expect(store.recent('c', 5)).toHaveLength(5);
    expect(store.recent('c', 5)[0]!.text).toBe('t15');
  });

  test('HARD_CAP 200 — oldest evict on overflow', () => {
    const store = createInMemoryAgentCliConversationStore();
    for (let i = 0; i < 250; i++) {
      store.append('c', { role: 'user', backendId: 'b', text: `t${i}`, at: i });
    }
    const all = store.recent('c', 1000);
    expect(all.length).toBeLessThanOrEqual(200);
    // 가장 오래된 element evicted.
    expect(all[0]!.text).not.toBe('t0');
  });

  test('clear (per-chat) + clearAll', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('a', { role: 'user', backendId: 'b', text: 'x', at: 1 });
    store.append('b', { role: 'user', backendId: 'b', text: 'y', at: 2 });
    store.clear('a');
    expect(store.recent('a')).toHaveLength(0);
    expect(store.recent('b')).toHaveLength(1);
    store.clearAll();
    expect(store.recent('b')).toHaveLength(0);
  });
});

describe('buildCrossBackendHistoryPrefix', () => {
  test('empty store → empty string', () => {
    const store = createInMemoryAgentCliConversationStore();
    expect(buildCrossBackendHistoryPrefix(store, 'c', '')).toBe('');
  });

  test('cross-backend turns rendered with role + backendId', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('c', { role: 'user', backendId: 'claude', text: 'q1', at: 1 });
    store.append('c', { role: 'agent', backendId: 'claude', text: 'r1', at: 2 });
    store.append('c', { role: 'user', backendId: 'gemini', text: 'q2', at: 3 });
    store.append('c', { role: 'agent', backendId: 'gemini', text: 'r2', at: 4 });
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', 'q3');
    expect(prefix).toContain('Previous conversation');
    expect(prefix).toContain('USER: q1');
    expect(prefix).toContain('AGENT[claude]: r1');
    expect(prefix).toContain('USER: q2');
    expect(prefix).toContain('AGENT[gemini]: r2');
  });

  test('exclude current user text (방금 push 됐을 가능성)', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('c', { role: 'user', backendId: 'claude', text: 'old', at: 1 });
    store.append('c', { role: 'user', backendId: 'gemini', text: 'current', at: 2 });
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', 'current');
    expect(prefix).toContain('USER: old');
    expect(prefix).not.toContain('USER: current');
  });

  test('maxTurns honors cap', () => {
    const store = createInMemoryAgentCliConversationStore();
    for (let i = 0; i < 30; i++) {
      store.append('c', { role: 'user', backendId: 'b', text: `t${i}`, at: i });
    }
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', '', 3);
    // maxTurns=3 → 3*2=6 most recent.
    const lines = prefix.split('\n');
    // first line = header, 나머지 6 = entries.
    expect(lines.length).toBeLessThanOrEqual(7);
  });

  test('plural "turns" in header for >1 turn', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('c', { role: 'user', backendId: 'claude', text: 'q1', at: 1 });
    store.append('c', { role: 'agent', backendId: 'claude', text: 'r1', at: 2 });
    store.append('c', { role: 'user', backendId: 'gemini', text: 'q2', at: 3 });
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', 'q3');
    expect(prefix).toContain('last 3 turns):');
    expect(prefix).not.toContain('last 3 turn):');
  });

  test('single turn uses singular "turn" in header', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('c', { role: 'user', backendId: 'claude', text: 'only', at: 1 });
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', '');
    expect(prefix).toContain('last 1 turn):');
  });

  test('multimodal user turn — [image attached] marker preserved in prefix', () => {
    const store = createInMemoryAgentCliConversationStore();
    store.append('c', { role: 'user', backendId: 'codex-app-server', text: '어떤 그림으로 보이나요? [image attached]', at: 1 });
    store.append('c', { role: 'agent', backendId: 'codex-app-server', text: '차처럼 보입니다.', at: 2 });
    store.append('c', { role: 'user', backendId: 'grok', text: '어떤것으로 보이나요? [image attached]', at: 3 });
    const prefix = buildCrossBackendHistoryPrefix(store, 'c', 'next question');
    expect(prefix).toContain('USER: 어떤 그림으로 보이나요? [image attached]');
    expect(prefix).toContain('AGENT[codex-app-server]: 차처럼 보입니다.');
    expect(prefix).toContain('USER: 어떤것으로 보이나요? [image attached]');
  });
});

describe('buildSessionHistoryPrefix — fork-continue seed', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '삼성 어때' },
    { role: 'assistant', content: '삼성 분석...' },
    { role: 'tool', content: 'quote' },
    { role: 'user', content: '하이닉스는' },
    { role: 'assistant', content: '하이닉스 분석...' },
  ];
  test('user/assistant 만·현재 user 제외·USER/AGENT 라벨', () => {
    const p = buildSessionHistoryPrefix(msgs, '하이닉스는');
    expect(p).toContain('forked session history');
    expect(p).toContain('USER: 삼성 어때');
    expect(p).toContain('AGENT: 하이닉스 분석...');
    expect(p).not.toContain('sys');       // system 제외
    expect(p).not.toContain('quote');     // tool 제외
    expect(p).not.toContain('USER: 하이닉스는'); // 현재 user text 제외(중복 방지)
  });
  test('maxTurns 짝 제한', () => {
    const p = buildSessionHistoryPrefix(msgs, '', 1); // 마지막 1짝(=2 메시지)
    expect(p).toContain('하이닉스는');
    expect(p).not.toContain('삼성 어때');
  });
  test('대화 없으면 빈 문자열', () => {
    expect(buildSessionHistoryPrefix([{ role: 'system', content: 'x' }], '')).toBe('');
  });
});

describe('SQLite-backed agent-cli conversation store', () => {
  let dbPath: string;
  let testCounter = 0;

  afterEach(() => {
    try { unlinkSync(dbPath); } catch {/* not created */}
  });

  function freshStore() {
    testCounter += 1;
    dbPath = join(tmpdir(), `elanous-test-conv-${testCounter}-${Date.now()}.db`);
    return createSqliteAgentCliConversationStore(dbPath);
  }

  test('SQLite append + recent round-trip', () => {
    const store = freshStore();
    store.append('c', { role: 'user', backendId: 'claude', text: 'q1', at: 1 });
    store.append('c', { role: 'agent', backendId: 'claude', text: 'r1', at: 2 });
    const recent = store.recent('c');
    expect(recent).toHaveLength(2);
    expect(recent[0]!.text).toBe('q1');
    expect(recent[1]!.text).toBe('r1');
    expect(recent[1]!.backendId).toBe('claude');
  });

  test('SQLite persistence — reopen file restores history', () => {
    testCounter += 1;
    dbPath = join(tmpdir(), `elanous-test-persist-${testCounter}-${Date.now()}.db`);
    const store1 = createSqliteAgentCliConversationStore(dbPath);
    store1.append('c', { role: 'user', backendId: 'gemini', text: 'persisted', at: 1 });
    // 두 번째 store instance — 같은 db file.
    const store2 = createSqliteAgentCliConversationStore(dbPath);
    const recent = store2.recent('c');
    expect(recent).toHaveLength(1);
    expect(recent[0]!.text).toBe('persisted');
    expect(recent[0]!.backendId).toBe('gemini');
  });

  test('SQLite HARD_CAP per-chat eviction', () => {
    testCounter += 1;
    dbPath = join(tmpdir(), `elanous-test-cap-${testCounter}-${Date.now()}.db`);
    const store = createSqliteAgentCliConversationStore(dbPath, { hardCapPerChat: 5 });
    for (let i = 0; i < 12; i++) {
      store.append('c', { role: 'user', backendId: 'b', text: `t${i}`, at: i });
    }
    const all = store.recent('c', 1000);
    expect(all.length).toBeLessThanOrEqual(5);
    // 가장 오래된 evict.
    expect(all[0]!.text).not.toBe('t0');
  });

  test('SQLite chat isolation', () => {
    const store = freshStore();
    store.append('a', { role: 'user', backendId: 'b', text: 'A', at: 1 });
    store.append('b', { role: 'user', backendId: 'b', text: 'B', at: 2 });
    expect(store.recent('a')).toHaveLength(1);
    expect(store.recent('b')).toHaveLength(1);
    expect(store.recent('a')[0]!.text).toBe('A');
  });

  test('SQLite clear + clearAll', () => {
    const store = freshStore();
    store.append('a', { role: 'user', backendId: 'b', text: 'x', at: 1 });
    store.append('b', { role: 'user', backendId: 'b', text: 'y', at: 2 });
    store.clear('a');
    expect(store.recent('a')).toHaveLength(0);
    expect(store.recent('b')).toHaveLength(1);
    store.clearAll();
    expect(store.recent('b')).toHaveLength(0);
  });
});
