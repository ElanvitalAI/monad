// ⏱️ **연결이 «어느 단계에서» 멎어도 끝난다 — 그리고 그 단계를 «이름»으로 말한다**
//
// 🚨 계기(2026-08-31 실측 · 135차 A2): `elanous attach --host` 가 산출도 종료 코드도 없이
//    ***영원히 매달렸다***. 내가 100초 상한을 걸 때까지 끝나지 않았고, 그래서 「어디가 막혔나」를
//    사람이 40분 동안 손으로 갈랐다.
//    ⛔ 기전: 클라이언트가 `{kind:'auth'}` 를 보내고 응답을 «무한정» 기다렸다(상한 없음).
//    ⇒ 이 시험은 ⑴ 반드시 끝나는가 ⑵ 「소켓이 안 열림」과 「열렸는데 답이 없음」을 «가르는가» 를 문다.
import { describe, expect, test } from 'bun:test';
import { connectWebSocketClient, DEFAULT_WS_CONNECT_TIMEOUT_MS } from '../src/tui-client/acp-transport-ws-client.js';

describe('connectWebSocketClient — 연결 상한', () => {
  test('✅ 기본 상한이 «10초»다 (임의 양수로 회귀해도 잡는다)', () => {
    expect(DEFAULT_WS_CONNECT_TIMEOUT_MS).toBe(10_000);
  });

  // ⛔ 0·음수·NaN 을 «상한 없음»으로 읽으면 이 판이 고친 무한 대기가 그대로 돌아온다.
  test('🎯 0·음수·NaN 을 줘도 «상한이 선다» — 무한 대기로 새는 길이 없다', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return undefined as unknown as Response;
        return new Response('no');
      },
      websocket: { message() { /* 답하지 않는다 */ } },
    });
    try {
      for (const bad of [0, -1, Number.NaN]) {
        const started = Date.now();
        await expect(connectWebSocketClient({
          url: `ws://127.0.0.1:${server.port}/v1/acp`, token: 'x',
          connectTimeoutMs: bad as number,
        })).rejects.toThrow(/never answered the auth handshake/);
        // 기본 10초가 적용되므로 끝나되, 무한은 «아니다»
        expect(Date.now() - started).toBeLessThan(20_000);
      }
    } finally { server.stop(true); }
  }, 90_000);

  // ⛔ 라우팅 불가 주소(TEST-NET-1)는 «비결정적»이다 — 방화벽에 따라 즉시 거절이 되기도, 블랙홀이
  //    되기도 한다. ⇒ 업그레이드를 «즉시 거절»하는 로컬 서버로 결정적으로 잰다(리뷰 지적).
  test('🎯 소켓이 «안 열린다» — 조기 실패도 그 단계 이름으로 끝난다', async () => {
    const server = Bun.serve({
      port: 0,
      // ⛔ 업그레이드를 «안» 해 준다 ⇒ open 이 오기 «전»에 error/close 가 난다.
      fetch() { return new Response('nope', { status: 400 }); },
      websocket: { message() { /* 도달하지 않는다 */ } },
    });
    try {
      const started = Date.now();
      await expect(connectWebSocketClient({
        url: `ws://127.0.0.1:${server.port}/v1/acp`, token: 'x', connectTimeoutMs: 5_000,
      })).rejects.toThrow(/socket never opened/);
      // ⭐ 조기 실패는 «상한을 기다리지 않고» 즉시 끝나야 한다
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally { server.stop(true); }
  }, 20_000);

  test('🎯 소켓은 열리는데 «답이 없는» 서버 — 다른 문면으로 끝난다', async () => {
    // 업그레이드는 받아 주고 아무 말도 안 하는 서버를 «내 쪽에» 세운다.
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return undefined as unknown as Response;
        return new Response('no');
      },
      websocket: { message() { /* ⛔ 의도적으로 «답하지 않는다» */ } },
    });
    try {
      const started = Date.now();
      await expect(connectWebSocketClient({
        url: `ws://127.0.0.1:${server.port}/v1/acp`, token: 'x', connectTimeoutMs: 700,
      })).rejects.toThrow(/never answered the auth handshake/);
      // ⭐ 「끝나긴 한다」가 아니라 ***내가 «건 700ms 를 지키는가»*** — CI 여유만 둔다.
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally { server.stop(true); }
  }, 20_000);

  test('⭐ 알려진 «음성» — 답하는 서버는 상한에 «안» 걸린다(과탐 방지)', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return undefined as unknown as Response;
        return new Response('no');
      },
      websocket: { message(ws) { ws.send(JSON.stringify({ ok: true })); } },
    });
    try {
      const conn = await connectWebSocketClient({
        url: `ws://127.0.0.1:${server.port}/v1/acp`, token: 'x', connectTimeoutMs: 3000,
      });
      expect(conn.peerId).toContain('ws://127.0.0.1');
      await conn.close();
    } finally { server.stop(true); }
  }, 20_000);
});
