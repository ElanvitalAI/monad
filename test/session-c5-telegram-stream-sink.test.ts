// C5b (2026-07-16) — 텔레그램 스트리밍 sink. fake transport + 결정론 시계/타이머.
// plain-while-streaming·inline 툴·finalize MarkdownV2+split+reply-thread+plain fallback·
// 인스턴스 가드·스트림 경계·abort.

import { describe, test, expect } from 'bun:test';
import { createTelegramStreamSink, type TelegramStreamTransport } from '../src/session/streaming/telegram-stream-sink.js';
import { telegramEndpointKey } from '../src/session/session-endpoint-key.js';
import type { SessionChunkEvent } from '../src/session/session-fanout.js';

interface Call { op: 'send' | 'edit' | 'chatAction' | 'delete'; chatId: number; messageId?: number; text: string; markdown?: boolean; replyTo?: number }

function harness(opts: { failMarkdown?: boolean } = {}) {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const calls: Call[] = [];
  let nextId = 100;
  const transport: TelegramStreamTransport = {
    send: async (chatId, text, o) => {
      if (opts.failMarkdown && o.markdown) throw new Error('parse entity error');
      calls.push({ op: 'send', chatId, text, markdown: o.markdown, ...(o.replyTo != null ? { replyTo: o.replyTo } : {}) });
      return { messageId: ++nextId };
    },
    edit: async (chatId, messageId, text, o) => {
      if (opts.failMarkdown && o.markdown) throw new Error('parse entity error');
      calls.push({ op: 'edit', chatId, messageId, text, markdown: o.markdown });
    },
    chatAction: async (chatId) => { calls.push({ op: 'chatAction', chatId, text: 'typing' }); },
    delete: async (chatId, messageId) => { calls.push({ op: 'delete', chatId, messageId, text: '' }); },
  };
  return {
    transport, calls,
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      const e = { at: t + ms, fn, cancelled: false }; timers.push(e); return () => { e.cancelled = true; };
    },
    async advance(ms: number) {
      t += ms;
      for (const e of timers.filter((x) => !x.cancelled && x.at <= t).sort((a, b) => a.at - b.at)) { e.cancelled = true; e.fn(); await micro(); }
      await micro();
    },
    async tick() { await micro(); },
  };
}
function micro(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

const EP = telegramEndpointKey({ chatId: 555 }); // 완전스코프 키(현재 인스턴스)

describe('createTelegramStreamSink', () => {
  test('스트리밍 프리뷰 cap — 긴 답변은 tail 만(단일 메시지·다중 방지)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, streamMaxChars: 100, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'x'.repeat(500) }, { sessionId: 'x' });
    await h.tick();
    const sent = h.calls[0]!.text;
    expect(sent.length).toBeLessThanOrEqual(101);   // cap(100) + '…'
    expect(sent.startsWith('…')).toBe(true);          // tail 표기
    // finalize 는 cap 무관 — full 텍스트 배달(split 주입 안 하면 단일).
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'y'.repeat(500) }, { sessionId: 'x' });
    expect(h.calls[h.calls.length - 1]!.text.length).toBe(500);
  });

  test('스트리밍 — 첫 델타 send(plain)·이후 edit(plain)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'Hello' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls).toEqual([{ op: 'send', chatId: 555, text: 'Hello', markdown: false }]);
    sink.onChunk(EP, { streamId: 's1', seq: 1, delta: ' world' }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[1]).toEqual({ op: 'edit', chatId: 555, messageId: 101, text: 'Hello world', markdown: false });
  });

  test('inline 툴 — ⚙️ call → ✓ result 를 스트림 텍스트에 렌더', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'Working' }, { sessionId: 'x' });
    await h.tick();
    sink.onChunk(EP, { streamId: 's1', seq: 1, tool: { id: 'a', name: 'Bash', phase: 'call' } }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[1]!.text).toBe('Working\n\n⚙️ Bash …');
    sink.onChunk(EP, { streamId: 's1', seq: 2, tool: { id: 'a', name: 'Bash', phase: 'result', ok: true } }, { sessionId: 'x' });
    await h.advance(1000);
    expect(h.calls[2]!.text).toBe('Working\n\n⚙️ Bash ✓');
  });

  test('mode=progress — 스트리밍은 compact(🧠/⚙️/💬)·finalize 는 full collapse', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, mode: 'progress', now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, reasoning: '계획' }, { sessionId: 'x' });
    sink.onChunk(EP, { streamId: 's1', seq: 1, delta: '본문 텍스트' }, { sessionId: 'x' });
    await h.tick();        // 첫 편집(reasoning) resolve → 델타 편집 타이머 스케줄
    await h.advance(1100); // throttle 경과 → 델타 편집 반영
    const streamed = h.calls[h.calls.length - 1]!.text;
    expect(streamed).toContain('🧠 계획');
    expect(streamed).toContain('💬 본문 텍스트');
    // finalize 는 모드 무관 full text collapse.
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: '완전한 최종 답변' }, { sessionId: 'x' });
    expect(h.calls[h.calls.length - 1]!.text).toBe('완전한 최종 답변');
  });

  test('레이스 — placeholder send in-flight 중 onFinal 도 collapse(edit)·고아 방지', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, mode: 'progress', now: h.now, schedule: h.schedule });
    // 빠른/짧은 턴 — 첫 델타 직후(placeholder send 미완) 곧바로 onFinal.
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: '지' }, { sessionId: 'x' });
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: '지금은 21:43입니다' }, { sessionId: 'x' });
    await h.tick();
    const sends = h.calls.filter((c) => c.op === 'send');
    const edits = h.calls.filter((c) => c.op === 'edit');
    // placeholder send 는 1번만(고아 "💬 지" 없음)·최종은 그 메시지를 edit(collapse).
    expect(sends.length).toBe(1);
    expect(edits.some((c) => c.text === '지금은 21:43입니다')).toBe(true);
  });

  test('mode=off — 스트리밍 편집 억제(전송 0)·finalize 만', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, mode: 'off', now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'partial' }, { sessionId: 'x' });
    await h.advance(2000);
    expect(h.calls.length).toBe(0); // 편집 없음
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'final' }, { sessionId: 'x' });
    expect(h.calls[0]).toMatchObject({ op: 'send', text: 'final' });
  });

  test('finalize — MarkdownV2 로 placeholder edit(스트리밍은 plain, 최종만 서식)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'partial' }, { sessionId: 'x' });
    await h.tick();
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: '**final**' }, { sessionId: 'x' });
    const last = h.calls[h.calls.length - 1]!;
    expect(last).toEqual({ op: 'edit', chatId: 555, messageId: 101, text: '**final**', markdown: true });
  });

  test('finalize split — 4096 초과 시 reply-threaded 연속 메시지', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, {
      throttleMs: 1000, now: h.now, schedule: h.schedule,
      split: (t) => [t.slice(0, 3), t.slice(3)],   // 강제 2분할
    });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();  // placeholder(msgId 101)
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'ABCDEF' }, { sessionId: 'x' });
    const fin = h.calls.filter((c) => c.text === 'ABC' || c.text === 'DEF');
    expect(fin[0]).toEqual({ op: 'edit', chatId: 555, messageId: 101, text: 'ABC', markdown: true });
    expect(fin[1]).toMatchObject({ op: 'send', text: 'DEF', markdown: true, replyTo: 101 });
  });

  test('finalize markdown fallback — parse 에러 시 plain 재시도', async () => {
    const h = harness({ failMarkdown: true });
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'p' }, { sessionId: 'x' });
    await h.tick();
    await sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'final text' }, { sessionId: 'x' });
    const last = h.calls[h.calls.length - 1]!;
    expect(last).toEqual({ op: 'edit', chatId: 555, messageId: 101, text: 'final text', markdown: false });  // plain 폴백
  });

  test('인스턴스 가드 — 다른 인스턴스 endpoint 는 배달 안 함', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    const foreign = telegramEndpointKey({ chatId: 999, instance: 'other-instance' });
    sink.onChunk(foreign, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls).toEqual([]);
  });

  test('새 스트림(다른 streamId)·abort — 핸들 교체/정리', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'turn1' }, { sessionId: 'x' });
    await h.tick();
    sink.onChunk(EP, { streamId: 's2', seq: 0, delta: 'turn2' }, { sessionId: 'x' });  // 새 스트림
    await h.tick();
    // 새 스트림은 새 placeholder(send) — 두 번째 send.
    expect(h.calls.filter((c) => c.op === 'send').length).toBe(2);
    sink.onAbort!(EP, 's2', { sessionId: 'x' });  // 정리(throw 없음)
    expect(() => sink.onAbort!(EP, 's2', { sessionId: 'x' })).not.toThrow();
  });

  test('§5.2-5 typing governor — 스트림 시작 시 sendChatAction("typing")(gated ON)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, typing: true, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'hi' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls.some((c) => c.op === 'chatAction')).toBe(true);
  });

  test('§5.2-5 typing gated OFF(기본) — chatAction 없음', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, now: h.now, schedule: h.schedule });
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'hi' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls.some((c) => c.op === 'chatAction')).toBe(false);
  });

  test('§10-2 rotation — 임계 초과 편집 후 post-new-then-delete(gated ON)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 100, rotate: true, now: h.now, schedule: h.schedule });
    // 여러 청크로 편집 누적(minEdits 8·dwell 4000·gap 6000 초과되게 시간·횟수 확보).
    for (let i = 0; i < 12; i++) {
      sink.onChunk(EP, { streamId: 's1', seq: i, delta: `x${i}` }, { sessionId: 'x' });
      await h.advance(600); // 편집 간격 + 시간 경과(dwell/gap 충족)
    }
    // rotation 이 한 번이라도 발생 = delete 호출 존재.
    expect(h.calls.some((c) => c.op === 'delete')).toBe(true);
  });

  test('§10-2 rotation gated OFF(기본) — delete 없음', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 100, now: h.now, schedule: h.schedule });
    for (let i = 0; i < 12; i++) {
      sink.onChunk(EP, { streamId: 's1', seq: i, delta: `x${i}` }, { sessionId: 'x' });
      await h.advance(600);
    }
    expect(h.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  test('§5.2-6 fair-queue — supergroup 다중 토픽 라운드로빈(gated ON)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { throttleMs: 1000, fairQueue: true, now: h.now, schedule: h.schedule });
    const A = telegramEndpointKey({ chatId: 700, threadId: 1 });
    const B = telegramEndpointKey({ chatId: 700, threadId: 2 });
    // A·B 동시 스트림 — A 가 먼저 enqueue → A 가 서빙 순번. B 는 A 가 served 될 때까지 편집 대기.
    sink.onChunk(A, { streamId: 'a1', seq: 0, delta: 'A0' }, { sessionId: 'x' });
    sink.onChunk(B, { streamId: 'b1', seq: 0, delta: 'B0' }, { sessionId: 'x' });
    await h.tick();
    // A 는 placeholder send 됨(첫 편집=served). B 는 아직 순번 아님 → send 안 됨.
    const sends = h.calls.filter((c) => c.op === 'send');
    expect(sends.some((c) => c.text === 'A0')).toBe(true);
    expect(sends.some((c) => c.text === 'B0')).toBe(false);
  });
});

describe('봇 스코프 가드 — 크로스봇 "확" 누출 근본수리(2026-07-21)', () => {
  // 여러 봇이 같은 chatId(대표 user id)를 공유 → surface당 sink 1개(last-wins)라 한 봇 sink 가 모든
  // endpoint 청크를 배달하면 다른 봇으로 첫 청크가 "확"으로 샌다. sink botId 가드로 자기 봇만 배달.
  test('다른 봇 endpoint 청크 → 배달 스킵(누출 차단)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { now: h.now, schedule: h.schedule, botId: 'CONATUS' });
    const mainEndpoint = telegramEndpointKey({ chatId: 1301607555, botId: 'MAIN' });
    sink.onChunk(mainEndpoint, { streamId: 's1', seq: 0, delta: '확' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls.filter((c) => c.op === 'send').length).toBe(0);   // conatus sink 는 main 청크 안 보냄
    await sink.onFinal(mainEndpoint, { streamId: 's1', role: 'assistant', text: '확인했습니다' }, { sessionId: 'x' });
    expect(h.calls.length).toBe(0);   // 최종도 스킵
  });

  test('자기 봇 endpoint 청크 → 정상 배달', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { now: h.now, schedule: h.schedule, botId: 'CONATUS' });
    const ep = telegramEndpointKey({ chatId: 1301607555, botId: 'CONATUS' });
    sink.onChunk(ep, { streamId: 's1', seq: 0, delta: '정상' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls.filter((c) => c.op === 'send').some((c) => c.text.includes('정상'))).toBe(true);
  });

  test('BOT_ANY endpoint(구버전) → 하위호환 배달(가드 무영향)', async () => {
    const h = harness();
    const sink = createTelegramStreamSink(h.transport, { now: h.now, schedule: h.schedule, botId: 'CONATUS' });
    const anyEp = telegramEndpointKey({ chatId: 555 });   // botId 미지정 = BOT_ANY
    sink.onChunk(anyEp, { streamId: 's1', seq: 0, delta: 'ok' }, { sessionId: 'x' });
    await h.tick();
    expect(h.calls.filter((c) => c.op === 'send').length).toBeGreaterThan(0);
  });
});
