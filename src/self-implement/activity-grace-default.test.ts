import { describe, expect, test } from 'bun:test';
import { DEFAULT_ACTIVITY_GRACE_SEC, LONGEST_SILENT_GATE_MS } from './headless-monad-driver.js';

// ⛔⛔ **왜 이 테스트가 있나**(실측 2026-07-30): 오늘 위임 4건이 `soft-timeout` 으로 죽었는데
//    실패가 아니라 **무출력 허용 구간 부족**이었다. `poll.heartbeat.silentFor` 최대값이
//    죽은 런(134·112·107·100)과 산 런(81·80·80·79·78·70)을 **종전 기본값 90 에서 완벽히 갈랐다.**
//    ⇒ 우리가 자식에게 요구하는 `self typecheck` 가 **147초 무출력**이므로 구조적으로 넘는다.
//    이 테스트는 그 대소 관계를 고정한다 — 상수를 되돌리면 여기서 잡힌다.
describe('무출력 허용 구간 기본값', () => {
  test('가장 긴 무출력 게이트보다 커야 한다 — 아니면 완주한 런이 버려진다', () => {
    const graceMs = DEFAULT_ACTIVITY_GRACE_SEC * 1000;
    expect(graceMs).toBeGreaterThan(LONGEST_SILENT_GATE_MS);
  });

  // ⭐ 여유가 1.0배 겨우 넘는 것으로는 부족하다 — 머신 부하·파일 수에 따라 흔들린다.
  //   ⚠️ 상한도 둔다: 무한정 키우면 진짜 교착을 늦게 잡는다(연장 자격은 넓히되 무한이 아니다).
  test('여유는 1.3배 이상이고 3배 미만이다 (교착 감지를 잃지 않는다)', () => {
    const ratio = (DEFAULT_ACTIVITY_GRACE_SEC * 1000) / LONGEST_SILENT_GATE_MS;
    expect(ratio).toBeGreaterThanOrEqual(1.3);
    expect(ratio).toBeLessThan(3);
  });
});
