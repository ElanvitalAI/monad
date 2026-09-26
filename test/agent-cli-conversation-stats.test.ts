// W8-A 후속 #5 (2026-05-14) — conversation stats endpoint tests.

import { describe, expect, test } from 'bun:test';
import {
  handleConversationStats,
  isConversationStatsPath,
  CONVERSATION_STATS_PATH,
} from '../src/nexus/api/agent-cli-conversation-stats.js';
import {
  __resetAgentCliConversationStoreForTest,
  globalAgentCliConversationStore,
} from '../src/nexus/api/agent-cli-conversation-store.js';

function makeReq(query: string = '', method = 'GET') {
  return new Request(`http://x${CONVERSATION_STATS_PATH}${query}`, { method });
}

describe('conversation-stats · path matcher', () => {
  test('exact path match', () => {
    expect(isConversationStatsPath(CONVERSATION_STATS_PATH)).toBe(true);
    expect(isConversationStatsPath('/v1/agent-cli/conversation-stats/')).toBe(false);
    expect(isConversationStatsPath('/v1/agent-cli/stats')).toBe(false);
  });
});

describe('handleConversationStats', () => {
  test('method != GET → 405', async () => {
    const resp = await handleConversationStats(makeReq('?chatId=c', 'POST'));
    expect(resp.status).toBe(405);
  });

  test('missing chatId → 400', async () => {
    const resp = await handleConversationStats(makeReq(''));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toMatchObject({ error: 'chatId-required' });
  });

  test('empty store → all zero', async () => {
    process.env.ELANOUS_CONVERSATION_STORE_MODE = 'memory';
    __resetAgentCliConversationStoreForTest();
    const resp = await handleConversationStats(makeReq('?chatId=empty'));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({
      chatId: 'empty',
      total: 0,
      distinctBackends: 0,
      byBackend: {},
    });
  });

  test('group by backend (agent role only)', async () => {
    process.env.ELANOUS_CONVERSATION_STORE_MODE = 'memory';
    __resetAgentCliConversationStoreForTest();
    const store = globalAgentCliConversationStore();
    // 5 turn pattern: user (counts ignored) + agent (counted)
    store.append('c1', { role: 'user', backendId: 'claude', text: 'q1', at: 1 });
    store.append('c1', { role: 'agent', backendId: 'claude', text: 'r1', at: 2 });
    store.append('c1', { role: 'user', backendId: 'gemini', text: 'q2', at: 3 });
    store.append('c1', { role: 'agent', backendId: 'gemini', text: 'r2', at: 4 });
    store.append('c1', { role: 'user', backendId: 'claude', text: 'q3', at: 5 });
    store.append('c1', { role: 'agent', backendId: 'claude', text: 'r3', at: 6 });
    const resp = await handleConversationStats(makeReq('?chatId=c1'));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({
      chatId: 'c1',
      byBackend: { claude: 2, gemini: 1 },
      total: 3,
      distinctBackends: 2,
    });
  });

  test('chat isolation', async () => {
    process.env.ELANOUS_CONVERSATION_STORE_MODE = 'memory';
    __resetAgentCliConversationStoreForTest();
    const store = globalAgentCliConversationStore();
    store.append('a', { role: 'agent', backendId: 'claude', text: 'A', at: 1 });
    store.append('b', { role: 'agent', backendId: 'gemini', text: 'B', at: 2 });
    const respA = await handleConversationStats(makeReq('?chatId=a'));
    const respB = await handleConversationStats(makeReq('?chatId=b'));
    expect(await respA.json()).toMatchObject({ byBackend: { claude: 1 } });
    expect(await respB.json()).toMatchObject({ byBackend: { gemini: 1 } });
  });
});
