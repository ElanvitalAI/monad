// ── 선할당 PTY id 는 `kind` 와 짝이어야 한다 (2026-07-28 회귀) ──
//
// 실물 결함: driver 가 `mintPtyId('self')` 로 `self_…` 를 만들면서 `startPty` 에 `kind` 를
// 넘기지 않아, 검증기가 `expectedKind='pty'` 로 떨어져 **거부**했다:
//
//   headless.pty-fallback {"error":"invalid preallocated PTY id \"self_30413ae7\"
//                                   — expected pty_<8 lowercase hex>"}
//
// 폴백이 fail-soft 라 로그 한 줄만 남기고 spawnSync 로 계속 갔고, 그 결과
// ①headless.progress 라이브 관측 ②registry 등록(PWA 노출) ③부모 비블로킹
// ④자식의 ELANOUS_PTY_ID(=lifecycle 발행) 가 **전부 조용히 사라졌다.**
//
// 이 테스트는 "driver 가 넘기는 id 와 kind 가 실제 검증기를 통과하는가" 를 고정한다.
// ⚠️ 검증 로직을 복제하지 않고 **registry 의 실제 판정 경로**를 쓴다 — 복제하면 검증기가
// 바뀔 때 테스트만 통과하는 거짓 안전이 된다.

import { describe, expect, test } from 'bun:test';
import { mintPtyId, startPty, type StartOpts } from '../pty-shell/registry.js';
import { runHeadlessGoalLoopPty } from './headless-elanous-driver.js';

/** driver 가 실제로 넘긴 StartOpts 를 잡아채는 스텁 — PTY 는 뜨지 않는다. */
function captureSpawnOpts(): { seen: StartOpts[]; spawn: (o: StartOpts) => never } {
  const seen: StartOpts[] = [];
  return {
    seen,
    spawn: (o: StartOpts): never => {
      seen.push(o);
      throw new Error('stub — spawn 은 여기서 멈춘다(실 PTY 무접촉)');
    },
  };
}

describe('headless goal-loop PTY — 선할당 id 는 kind 와 짝이어야 한다', () => {
  test('driver 가 id 와 kind 를 함께 넘긴다', async () => {
    const cap = captureSpawnOpts();
    await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/wt', featurePrompt: 'x', maxWaitSec: 1,
      spawn: cap.spawn, ptyAvailable: () => true,
    } as never).catch(() => undefined);

    expect(cap.seen.length).toBeGreaterThan(0);
    const o = cap.seen[0]!;
    expect(o.id).toBeDefined();
    // ⭐ 핵심 — id 의 접두사와 kind 가 같아야 검증기를 통과한다.
    expect(o.kind).toBe('self');
    expect(o.id!.startsWith(`${o.kind}_`)).toBe(true);
  });

  test('kind 를 빠뜨리면 registry 가 실제로 거부한다 (거짓 안전 방지)', () => {
    const id = mintPtyId('self');
    // kind 생략 = 결함 재현. startPty 는 검증에서 throw 해야 한다.
    expect(() => startPty({ id, cmd: 'true', args: [] } as StartOpts))
      .toThrow(/invalid preallocated PTY id/);
  });

  test('kind 를 함께 주면 그 검증을 통과한다', () => {
    const id = mintPtyId('self');
    // 검증만 통과하면 되고 실제 spawn 은 관심 밖 — 검증 단계의 에러만 없으면 된다.
    let err: unknown;
    try { startPty({ id, kind: 'self', cmd: 'true', args: [] } as StartOpts); } catch (e) { err = e; }
    expect(String(err ?? '')).not.toMatch(/invalid preallocated PTY id/);
  });
});
