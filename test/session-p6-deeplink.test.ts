// P6 (2026-07-16) — @session:<id> 딥링크 + attach/detach 노출.
// 크로스서피스 참조: 한 서피스 링크 방출 → 다른 서피스 열기.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('session-deeplink 파서', () => {
  test('format → @session:<8자 prefix>', async () => {
    const { formatSessionDeepLink } = await import('../src/session/session-deeplink.js');
    expect(formatSessionDeepLink('124aa289-dead-beef-0000-111122223333')).toBe('@session:124aa289');
  });

  test('extract — 텍스트에서 토큰 추출(중복 제거)', async () => {
    const { extractSessionDeepLinks } = await import('../src/session/session-deeplink.js');
    const got = extractSessionDeepLinks('열어봐 @session:124aa289 그리고 @session:abcd1234 또 @session:124aa289');
    expect(got).toEqual(['124aa289', 'abcd1234']);
  });
});

describe('딥링크 해소 + open (dispatch)', () => {
  const ORIG = process.env.ELANOUS_SESSION_ROOT;
  let tmp: string;
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sess-p6-'));
    process.env.ELANOUS_SESSION_ROOT = tmp;
    const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
    _clearSubscriberIndexForTest();
  });
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
  });

  test('한 서피스 링크 방출 → 다른 서피스 open(해소+문맥)', async () => {
    const S = await import('../src/session/index.js');
    const { formatSessionDeepLink, resolveSessionDeepLink } = await import('../src/session/session-deeplink.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const m = S.createSession({ source: 'cli', title: '크로스서피스' }, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);

    const link = formatSessionDeepLink(m.id);               // 방출
    expect(resolveSessionDeepLink(link, tmp)).toBe(m.id);   // 해소(접두 포함)

    const opened = await dispatchSessionQuery({ action: 'deeplink', token: link }, { root: tmp }) as { found: boolean; sessionId: string; formatted: string };
    expect(opened.found).toBe(true);
    expect(opened.sessionId).toBe(m.id);
    expect(opened.formatted).toContain('pwa:p');            // 다른 서피스가 "누가 보는지" 봄
  });

  test('adopt persists explicit and defaulted source provenance in the index', async () => {
    const S = await import('../src/session/index.js');
    S.adoptSession('declared-cli-session', { source: 'cli' }, tmp);
    S.adoptSession('default-session', {}, tmp);
    const persisted = S.listSessions({}, tmp);
    expect(persisted.find(meta => meta.id === 'declared-cli-session')).toMatchObject({
      source: 'cli', sourceSource: 'declared',
    });
    expect(persisted.find(meta => meta.id === 'default-session')).toMatchObject({
      source: 'cli', sourceSource: 'default',
    });
  });

  test('없는 링크 → found=false(안내)', async () => {
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const res = await dispatchSessionQuery({ action: 'deeplink', token: '@session:nope9999' }, { root: tmp }) as { found: boolean };
    expect(res.found).toBe(false);
  });

  test('persona metadata persists while persona-less sessions retain their index shape', async () => {
    const S = await import('../src/session/index.js');
    const persona = S.createSession({ source: 'cli', personaId: 'sage' }, tmp);
    const ordinary = S.createSession({ source: 'cli' }, tmp);
    const persisted = S.listSessions({}, tmp);
    expect(persisted.find(meta => meta.id === persona.id)?.personaId).toBe('sage');
    expect(persisted.find(meta => meta.id === ordinary.id)?.personaId).toBeUndefined();
  });

  test('persona resident lookup reuses one session per persona and persists it across reloads', async () => {
    const S = await import('../src/session/index.js');
    const first = S.getOrCreatePersonaSession('sage', { source: 'cli' }, tmp);
    const again = S.getOrCreatePersonaSession('sage', { source: 'cli' }, tmp);
    const other = S.getOrCreatePersonaSession('pragmatist', { source: 'cli' }, tmp);
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(S.listSessions({}, tmp).find(meta => meta.id === first.id)?.personaId).toBe('sage');
    expect(S.getOrCreatePersonaSession('sage', { source: 'telegram' }, tmp).id).toBe(first.id);
  });

  test('concurrent resident lookups preserve one session per persona and every index entry', async () => {
    const S = await import('../src/session/index.js');
    const personas = ['sage', 'sage', 'sage', 'pragmatist', 'contrarian'];
    const sessions = await Promise.all(personas.map(personaId => Promise.resolve().then(
      () => S.getOrCreatePersonaSession(personaId, { source: 'cli' }, tmp),
    )));
    expect(new Set(sessions.filter(session => session.personaId === 'sage').map(session => session.id)).size).toBe(1);
    const persisted = S.listSessions({}, tmp);
    expect(new Set(persisted.map(meta => meta.personaId))).toEqual(new Set(['sage', 'pragmatist', 'contrarian']));
  });

  test('persona resident lookup does not change Telegram botId-scoped lookup', async () => {
    const S = await import('../src/session/index.js');
    const first = S.createSession({ source: 'telegram', tgChatId: 41, tgBotId: 'bot-a' }, tmp);
    const second = S.createSession({ source: 'telegram', tgChatId: 41, tgBotId: 'bot-b' }, tmp);
    S.getOrCreatePersonaSession('sage', { source: 'cli' }, tmp);
    expect(S.findSessionByTelegramChat(41, undefined, 'bot-a', tmp)?.id).toBe(first.id);
    expect(S.findSessionByTelegramChat(41, undefined, 'bot-b', tmp)?.id).toBe(second.id);
  });
});

describe('attach/detach 바인딩 노출', () => {
  const ORIG = process.env.ELANOUS_SESSION_ROOT;
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sess-p6b-')); process.env.ELANOUS_SESSION_ROOT = tmp; });
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
  });

  test('telegram attach → detach 왕복', async () => {
    const S = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    const at = await dispatchSessionQuery({ action: 'attach', sessionId: m.id, surface: 'telegram', endpoint: 999 }, { root: tmp }) as { error?: string };
    expect(at.error).toBeUndefined();
    expect(S.findSessionByTelegramChat(999, undefined, undefined, tmp)?.id).toBe(m.id);
    const dt = await dispatchSessionQuery({ action: 'detach', sessionId: m.id, surface: 'telegram' }, { root: tmp }) as { detached: boolean };
    expect(dt.detached).toBe(true);
  });

  test('attach 잘못된 surface → error', async () => {
    const S = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    const res = await dispatchSessionQuery({ action: 'attach', sessionId: m.id, surface: 'pwa', endpoint: 'x' }, { root: tmp }) as { error?: string };
    expect(res.error).toBeDefined();
  });
});
