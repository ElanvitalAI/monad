// C5c (2026-07-16) — 디스코드 스트리밍 sink. fake transport + 결정론 시계/타이머.
// 스트리밍 plain·inline 툴·finalize split+reply-thread·인스턴스 가드·스트림 경계.

import { describe, test, expect } from 'bun:test';
import { createDiscordStreamSink, type DiscordStreamTransport } from '../src/session/streaming/discord-stream-sink.js';
import { discordEndpointKey } from '../src/session/session-endpoint-key.js';

interface Call { op: 'send' | 'edit'; channelId: string; messageId?: string; text: string; replyTo?: string; suppressEmbeds?: boolean }

function harness() {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const calls: Call[] = [];
  let nextId = 100;
  const transport: DiscordStreamTransport = {
    send: async (channelId, text, o) => {
      calls.push({ op: 'send', channelId, text, ...(o.replyTo != null ? { replyTo: o.replyTo } : {}), ...(o.suppressEmbeds ? { suppressEmbeds: true } : {}) });
      return { messageId: String(++nextId) };
    },
    edit: async (channelId, messageId, text) => { calls.push({ op: 'edit', channelId, messageId, text }); },
  };
  return {
    transport, calls,
    now: () => t,
    schedule: (fn: () => void, ms: number) => { const e = { at: t + ms, fn, cancelled: false }; timers.push(e); return () => { e.cancelled = true; }; },
    async advance(ms: number) {
      t += ms;
      for (const e of timers.filter((x) => !x.cancelled && x.at <= t).sort((a, b) => a.at - b.at)) { e.cancelled = true; e.fn(); await micro(); }
      await micro();
    },
    async tick() { await micro(); },
  };
}
function micro(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

const EP = discordEndpointKey({ channelId: 'chan-1' });

describe('createDiscordStreamSink', () => {
  test('스트리밍 — 첫 델타 send·이후 edit(plain content)', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'Hi' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls[0]).toEqual({ op: 'send', channelId: 'chan-1', text: 'Hi', suppressEmbeds: true });
    sink.onChunk(EP, { streamId: 's1', seq: 1, delta: ' there' }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[1]).toEqual({ op: 'edit', channelId: 'chan-1', messageId: '101', text: 'Hi there' });
  });

  test('inline 툴 — ⚙️…✓', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'Run' }, { sessionId: 'x' });
    await h.tick();
    sink.onChunk(EP, { streamId: 's1', seq: 1, tool: { id: 'a', name: 'Edit', phase: 'call' } }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[1]!.text).toBe('Run\n\n⚙️ Edit …');
    sink.onChunk(EP, { streamId: 's1', seq: 2, tool: { id: 'a', name: 'Edit', phase: 'result', ok: true } }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[2]!.text).toBe('Run\n\n⚙️ Edit ✓');
  });

  test('finalize split — 2000 초과 시 reply-threaded 연속', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, {
      throttleMs: 1000, now: h.now, schedule: h.schedule, split: (t) => [t.slice(0, 2), t.slice(2)],
    });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'ABCD' }, { sessionId: 'x' });
    const fin = h.calls.filter((c) => c.text === 'AB' || c.text === 'CD');
    expect(fin[0]).toEqual({ op: 'edit', channelId: 'chan-1', messageId: '101', text: 'AB' });
    expect(fin[1]).toMatchObject({ op: 'send', text: 'CD', replyTo: '101' });
  });

  test('인스턴스 가드 — 다른 인스턴스 endpoint 배달 안 함', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(discordEndpointKey({ channelId: 'c', instance: 'other' }), { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls).toEqual([]);
  });

  test('abort — 핸들 정리(throw 없음)', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();
    expect(() => sink.onAbort!(EP, 's1', { sessionId: 'x' })).not.toThrow();
  });

  test('suppressEmbeds — create 에 SUPPRESS_EMBEDS(기본 true·링크 unfurl 억제)', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'https://a.com' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls[0]).toMatchObject({ op: 'send', suppressEmbeds: true });
  });

  test('suppressEmbeds=false 시 create 에 플래그 없음', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, suppressEmbeds: false, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls[0]!.suppressEmbeds).toBeUndefined();
  });

  test('generation guard — 새 스트림 진행 중 옛 finalize 는 새 placeholder 를 clobber 안 함', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    // 스트림 s1 시작(placeholder 101).
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'old' }, { sessionId: 'x' });
    await h.tick();
    // 같은 endpoint 에 새 스트림 s2 진입(placeholder 102).
    sink.onChunk(EP, { streamId: 's2', seq: 0, delta: 'new' }, { sessionId: 'x' });
    await h.tick();
    const before = h.calls.length;
    // 뒤늦게 s1 finalize 도착 — s2(102) placeholder 를 edit 하면 안 됨. fresh send 여야.
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'old final' }, { sessionId: 'x' });
    const fin = h.calls.slice(before);
    expect(fin.every((c) => !(c.op === 'edit' && c.messageId === '102'))).toBe(true);
    expect(fin.some((c) => c.op === 'send' && c.text === 'old final')).toBe(true);
  });

  test('generation guard — 옛 abort 는 새 스트림 핸들 안 죽임', async () => {
    const h = harness();
    const sink = createDiscordStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'a' }, { sessionId: 'x' });
    await h.tick();
    sink.onChunk(EP, { streamId: 's2', seq: 0, delta: 'b' }, { sessionId: 'x' });
    await h.tick();
    sink.onAbort!(EP, 's1', { sessionId: 'x' }); // 옛 스트림 abort — s2 는 계속돼야
    sink.onChunk(EP, { streamId: 's2', seq: 1, delta: 'c' }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls.some((c) => c.text.includes('bc'))).toBe(true); // s2 계속 편집됨
  });
});
