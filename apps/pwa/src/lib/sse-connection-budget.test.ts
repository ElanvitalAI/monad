/** ⛔⭐⭐⭐⭐ **「끝나지 않는 연결」을 몇 개 여는가** — 19차 `[F]`.
 *
 *  📏 2026-08-22 라이브(CDP Network): 채팅 탭 «한 장»이 끝나지 않는 연결 7개를 열었고,
 *  ***브라우저의 HTTP/1.1 호스트당 한도는 6*** 이라 나머지 요청이 영영 큐에 섰다.
 *  그 줄에 `POST /v1/debug-logs/batch`(관측)와 `/v1/mcp/resources`(위젯 데이터)가 있었다.
 *  🔑 ***그리고 조용했다*** — 채팅은 WebSocket 이라 계속 돌았다.
 *
 *  ⇒ 이 자는 ***「합쳤나」를 행위로*** 문다: `fetch` 호출을 세서
 *    ⓐ 롱리브 연결이 «하나»인가 ⓑ 그 하나가 두 토픽을 «다» 요구하는가
 *    ⓒ 프레임이 두 소비자에게 «다» 가는가(tee 가 실제로 갈라지나).
 *
 *  ## ⚠️ 이 자가 답하지 «않는» 것
 *  진짜 브라우저의 6-연결 한도 — 그건 라이브 축이다(CDP 로 「안 끝난 요청」을 센다). */

import { describe, expect, it } from 'bun:test';
import { DaemonClient } from './daemon-client';

const realFetch = globalThis.fetch;

/** SSE 프레임을 흘려 주는 가짜 응답. `close()` 로 스트림을 닫는다. */
function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function frame(kind: string, detail: Record<string, unknown>): string {
  return `event: ${kind}\ndata: ${JSON.stringify({ kind, ts: 1, detail })}\n\n`;
}

describe('채팅 피드백 SSE — 연결 «하나»로 두 토픽', () => {
  it('⛔ fetch 를 «한 번»만 하고, 그 URL 이 두 토픽을 다 요구한다', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return sseResponse([]);
    }) as unknown as typeof fetch;
    try {
      const client = new DaemonClient({ baseUrl: 'http://localhost:31415', token: 't', provider: 'x' });
      const off = client.subscribeChatFeedbackEvents('sess-1', {
        agentStatus: { onFeedback: () => {} },
        hudSegment: { onFeedback: () => {} },
      });
      await new Promise((r) => setTimeout(r, 30));
      off();
    } finally {
      globalThis.fetch = realFetch;
    }
    // 🔑 여기가 이 자의 전부다 — 둘로 열면 슬롯을 둘 먹는다.
    expect(urls).toHaveLength(1);
    // ⚠️ 콤마는 인코딩되지 않는다(쿼리에서 합법) — 실측한 «그대로» 문다.
    expect(urls[0]).toContain('topics=agent.status,hud.segment');
  });

  it('⭐ 한 연결의 프레임이 «두 소비자»에게 다 간다 — tee 가 실제로 갈라진다', async () => {
    globalThis.fetch = (async () => sseResponse([
      frame('agent.status', { agentId: 'a1', status: 'working', updatedAt: 2 }),
      frame('hud.segment', { key: 'k1', value: 'v1', phase: 'update' }),
    ])) as unknown as typeof fetch;
    const statusKinds: string[] = [];
    const hudKinds: string[] = [];
    try {
      const client = new DaemonClient({ baseUrl: 'http://localhost:31415', token: 't', provider: 'x' });
      const off = client.subscribeChatFeedbackEvents('sess-2', {
        agentStatus: { onFeedback: (env) => statusKinds.push(env.kind) },
        hudSegment: { onFeedback: (env) => hudKinds.push(env.kind) },
      });
      await new Promise((r) => setTimeout(r, 60));
      off();
    } finally {
      globalThis.fetch = realFetch;
    }
    // ⛔ 한쪽만 오면 tee 가 아니라 «한 소비자가 스트림을 다 먹은» 것이다.
    expect(statusKinds).toEqual(['agent.status']);
    expect(hudKinds).toEqual(['hud.segment']);
  });

  it('⛔ 실패하면 «두 소비자 다» 알게 한다 — 한쪽만 알리면 다른 쪽은 영영 기다린다', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const errs: string[] = [];
    try {
      const client = new DaemonClient({ baseUrl: 'http://localhost:31415', token: 't', provider: 'x' });
      const off = client.subscribeChatFeedbackEvents('sess-3', {
        agentStatus: { onFeedback: () => {}, onError: (i) => errs.push(i.error) },
        hudSegment: { onFeedback: () => {}, onError: (i) => errs.push(i.error) },
      });
      await new Promise((r) => setTimeout(r, 40));
      off();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(errs.sort()).toEqual(['agent_status_failed', 'hud_segment_failed']);
  });
});
