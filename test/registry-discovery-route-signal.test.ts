// 라우트 배선 회귀 — `/v1/registry/discovery` POST 가 «실제 요청의» abort 신호를
// 핸들러에 넘기는가.
//
// ⛔ 왜 따로 두나 — 취소 로직 단위시험은 `handleDiscoveryRun` 에 signal 을 «직접
//    주입»해서 돈다. 그건 「로직이 도나」만 답하고 ***「그 로직이 실행 경로에 있나」는
//    구조적으로 못 답한다.*** 실제로 이 판의 리뷰 6차까지 배선이 «없었고» 단위시험은
//    전부 초록이었다. 그래서 이 시험은 실물 서버를 띄우고 진짜 fetch 를 쏜다.
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import * as discovery from '../src/nexus/api/registry-discovery.js';

const BEARER = 'route-signal-test-token';

function serverFixture() {
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return {
    state,
    eventBus,
    registry: new TabRegistry(state),
    metaApi: { bearerToken: BEARER, noAuth: false },
    connectInfo: { nexusVersion: 'test', acpTokenOverride: 'unused-acp-token' },
    // ⚠️ `startPort: 0` 은 «안 된다» — 이 값은 `startNexusHttpServer` 안에서
    //    `startPort + i` 로 «앞으로 스캔»되므로 0·1·2… 라는 특권/무효 포트가 된다
    //    (실측: 그렇게 두면 "Was there a typo in the url or port?" 로 죽는다).
    //    ⭐ 그리고 그 스캔이 «이미» 충돌 재시도다(http-server.ts:588) — 이 포트가
    //    물려 있으면 다음 포트로 올라간다. 그래서 시작점만 흩어 주면 충분하고,
    //    저장소의 다른 라우트 시험(test/nexus-write-route-gate.test.ts)도 같은 모양이다.
    startPort: 59000 + Math.floor(Math.random() * 800),
  };
}

afterEach(() => { mock.restore(); });

describe('/v1/registry/discovery POST wires the REQUEST abort signal', () => {
  test('the handler receives a real AbortSignal from the route', async () => {
    let seen: AbortSignal | undefined;
    spyOn(discovery, 'handleDiscoveryRun').mockImplementation(async (opts) => {
      seen = opts?.discovery?.signal;
      return Response.json({ ok: true }, { status: 200 });
    });
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}/v1/registry/discovery`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BEARER}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
      // ⭐ 핵심 — 배선이 없으면 undefined 다(리뷰 6차까지 실제로 그랬다).
      expect(seen).toBeInstanceOf(AbortSignal);
      expect(seen?.aborted).toBe(false);
    } finally {
      server.stop();
    }
  });

  test('disconnecting the client ABORTS the signal the handler is holding', async () => {
    let seen: AbortSignal | undefined;
    spyOn(discovery, 'handleDiscoveryRun').mockImplementation(async (opts) => {
      seen = opts?.discovery?.signal;
      // 클라이언트가 끊을 시간을 준다.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return Response.json({ ok: true }, { status: 200 });
    });
    const server = startNexusHttpServer(serverFixture());
    const ac = new AbortController();
    try {
      const inflight = fetch(`${server.url}/v1/registry/discovery`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BEARER}`, 'content-type': 'application/json' },
        body: '{}',
        signal: ac.signal,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(seen).toBeInstanceOf(AbortSignal);
      ac.abort();
      await inflight;
      // 끊긴 것이 «핸들러가 쥔 신호»까지 닿아야 한다.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(seen?.aborted).toBe(true);
    } finally {
      server.stop();
    }
  });
});
