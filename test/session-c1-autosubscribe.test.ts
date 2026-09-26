// C1 (2026-07-16·cutover) — auto-subscribe. 서피스 바인딩/텔레그램 세션 생성 시 옛 경로
// 대상을 자동 구독자로 등록 → parity 수신자 일치(flip 안전 신호). 배달 무변경(shadow).

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIG = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-c1-'));
  process.env.ELANOUS_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  _clearSubscriberIndexForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
});

function keys(subs: Array<{ surface: string; endpoint: string }>): string[] {
  return subs.map(s => `${s.surface}:${s.endpoint}`).sort();
}

describe('auto-subscribe on create/attach', () => {
  test('텔레그램 origin 세션 생성 → tgChatId 완전스코프 자동 구독', async () => {
    const S = await import('../src/session/index.js');
    const { telegramEndpointKey } = await import('../src/session/session-endpoint-key.js');
    const m = S.createSession({ source: 'telegram', tgChatId: 555 }, tmp);
    expect(keys(S.listSubscribers(m.id, {}, tmp))).toEqual([`telegram:${telegramEndpointKey({ chatId: 555 })}`]);
  });

  test('cli 세션 생성 → 자동 구독 없음(옛 경로 대상 아님)', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    expect(S.listSubscribers(m.id, {}, tmp)).toEqual([]);
  });

  test('attachTelegramBinding → telegram 완전스코프 자동 구독', async () => {
    const S = await import('../src/session/index.js');
    const { telegramEndpointKey } = await import('../src/session/session-endpoint-key.js');
    const m = S.createSession({ source: 'cli' }, tmp);      // cli 세션(구독 0)
    S.attachTelegramBinding(m.id, 42, undefined, tmp);
    expect(keys(S.listSubscribers(m.id, {}, tmp))).toEqual([`telegram:${telegramEndpointKey({ chatId: 42 })}`]);
  });

  test('attachDiscordBinding → discord 완전스코프 자동 구독', async () => {
    const S = await import('../src/session/index.js');
    const { discordEndpointKey } = await import('../src/session/session-endpoint-key.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.attachDiscordBinding(m.id, 'chan-9', undefined, tmp);
    expect(keys(S.listSubscribers(m.id, {}, tmp))).toEqual([`discord:${discordEndpointKey({ channelId: 'chan-9' })}`]);
  });

  test('멱등 — 재-attach 해도 구독자 1개(dedup)', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.attachTelegramBinding(m.id, 42, undefined, tmp);
    S.autoSubscribeOldPath(m.id, tmp);   // 재호출
    expect(S.listSubscribers(m.id, {}, tmp).length).toBe(1);
  });

  test('parity 시너지 — auto-subscribe 후 새 수신자셋 == 옛 경로 대상(green)', async () => {
    const S = await import('../src/session/index.js');
    const { oldPathRecipientKeys, recordFanoutParity } = await import('../src/session/session-fanout-parity.js');
    const m = S.createSession({ source: 'telegram', tgChatId: 555 }, tmp);
    const meta = S.loadSession(m.id, tmp)!.meta;
    const newR = S.listSubscribers(m.id, {}, tmp).map(s => `${s.surface}:${s.endpoint}`);
    const r = recordFanoutParity({ sessionId: m.id, newRecipients: newR, oldRecipients: oldPathRecipientKeys(meta), contentLen: 5 });
    expect(r.green).toBe(true);          // C1 이 parity green 을 만든다
    expect(r.missingInNew).toEqual([]);
  });
});
