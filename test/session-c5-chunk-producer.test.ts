// C5 (2026-07-16) — 청크 producer 헬퍼. delta/tool/final → fanOutSessionChunk(owner 제외·shadow)
// + 청크 parity. 실 세션 store + 스트리밍 sink 스텁으로 검증.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamingSurfaceSink } from '../src/session/session-fanout.js';
import type { SessionSurface } from '../src/session/index.js';

const ORIG = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-cp-'));
  process.env.ELANOUS_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  const { _clearStreamingSinksForTest } = await import('../src/session/session-fanout.js');
  _clearSubscriberIndexForTest();
  _clearStreamingSinksForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
});

describe('makeChunkProducer', () => {
  test('owner(옛경로) 제외·추가 구독자에만 청크 fan-out (shadow)', async () => {
    const S = await import('../src/session/index.js');
    const { registerStreamingSink } = await import('../src/session/session-fanout.js');
    const { makeChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const { telegramEndpointKey } = await import('../src/session/session-endpoint-key.js');

    // 텔레그램 origin 세션 → auto-subscribe 로 owner(tgChatId) 완전스코프 구독.
    const m = S.createSession({ source: 'telegram', tgChatId: 42 }, tmp);
    // 추가 스트리밍 구독자(다른 chat).
    const extraEp = telegramEndpointKey({ chatId: 99 });
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: extraEp }, {}, tmp);

    const log: string[] = [];
    registerStreamingSink('telegram', {
      onChunk: (endpoint, ev) => log.push(`chunk:${endpoint}:${ev.delta ?? ev.tool?.name ?? ''}`),
      onFinal: (endpoint, ev) => { log.push(`final:${endpoint}:${ev.text}`); },
    } as StreamingSurfaceSink);

    const p = makeChunkProducer(m.id, { streamId: 'st1', root: tmp });
    p.delta('hello');
    p.tool('a', 'Bash', 'call');
    await p.final('hello world');

    // owner(chat 42) 제외 → 추가 구독자(chat 99·extraEp)에만.
    expect(log).toContain(`chunk:${extraEp}:hello`);
    expect(log).toContain(`chunk:${extraEp}:Bash`);
    expect(log).toContain(`final:${extraEp}:hello world`);
    // owner endpoint 로는 안 감.
    const ownerEp = telegramEndpointKey({ chatId: 42 });
    expect(log.some((l) => l.includes(ownerEp))).toBe(false);
  });

  test('flip — primarySurfaces=[telegram] 이면 owner 도 fan-out 배달', async () => {
    const S = await import('../src/session/index.js');
    const { registerStreamingSink } = await import('../src/session/session-fanout.js');
    const { makeChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const { telegramEndpointKey } = await import('../src/session/session-endpoint-key.js');

    const m = S.createSession({ source: 'telegram', tgChatId: 42 }, tmp);  // owner auto-subscribe
    const log: string[] = [];
    registerStreamingSink('telegram', {
      onChunk: (endpoint, ev) => log.push(`chunk:${endpoint}:${ev.delta ?? ''}`),
      onFinal: (endpoint, ev) => { log.push(`final:${endpoint}:${ev.text}`); },
    } as StreamingSurfaceSink);

    // flip: owner 비제외.
    const p = makeChunkProducer(m.id, { streamId: 'st', root: tmp, primarySurfaces: ['telegram'] });
    p.delta('hi');
    await p.final('hi there');

    const ownerEp = telegramEndpointKey({ chatId: 42 });
    expect(log).toContain(`chunk:${ownerEp}:hi`);          // owner 도 스트리밍
    expect(log).toContain(`final:${ownerEp}:hi there`);    // owner 최종 배달
  });

  test('final — 청크 parity 관측 경로 완료(throw 없음)', async () => {
    const S = await import('../src/session/index.js');
    const { makeChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    const p = makeChunkProducer(m.id, { streamId: 'st', root: tmp });
    p.delta('abc');
    // recordChunkParity 는 내부 관측(로그 sink) — 여기선 final 이 throw 없이 완료됨을 확인.
    await expect(p.final('abc')).resolves.toBeUndefined();
  });

  test('fail-soft — sink throw 해도 producer 무중단', async () => {
    const S = await import('../src/session/index.js');
    const { registerStreamingSink } = await import('../src/session/session-fanout.js');
    const { makeChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 'e' }, {}, tmp);
    registerStreamingSink('telegram', {
      onChunk: () => { throw new Error('boom'); },
      onFinal: () => { throw new Error('boom'); },
    } as StreamingSurfaceSink);
    const p = makeChunkProducer(m.id, { streamId: 'st', root: tmp });
    expect(() => p.delta('x')).not.toThrow();
    await expect(p.final('x')).resolves.toBeUndefined();
  });
});
