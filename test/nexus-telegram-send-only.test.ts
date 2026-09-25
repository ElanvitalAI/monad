// `poll: false` — 배달 싱크만 세우고 getUpdates 는 한 번도 안 부른다(폴링은 넥서스 밖 `monad telegram run` 몫).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createNexusTelegramTriggerBot } from '../src/nexus/api/telegram-trigger-bot';

function recordingFetch(urls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    urls.push(String(input));
    // getUpdates 는 빈 결과를 느리게 돌려준다(폴링 루프가 돌면 여러 번 찍힌다).
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('telegram trigger bot poll switch', () => {
  test('poll:false never calls getUpdates and stops without draining a poll loop', async () => {
    const urls: string[] = [];
    const handle = createNexusTelegramTriggerBot({
      token: '111:send-only', allowedUsers: [], dispatch: async () => undefined,
      fetchImpl: recordingFetch(urls), poll: false, log: () => {},
    });
    expect(handle).not.toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(urls.filter((u) => u.includes('getUpdates'))).toEqual([]);
    const t0 = Date.now();
    await handle!.stop({ timeoutMs: 2_000 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test('default still polls (positive control for the same ruler)', async () => {
    const urls: string[] = [];
    const handle = createNexusTelegramTriggerBot({
      token: '111:polls', allowedUsers: [], dispatch: async () => undefined,
      fetchImpl: recordingFetch(urls), log: () => {},
    });
    await new Promise((r) => setTimeout(r, 60));
    await handle!.stop({ timeoutMs: 2_000 });
    expect(urls.some((u) => u.includes('getUpdates'))).toBe(true);
  });

  test('the nexus standalone branch builds its delivery bots with poll:false', () => {
    const source = readFileSync(new URL('../src/nexus/index.ts', import.meta.url), 'utf8');
    const branch = source.slice(source.indexOf("if (cfg.telegram.poller === 'standalone')"), source.indexOf('} else {', source.indexOf("if (cfg.telegram.poller === 'standalone')")));
    expect(branch).toContain('createNexusTelegramTriggerBot({ ...opts, poll: false })');
    expect(branch).toContain('telegramPollerHandles.push(handle)');
  });
});
