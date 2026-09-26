// session list 노이즈 필터 + 내용 프리뷰 (2026-07-16) — 대표 UX 요청:
// cli/미션 spawn 노이즈 제외 + 리스트에 세션 내용 표현.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIG = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sess-list-')); process.env.ELANOUS_SESSION_ROOT = tmp; });
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
});

async function seed() {
  const S = await import('../src/session/index.js');
  for (let i = 0; i < 3; i++) S.createSession({ source: 'cli', title: 'mission:apm_defcon_x' }, tmp); // 빈 미션
  const mm = S.createSession({ source: 'cli', title: 'mission:apm_briefing' }, tmp);                  // 내용 미션
  S.appendMessage(mm.id, { role: 'user', content: '미션 실행 로그' }, tmp);
  const c = S.createSession({ source: 'cli', title: 'ssh into node-b' }, tmp);                           // 대화 cli
  S.appendMessage(c.id, { role: 'user', content: 'what ports is node-b exposing?' }, tmp);
  const t = S.createSession({ source: 'telegram', title: 'tg:1301607555', tgChatId: 1301607555 }, tmp);
  S.appendMessage(t.id, { role: 'assistant', content: '🌅 브리핑 내용' }, tmp);
  return { S, mm, c, t };
}

describe('listSessions 노이즈 필터', () => {
  test('hideEmptyMissions — 빈 mission:* 만 숨김(내용 미션·일반 세션 유지)', async () => {
    const { S, mm, c, t } = await seed();
    const hidden = S.listSessions({ hideEmptyMissions: true }, tmp);
    const ids = hidden.map(m => m.id);
    expect(ids).toContain(mm.id);   // 내용 미션 유지
    expect(ids).toContain(c.id);
    expect(ids).toContain(t.id);
    expect(hidden.filter(m => S.isMissionSession(m) && m.messageCount === 0).length).toBe(0); // 빈 미션 0
    expect(S.listSessions({}, tmp).length).toBe(6);           // 미숨김 = 전체 6
    expect(hidden.length).toBe(3);                            // 빈 미션 3 제거
  });

  test('excludeSources — cli 제외', async () => {
    const { S, t } = await seed();
    const noCli = S.listSessions({ excludeSources: ['cli'] }, tmp);
    expect(noCli.length).toBe(1);
    expect(noCli[0].id).toBe(t.id);
  });

  test('minMessages — 빈 세션 전부 제외', async () => {
    const { S } = await seed();
    const nonEmpty = S.listSessions({ minMessages: 1 }, tmp);
    expect(nonEmpty.every(m => m.messageCount >= 1)).toBe(true);
    expect(nonEmpty.length).toBe(3);   // 내용 미션 + cli 대화 + telegram
  });

  test('hideEmpty — 빈(0msg) 세션 전부 숨김(mission·"(new session)" 모두)', async () => {
    const { S } = await seed();
    // "(new session)" 빈 세션도 노이즈 — mission 아님.
    S.createSession({ source: 'cli' }, tmp);            // title="(new session)" 0msg
    const shown = S.listSessions({ hideEmpty: true }, tmp);
    expect(shown.every(m => m.messageCount > 0)).toBe(true);
    expect(shown.length).toBe(3);                       // 내용 있는 3개만
  });

  test('hideEmpty + keepIds — 활성 빈 세션은 예외로 유지', async () => {
    const { S } = await seed();
    const fresh = S.createSession({ source: 'cli', title: '방금 만든 빈 세션' }, tmp); // 0msg
    const kept = S.listSessions({ hideEmpty: true, keepIds: [fresh.id] }, tmp);
    expect(kept.map(m => m.id)).toContain(fresh.id);    // 활성 유지
    expect(kept.filter(m => m.messageCount === 0 && m.id !== fresh.id).length).toBe(0);
  });

  test('isMissionSession — title mission: 접두', async () => {
    const { S, mm, c } = await seed();
    expect(S.isMissionSession(S.loadSession(mm.id, tmp)!.meta)).toBe(true);
    expect(S.isMissionSession(S.loadSession(c.id, tmp)!.meta)).toBe(false);
  });
});

describe('lastConversationMessage — 리스트 프리뷰', () => {
  test('마지막 비-tool 메시지(끝에서)', async () => {
    const { S, c } = await seed();
    S.appendMessage(c.id, { role: 'assistant', content: '22, 443, 5432' }, tmp);
    S.appendMessage(c.id, { role: 'tool', content: 'noise', toolName: 'x' }, tmp); // tool 스킵돼야
    const last = S.lastConversationMessage(c.id, tmp);
    expect(last).not.toBeNull();
    expect(last!.role).toBe('assistant');
    expect(last!.content).toBe('22, 443, 5432');
  });

  test('빈 세션 → null(프리뷰 없음)', async () => {
    const { S } = await seed();
    const empty = S.createSession({ source: 'cli', title: 'mission:apm_defcon_x' }, tmp);
    expect(S.lastConversationMessage(empty.id, tmp)).toBeNull();
  });
});
