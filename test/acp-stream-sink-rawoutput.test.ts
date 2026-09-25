// ── 툴 «결과»가 ACP `rawOutput` 으로 실려 나가나 ──
//
// ⛔⭐ **이름을 짓지 않는다.** `rawOutput` 은 우리가 쓰는 프로토콜 SDK 의 스키마에 있고
//    (`@agentclientprotocol/sdk/schema/schema.json`), 이 저장소의 대시보드가 «이미» 그 이름으로
//    읽는다(`src/tui-client/dashboard-session.ts:539·567`). ⇒ 채우면 TUI 가 «코드 변경 없이» 받는다.
//
// ⛔⭐⭐ **「안 왔다」의 «사유»를 이 층이 만들지 않는다.**
//    선택 인자를 «생략한 것»과 «undefined 를 넘긴 것»은 여기서 구분할 수 «없다» —
//    그런데도 사유를 붙이면 ***모르는 것을 단정***하게 된다. 값이 있으면 싣고 없으면 침묵한다.

import { describe, test, expect } from 'bun:test';
import { createAcpStreamSink } from '../src/session/streaming/acp-stream-sink';

type Broadcast = { sessionId: string; update: Record<string, unknown> };

function collect(): { sent: Broadcast[]; broadcast: (s: string, u: Record<string, unknown>) => Promise<void> } {
  const sent: Broadcast[] = [];
  return {
    sent,
    broadcast: async (sessionId, update) => { sent.push({ sessionId, update }); },
  };
}

describe('acp-stream-sink · rawOutput', () => {
  test('⭐ 결과 단계에 값이 있으면 rawOutput 으로 실린다', () => {
    const c = collect();
    const sink = createAcpStreamSink(c.broadcast as never);
    sink.onChunk('s1', {
      tool: { id: 't1', name: 'x', phase: 'result', ok: true, result: { a: 1 } },
    } as never, { sessionId: 's1' } as never);
    const upd = c.sent.at(-1)!.update;
    expect(upd.sessionUpdate).toBe('tool_call_update');
    expect(upd.rawOutput).toEqual({ a: 1 });
  });

  test('⛔ 값이 «없으면» rawOutput 칸이 붙지 않는다 — 사유를 지어내지 않는다', () => {
    const c = collect();
    const sink = createAcpStreamSink(c.broadcast as never);
    sink.onChunk('s1', {
      tool: { id: 't1', name: 'x', phase: 'result', ok: true },
    } as never, { sessionId: 's1' } as never);
    const upd = c.sent.at(-1)!.update;
    expect('rawOutput' in upd).toBe(false);
    // ⛔ 「왜 없는지」를 말하는 칸도 없어야 한다 — 이 층은 그것을 모른다.
    expect(Object.keys(upd).some((k) => /reason|omit|missing/i.test(k))).toBe(false);
  });

  test('⛔ 부르는 단계(call)에는 실리지 않는다 — 그때는 결과가 없다', () => {
    const c = collect();
    const sink = createAcpStreamSink(c.broadcast as never);
    sink.onChunk('s1', {
      tool: { id: 't1', name: 'x', phase: 'call', result: { a: 1 } },
    } as never, { sessionId: 's1' } as never);
    const upd = c.sent.at(-1)!.update;
    expect(upd.sessionUpdate).toBe('tool_call');
    expect('rawOutput' in upd).toBe(false);
  });

  test('⭐ 실패한 결과도 rawOutput 을 나른다 — 상태와 내용은 다른 축이다', () => {
    const c = collect();
    const sink = createAcpStreamSink(c.broadcast as never);
    sink.onChunk('s1', {
      tool: { id: 't1', name: 'x', phase: 'result', ok: false, result: { error: 'boom' } },
    } as never, { sessionId: 's1' } as never);
    const upd = c.sent.at(-1)!.update;
    expect(upd.status).toBe('failed');
    expect(upd.rawOutput).toEqual({ error: 'boom' });
  });

  test('⭐ null 은 «값»이다 — undefined 와 다르게 실린다', () => {
    const c = collect();
    const sink = createAcpStreamSink(c.broadcast as never);
    sink.onChunk('s1', {
      tool: { id: 't1', name: 'x', phase: 'result', ok: true, result: null },
    } as never, { sessionId: 's1' } as never);
    expect(c.sent.at(-1)!.update.rawOutput).toBe(null);
  });
});
