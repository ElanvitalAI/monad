// G3 — ACP-client 백엔드 전사(S2) read-through 모듈. persistence API 재사용·role 교대추론.

import { test, expect } from 'bun:test';
import {
  listAcpBackendSessions,
  loadAcpBackendSession,
  searchAcpBackendSessions,
  isAcpBackendSessionId,
} from '../src/domains/acp-backend-sessions.js';

const FIXTURE = [
  {
    sessionId: 'acp-cli:codex-app-server:session/01ABC',
    backendSessionId: 'raw-01ABC',
    backendId: 'codex-app-server',
    cwd: '/repo',
    protocolVersion: 1,
    planSnapshot: null,
    toolCalls: [],
    createdAt: 1000,
    lastSeenAt: 2000,
    history: [
      { type: 'text', text: '조선의 왕 알려줘' },
      { type: 'text', text: '조선의 왕은 보통 27명입니다.' },
      { type: 'image' }, // 비-text 블록 → [image] 플레이스홀더(짝수=user)
      { type: 'text', text: '고맙습니다' },
    ],
  },
];

function fakePersistence(sessions: unknown[] = FIXTURE) {
  return {
    list: () => sessions,
    load: (id: string) => sessions.find((s) => (s as { sessionId: string }).sessionId === id) ?? null,
  } as unknown as Parameters<typeof listAcpBackendSessions>[0];
}

test('listAcpBackendSessions: S2 → SessionMeta 호환(origin=acp·source=cli·title·messageCount)', () => {
  const items = listAcpBackendSessions(fakePersistence());
  expect(items.length).toBe(1);
  expect(items[0].origin).toBe('acp');
  expect(items[0].source).toBe('cli');
  expect(items[0].backendId).toBe('codex-app-server');
  expect(items[0].title).toContain('조선');
  expect(items[0].messageCount).toBe(4);
  expect(items[0].updatedAt).toBe(2000); // lastSeenAt
});

test('loadAcpBackendSession: 교대추론 role(짝=user·홀=assistant) + 비-text 플레이스홀더', () => {
  const b = loadAcpBackendSession('acp-cli:codex-app-server:session/01ABC', fakePersistence());
  expect(b).not.toBeNull();
  expect(b!.messages[0]).toEqual({ role: 'user', content: '조선의 왕 알려줘' });
  expect(b!.messages[1].role).toBe('assistant');
  expect(b!.messages[1].content).toContain('27명');
  expect(b!.messages[2]).toEqual({ role: 'user', content: '[image]' });
  expect(b!.messages[3].role).toBe('assistant');
});

test('loadAcpBackendSession: prefix 유일 매칭', () => {
  const b = loadAcpBackendSession('acp-cli:codex-app-server:session/01A', fakePersistence());
  expect(b).not.toBeNull();
  expect(b!.meta.id).toBe('acp-cli:codex-app-server:session/01ABC');
});

test('searchAcpBackendSessions: 내용 매치 + 스니펫 role', () => {
  const hits = searchAcpBackendSessions('27명', fakePersistence());
  expect(hits.length).toBe(1);
  expect(hits[0].matchCount).toBe(1);
  expect(hits[0].snippets[0].role).toBe('assistant');
  expect(searchAcpBackendSessions('없는단어', fakePersistence()).length).toBe(0);
});

test('isAcpBackendSessionId', () => {
  expect(isAcpBackendSessionId('acp-cli:codex:x')).toBe(true);
  expect(isAcpBackendSessionId('acp-cli_codex_x')).toBe(true);
  expect(isAcpBackendSessionId('elanous-session-1')).toBe(false);
  expect(isAcpBackendSessionId('550e8400-uuid')).toBe(false);
});
