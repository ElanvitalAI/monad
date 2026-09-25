// C5a (2026-07-16) — 청크(스트리밍) fan-out. 구독자별 StreamingSurfaceSink 라우팅·excludeKeys·
// left 제외·fail-soft·finalize/abort. 메시지레벨(fanOutSessionOutput)과 별개 경로.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamingSurfaceSink, SessionChunkEvent, SessionStreamFinal } from '../src/session/session-fanout.js';
import type { SessionSurface } from '../src/session/index.js';

const ORIG = process.env.MONAD_SESSION_ROOT;
let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-c5-'));
  process.env.MONAD_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  const { _clearStreamingSinksForTest } = await import('../src/session/session-fanout.js');
  _clearSubscriberIndexForTest();
  _clearStreamingSinksForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.MONAD_SESSION_ROOT; else process.env.MONAD_SESSION_ROOT = ORIG;
});

function recSink(log: Array<[string, string]>, surface: string): StreamingSurfaceSink {
  return {
    onChunk: (endpoint, ev) => log.push([`${surface}:chunk`, `${endpoint}:${ev.delta ?? ev.tool?.name ?? ''}`]),
    onFinal: (endpoint, ev) => { log.push([`${surface}:final`, `${endpoint}:${ev.text}`]); },
    onAbort: (endpoint, streamId) => log.push([`${surface}:abort`, `${endpoint}:${streamId}`]),
  };
}

describe('fanOutSessionChunk', () => {
  test('청크를 스트리밍 구독자에 라우팅 — active 만·left 제외', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionChunk } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'discord', endpoint: 'd' }, {}, tmp);
    S.setSubscriberPresence(m.id, S.subscriberKey('discord', 'd'), 'left', tmp);
    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, StreamingSurfaceSink>([
      ['telegram', recSink(log, 'tg')], ['discord', recSink(log, 'dc')],
    ]);
    const ev: SessionChunkEvent = { streamId: 's1', seq: 0, delta: 'hi' };
    const r = fanOutSessionChunk(m.id, ev, { sinks, root: tmp });
    expect(r.targeted).toBe(1);                        // telegram 만(discord left)
    expect(log).toEqual([['tg:chunk', 't:hi']]);
  });

  test('excludeKeys — 옛경로 커버 구독자 제외(shadow)', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionChunk } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 'owner' }, {}, tmp);  // 옛경로(제외)
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 'extra' }, {}, tmp);  // 추가(배달)
    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, StreamingSurfaceSink>([['telegram', recSink(log, 'tg')]]);
    fanOutSessionChunk(m.id, { streamId: 's1', seq: 0, delta: 'x' },
      { sinks, root: tmp, excludeKeys: [S.subscriberKey('telegram', 'owner')] });
    expect(log).toEqual([['tg:chunk', 'extra:x']]);    // owner 제외
  });

  test('한 sink onChunk throw → 다른 구독자 무중단(fail-soft)', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionChunk } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'discord', endpoint: 'd' }, {}, tmp);
    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, StreamingSurfaceSink>([
      ['telegram', { onChunk: () => { throw new Error('down'); }, onFinal: () => {} }],
      ['discord', recSink(log, 'dc')],
    ]);
    const r = fanOutSessionChunk(m.id, { streamId: 's1', seq: 0, delta: 'x' }, { sinks, root: tmp });
    expect(r.targeted).toBe(2);
    expect(log).toEqual([['dc:chunk', 'd:x']]);        // discord 무중단
  });

  test('fanOutSessionFinal — 라이브핸들 마감', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionFinal } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);
    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, StreamingSurfaceSink>([['telegram', recSink(log, 'tg')]]);
    const ev: SessionStreamFinal = { streamId: 's1', role: 'assistant', text: 'done' };
    const r = await fanOutSessionFinal(m.id, ev, { sinks, root: tmp });
    expect(r.targeted).toBe(1);
    expect(log).toEqual([['tg:final', 't:done']]);
  });

  test('fanOutSessionAbort — 라이브핸들 정리', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionAbort } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);
    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, StreamingSurfaceSink>([['telegram', recSink(log, 'tg')]]);
    fanOutSessionAbort(m.id, 's1', { sinks, root: tmp });
    expect(log).toEqual([['tg:abort', 't:s1']]);
  });

  test('registerStreamingSink 등록/해제', async () => {
    const { registerStreamingSink, registeredStreamingSurfaces } = await import('../src/session/session-fanout.js');
    const off = registerStreamingSink('telegram', { onChunk: () => {}, onFinal: () => {} });
    expect(registeredStreamingSurfaces()).toContain('telegram');
    off();
    expect(registeredStreamingSurfaces()).not.toContain('telegram');
  });
});

describe('recordChunkParity — 청크 유실 감지', () => {
  test('green — 누적 스트림 == 최종 메시지·수신자 유실 0', async () => {
    const { recordChunkParity } = await import('../src/session/session-fanout-parity.js');
    const logs: Array<[string, string]> = [];
    const r = recordChunkParity(
      { sessionId: 's', streamId: 'st1', streamedText: 'hello world', finalText: 'hello world',
        newRecipients: ['telegram:t'], oldRecipients: ['telegram:t'] },
      { logSink: (c, e) => logs.push([c, e]) },
    );
    expect(r.green).toBe(true);
    expect(r.contentFaithful).toBe(true);
    expect(logs[0]).toEqual(['session.chunk-parity', 'green']);
  });

  test('공백 정규화 — trailing/중복 공백 차이는 무해(green)', async () => {
    const { recordChunkParity } = await import('../src/session/session-fanout-parity.js');
    const r = recordChunkParity({ sessionId: 's', streamId: 'st', streamedText: 'a  b\n', finalText: 'a b' });
    expect(r.green).toBe(true);
  });

  test('green — 스트림이 최종의 prefix + 대부분 커버(footer 델타 허용·실측 1447/1498)', async () => {
    const { recordChunkParity } = await import('../src/session/session-fanout-parity.js');
    const streamed = 'x'.repeat(1447);
    const final = streamed + '\n\n— 실행 footer 51자짜리 꼬리표를 여기 붙임 (finalize)';
    const r = recordChunkParity({ sessionId: 's', streamId: 'st', streamedText: streamed, finalText: final });
    expect(r.green).toBe(true);
    expect(r.contentFaithful).toBe(true);
  });

  test('loss — 누적 != 최종(청크 유실)', async () => {
    const { recordChunkParity } = await import('../src/session/session-fanout-parity.js');
    const logs: Array<[string, string]> = [];
    const r = recordChunkParity(
      { sessionId: 's', streamId: 'st', streamedText: 'hel', finalText: 'hello world' },
      { logSink: (c, e) => logs.push([c, e]) },
    );
    expect(r.green).toBe(false);
    expect(r.contentFaithful).toBe(false);
    expect(logs[0]).toEqual(['session.chunk-parity', 'loss']);
  });

  test('loss — 수신자 유실(옛엔 있는데 청크 fan-out 놓침)', async () => {
    const { recordChunkParity } = await import('../src/session/session-fanout-parity.js');
    const r = recordChunkParity({ sessionId: 's', streamId: 'st', streamedText: 'x', finalText: 'x',
      newRecipients: [], oldRecipients: ['telegram:t'] });
    expect(r.green).toBe(false);
    expect(r.missingInNew).toEqual(['telegram:t']);
  });
});
