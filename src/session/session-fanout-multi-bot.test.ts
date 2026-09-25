// 🩸 2026-09-25 — 봇 둘이 같은 서피스로 sink 를 등록하면 나중 것이 앞 것을 «교체»해 main 봇의 답이 사라졌다(운영 실측).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  _clearStreamingSinksForTest, _clearSurfaceSinksForTest, _streamingSinkForTest, _surfaceSinkForTest,
  registerStreamingSink, registerSurfaceSink, type StreamingSurfaceSink,
} from './session-fanout.js';

beforeEach(() => { _clearStreamingSinksForTest(); _clearSurfaceSinksForTest(); });
afterEach(() => { _clearStreamingSinksForTest(); _clearSurfaceSinksForTest(); });

const ctx = { sessionId: 's' };
const ev = { streamId: 's:1', delta: 'x' } as never;

/** 실제 텔레그램 sink 와 같은 규칙: 자기 봇 스코프 endpoint ⊕ bare chatId 를 받아들인다. */
function botSink(botId: string, log: string[]): StreamingSurfaceSink {
  const mine = (ep: string) => ep.startsWith(`${botId}:`) || /^\d+$/.test(ep);
  return {
    accepts: mine,
    onChunk: (ep) => { if (mine(ep)) log.push(`${botId} chunk ${ep}`); },
    onFinal: (ep) => { if (mine(ep)) log.push(`${botId} final ${ep}`); },
  };
}

describe('two bots on one streaming surface', () => {
  test('each bot-scoped endpoint reaches its own bot — the second registration does not replace the first', async () => {
    const log: string[] = [];
    registerStreamingSink('telegram', botSink('main', log));
    registerStreamingSink('telegram', botSink('conatus', log));
    const sink = _streamingSinkForTest('telegram')!;
    sink.onChunk('main:42', ev, ctx);
    sink.onChunk('conatus:42', ev, ctx);
    await sink.onFinal('main:42', ev, ctx);
    expect(log).toEqual(['main chunk main:42', 'conatus chunk conatus:42', 'main final main:42']);
  });
  test('a bare (unscoped) chatId is delivered exactly once — by the first registered bot', () => {
    const log: string[] = [];
    registerStreamingSink('telegram', botSink('main', log));
    registerStreamingSink('telegram', botSink('conatus', log));
    _streamingSinkForTest('telegram')!.onChunk('42', ev, ctx);
    expect(log).toEqual(['main chunk 42']);
  });
  test('unregistering one bot keeps the other', () => {
    const log: string[] = [];
    const offMain = registerStreamingSink('telegram', botSink('main', log));
    registerStreamingSink('telegram', botSink('conatus', log));
    offMain();
    _streamingSinkForTest('telegram')!.onChunk('conatus:7', ev, ctx);
    _streamingSinkForTest('telegram')!.onChunk('main:7', ev, ctx);
    expect(log).toEqual(['conatus chunk conatus:7']);
  });
  test('a single sink is used as-is (no wrapper) — acp/discord unchanged', () => {
    const s = botSink('only', []);
    registerStreamingSink('acp', s);
    expect(_streamingSinkForTest('acp')).toBe(s);
  });
});

describe('two bots on one surface sink (non-streaming delivery)', () => {
  test('routes by accepts and never double-delivers', async () => {
    const got: string[] = [];
    registerSurfaceSink('telegram', { accepts: (ep) => ep.startsWith('main:') || /^\d+$/.test(ep), deliver: async (ep) => { got.push(`main ${ep}`); } });
    registerSurfaceSink('telegram', { accepts: (ep) => ep.startsWith('conatus:') || /^\d+$/.test(ep), deliver: async (ep) => { got.push(`conatus ${ep}`); } });
    const sink = _surfaceSinkForTest('telegram')!;
    await sink.deliver('conatus:1', { kind: 'message', text: 't' }, ctx);
    await sink.deliver('main:1', { kind: 'message', text: 't' }, ctx);
    await sink.deliver('9', { kind: 'message', text: 't' }, ctx);
    expect(got).toEqual(['conatus conatus:1', 'main main:1', 'main 9']);
  });
});
