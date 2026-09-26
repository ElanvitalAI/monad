// ── 소유권 상실 판정 seam (P2b P-a′ · [[RFC-pty-control-loan-pause-resume-notify-2026-07-27]] §4e·§4f) ──
//
// 종전에는 세 자리가 **각자** `canWrite('agent')` 를 불러 소유권을 판정했다(RFC §1a):
//   A `agent-mission/driver.ts`  B `autopilot/pty-control-loop.ts`  C `self-implement/headless-elanous-driver.ts`
// 루프(B) 한 곳을 고쳐도 A·C 는 옛 판정에 남으므로, 뒤에 올 verdict 수렴(P-b)·`defer` 집행(P-c)이
// 전부 여기 얹히도록 판정을 한 곳으로 모은다.
//
// ⚠️ **순수 함수 하나로는 안 된다** — 소유권 조회는 I/O 이고 예외까지 봐야 한다. 그래서 둘로 가른다:
// 순수 매핑(`classifyControlStance`) ⊕ I/O 어댑터(`probeControlStance`).

import type { PtyWriteActor } from './pty-write-arbiter.js';

/**
 * ⭐3-값 소유권 상태. 종전 boolean 은 **두 사실을 뭉치고 있었다** — `false` = {상실} ∪ {확인 불가}.
 *
 * `abandon`(중단)에는 그 뭉침이 옳다(둘 다 멈춰야 하므로). 그러나 뒤에 `defer`(대기 후 재개)가 붙으면
 * 위험하다: 조회 실패로 대기에 들어가면 **뺏은 사람이 없으니 돌려줄 사람도 없어 영구 대기**이고,
 * 통보축이 붙으면 *"사람이 뺏었다"* 는 **거짓 사실**까지 발행한다.
 * ⇒ 그래서 `lost`(확인된 상실)와 `unknown`(확인 불가)을 **여기서 가른다**. 소비 정책은 호출부 몫.
 */
export type ControlStance = 'owned' | 'lost' | 'unknown';

/** 조회 결과 — 성공이면 소유 여부, 실패면 실패 사실만. 어댑터가 만들고 순수 매핑이 읽는다.
 *  ⚠️ 내부 타입 — 파일 밖 소비자 없음(dead export 금지 · 이 트랙 선례 3건). 생기면 그때 export 한다.
 *  ⚠️ **실패 variant 에 `error` 를 담지 않는다**(리뷰 must-fix) — 아무도 읽지 않는 dead field 였다.
 *  원인은 `onProbeError` 가 **원본 그대로** 받으므로 여기 복제할 이유가 없다. */
type ControlProbe =
  | { readonly ok: true; readonly owned: boolean }
  | { readonly ok: false };

/**
 * ⭐순수 매핑 — 조회 결과를 3-값으로. I/O 없음(테스트가 세 값 전부 덮는다).
 *
 * ⚠️ **fail-closed 는 여기서 깨지지 않는다**: 조회 실패는 `owned` 가 **아니다**. 다만 `lost` 와도
 * 구분해 두어, *"확인 불가인데 사람이 돌려주기를 기다리는"* 상태로 넘어가지 못하게 한다.
 */
export function classifyControlStance(probe: ControlProbe): ControlStance {
  if (!probe.ok) return 'unknown';
  return probe.owned ? 'owned' : 'lost';
}

/** `owned` 가 아닌 모든 상태 = 지금 써서는 안 된다. 종전 `!canWrite(actor)` 와 **1:1 동치**(무회귀 경계). */
export function stanceBlocksWrite(stance: ControlStance): boolean {
  return stance !== 'owned';
}

/** 어댑터가 소유권을 물어보는 최소 표면 — registry `PtyHandle` 이 만족한다(테스트는 스텁).
 *  ⚠️ 내부 타입(위와 같은 이유). */
interface ControlStanceProbeTarget {
  canWrite(actor: PtyWriteActor): boolean;
}

/**
 * ⭐관측 훅 호출 격리 — **관측이 판정을 바꾸지 않게** 한다. 훅이 던지면 그 예외가 밖으로 나가
 * fail-closed 판정 자체가 깨진다(호출부는 `unknown` 을 받아 멈춰야 하는데 예외 종료로 간다).
 *
 * ⚠️ **정의가 하나여야 한다**(리뷰 must-fix) — 루프의 주입 stance 경로가 같은 격리를 **손으로 다시
 * 짜고 있었고**, 그 복제본은 테스트가 못 닿아 뮤테이션에도 안 걸렸다. 두 경로가 이 함수를 공유한다.
 */
export function reportProbeError(onProbeError: ((error: unknown) => void) | undefined, error: unknown): void {
  try { onProbeError?.(error); } catch { /* 관측 실패는 판정에 영향 없음 */ }
}

/**
 * ⭐I/O 어댑터 — handle 을 찔러 보고 순수 매핑에 넘긴다. 종전 `safeHasControl` 의 try/catch 가 여기 산다
 * (예외를 삼켜 async uncaught 를 막던 그 규율 그대로 · 다만 결과가 `false` 가 아니라 `'unknown'` 이다).
 *
 * `onProbeError` 는 관측 훅이다 — 호출부가 자기 카테고리로 남긴다(이 모듈은 로거를 모른다).
 */
export function probeControlStance(
  target: ControlStanceProbeTarget,
  actor: PtyWriteActor = 'agent',
  onProbeError?: (error: unknown) => void,
): ControlStance {
  let probe: ControlProbe;
  try {
    probe = { ok: true, owned: target.canWrite(actor) };
  } catch (error) {
    // ⚠️ **관측이 판정을 바꾸면 안 된다** — 훅이 던지면 그 예외가 밖으로 나가 fail-closed 판정
    //   자체가 깨진다(호출부는 `unknown` 을 받아 멈춰야 하는데 예외 종료로 간다).
    reportProbeError(onProbeError, error);
    probe = { ok: false };
  }
  return classifyControlStance(probe);
}
