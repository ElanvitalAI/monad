// 🚪 **CLI «배선» 회귀 시험** — ⛔ 전송층만 재면 `src/index.ts` 의 배선이 깨져도 초록이다.
//
// 🚨 계기(2026-08-31 · 135차 A2): `elanous attach --host` 가 산출도 종료 코드도 없이 «영원히» 매달렸다.
//    전송층에 상한을 넣어도, CLI 가 그 오류를 «사람 문면»으로 옮기지 않으면 사용자는 스택 트레이스를 본다.
//    ⇒ 그래서 진짜 CLI 를 spawn 해서 ⑴종료 코드 ⑵문면 ⑶스택 트레이스 부재 를 «본다».
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

describe('elanous attach --host — 서버가 답하지 않을 때 «사람 문면»으로 끝난다', () => {
  const repoRoot = join(import.meta.dir, '..');
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    // 업그레이드는 받아 주고 인증 핸드셰이크에 «답하지 않는» 서버 — 실제로 관측된 그 상태.
    server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return undefined as unknown as Response;
        return new Response('no');
      },
      websocket: { message() { /* ⛔ 의도적으로 답하지 않는다 */ } },
    });
  });
  afterAll(() => { server.stop(true); });

  // ⛔ spawnSync 를 쓰면 «부모 이벤트 루프»가 막혀 위 시험 서버가 연결을 못 받는다 —
  //    그러면 「답 안 함」이 아니라 「소켓 안 열림」을 재게 되어 «다른 축»을 검증한다(실측으로 잡았다).
  test('🎯 종료 코드가 0 이 아니고, «어느 단계»인지 말하고, 스택 트레이스가 «아니다»', async () => {
    const proc = Bun.spawn(['bun', 'bin/elanous.mjs', 'attach',
      '--host', `127.0.0.1:${server.port}`, '--token', 'dummy', '--message', 'ping'],
      { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' });
    const [so, se] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const status = await proc.exited;
    const out = `${so}${se}`;
    expect(status).not.toBe(0);
    expect(out).toContain('attach failed');
    // ⑵ 단계를 이름으로 — 「안 됐다」 한 값으로 접지 않는다
    expect(out).toContain('never answered the auth handshake');
    // ⑶ 조치를 말한다
    expect(out).toContain('Remote target:');
    expect(out).toContain('elanous logs --category acp');
    // ⛔ 날 스택 트레이스로 흘리지 않는다
    expect(out).not.toContain('at connectWebSocketClient');
    expect(out).not.toMatch(/^\s+\d+ \|/m);
  }, 40_000);
});
