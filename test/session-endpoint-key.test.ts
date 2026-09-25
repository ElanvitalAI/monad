// C2/C3 (2026-07-16·cutover) — 완전 스코프 endpoint 키. 멀티봇·멀티채널·인스턴스 가드를
// 한 키로. sink 가 parse 해 (instance,botId) 가드 후 배달.

import { describe, test, expect } from 'bun:test';

describe('telegram endpoint 키 — build/parse round-trip', () => {
  test('완전 스코프 키 + 파싱', async () => {
    const { telegramEndpointKey, parseTelegramEndpoint } = await import('../src/session/session-endpoint-key.js');
    const k = telegramEndpointKey({ chatId: 42, botId: 'bot9', threadId: 3, instance: 'prod' });
    const p = parseTelegramEndpoint(k)!;
    expect(p).toEqual({ instance: 'prod', botId: 'bot9', chatId: '42', threadId: '3' });
  });

  test('botId/threadId 생략 → 기본(_ · 0)', async () => {
    const { telegramEndpointKey, parseTelegramEndpoint } = await import('../src/session/session-endpoint-key.js');
    const p = parseTelegramEndpoint(telegramEndpointKey({ chatId: 42, instance: 'prod' }))!;
    expect(p.botId).toBe('_');
    expect(p.threadId).toBe('0');
  });

  test('형식 불일치 → null(구 bare chatId 등)', async () => {
    const { parseTelegramEndpoint } = await import('../src/session/session-endpoint-key.js');
    expect(parseTelegramEndpoint('1301607555')).toBeNull();
    expect(parseTelegramEndpoint('dc:x:y:z')).toBeNull();
  });
});

describe('discord endpoint 키', () => {
  test('build/parse', async () => {
    const { discordEndpointKey, parseDiscordEndpoint } = await import('../src/session/session-endpoint-key.js');
    const p = parseDiscordEndpoint(discordEndpointKey({ channelId: 'chan9', botId: 'b1', instance: 'test:foo' }))!;
    expect(p).toEqual({ instance: 'test:foo', botId: 'b1', channelId: 'chan9' });
  });
});

describe('인스턴스 가드 + 봇 가드 (크로스 배달 차단)', () => {
  test('isOwnInstanceEndpoint — 같은 인스턴스만 true', async () => {
    const { isOwnInstanceEndpoint } = await import('../src/session/session-endpoint-key.js');
    expect(isOwnInstanceEndpoint('prod', 'prod')).toBe(true);
    expect(isOwnInstanceEndpoint('test:foo', 'prod')).toBe(false);   // 크로스 인스턴스 차단
  });

  test('matchesBot — botId 일치 or BOT_ANY(_) or sink 봇미상 허용', async () => {
    const { matchesBot } = await import('../src/session/session-endpoint-key.js');
    expect(matchesBot('bot9', 'bot9')).toBe(true);
    expect(matchesBot('bot9', 'other')).toBe(false);   // 틀린 봇 차단
    expect(matchesBot('_', 'bot9')).toBe(true);         // BOT_ANY = 봇 무관
    expect(matchesBot('bot9', undefined)).toBe(true);   // sink 봇미상 허용
  });
});
