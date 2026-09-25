// ── investment 도메인팩 — D3 (코나투스 편입·dry) ───────────────────────────
//
// 투자 판단 도메인. 코딩 페이즈와 근본적으로 다르다: "구현"이 아니라
// **관측 → 리서치 → 판단 → 집행 → 검증**. 관측·리서치를 건너뛰고 매매로 직행하지
// 않도록 phaseShapeHint 로 강제(§3.6 자율 리서치의 뿌리).
//
// ★ D3 는 dry — 분해(플랜)만. 실제 매매 집행은 기존 mandate 게이트(armed/live·
//   ~/.monad/finance-trade-mandate.json)로만 일어난다. executor/verifier/safetyGate 는
//   umbrella §9 "승인→멀티페이즈 executor" 배선과 합류(현재 미배선·집행 disarmed).
//   finance=conatus/ 네임스페이스 유지(core-not-customer).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §4.2.

import type { DomainPack } from './types.js';

/** 투자 미션은 거의 항상 시장 상태·수급·여론 조사가 이득(관측 필수) → 기본 needed. */
async function assessNeed(_goal: string): Promise<{ needed: boolean; reason: string }> {
  return { needed: true, reason: '투자 판단은 시장 국면·시세·수급·여론 조사에 의존(관측 필수)' };
}

/** 투자 리서치 = 시장 데이터 중심(시세·수급·거시) + 커뮤니티/X 여론·타국 반응. D3 스켈레톤은
 *  research-bridge 를 투자 프레이밍으로 호출(omni-market/kr-flow 직접 배선은 D6+ 적응형 렌즈·§3.6). */
async function invoke(goal: string): Promise<{ ok: boolean; output: string }> {
  const { invokeResearch } = await import('../../research-bridge/index.js');
  const r = await invokeResearch(
    `${goal}\n\n(투자 판단을 위한 조사: 현재 시장 국면·해당 종목/섹터 시세와 수급·거시(금리/환율/지수)·`
    + `커뮤니티(X/레딧/펨코) 여론·타국 반응·리스크 이벤트. 심각도에 따라 조사 깊이를 조절. 인용 포함)`,
    {},
  );
  return { ok: r.ok, output: r.output };
}

export const INVESTMENT_PACK: DomainPack = {
  domain: 'investment',
  label: '투자',
  decompose: {
    // 코딩 아님 — 운영/판단성(generator 의 코딩 nudge 회피).
    goalKind: 'ops',
    objectivePreamble: (goal: string) => `다음 투자 목표를 실행 가능한 단계로 분해한다: "${goal}"`,
    phaseShapeHint:
      '투자 미션은 반드시 [관측(현재 포지션·시장 국면 체크) → 리서치(시세·수급·거시·여론) → '
      + '판단(전략·리스크·시나리오) → 집행(mandate 범위 내 주문) → 검증(체결 확인)] 순서의 페이즈로 '
      + '나눈다. 관측·리서치를 건너뛰고 매매로 직행하지 말 것. mandate(armed/live) 범위를 벗어나는 '
      + '집행은 사람 승인(HITL) 페이즈를 둔다. 이벤트 심각도가 높으면 리서치 렌즈를 깊게(연관 섹터·'
      + '타국 반응·과거 패턴·2차 추론) 가져간다.',
  },
  research: { assessNeed, invoke },
  // ★ 승인=실행 게이트(대표 2026-07-13) — 종전엔 투자 도메인을 통째로 dry(스테이징조차 안 함)로
  //   막아, 실전 매매가 없는 "신호/구현/조사" 미션까지 사람 승인 후에도 실행 0이었다(대표 지적:
  //   신호 로직 짜는 미션인데 승인해도 막히는 로직이 이상). 이제 coding 과 동일하게 dependsOn
  //   존중 스테이징(root ready·나머지 blocked). ★안전 불변: 실제 매매 집행은 하위 trade-mandate
  //   (armed/live·~/.monad/finance-trade-mandate.json)가 여전히 게이트 — armed=false 면 executor
  //   생성 안 됨/refuse/paper. 미션 실행해도 실매매 오집행 불가(도메인 통째 차단은 과잉 이중이었음).
  executor: async (missionId, ctx) => {
    const { promotePhasesRespectingDeps } = await import('./phase-exec.js');
    const activated = promotePhasesRespectingDeps(ctx.store, missionId, ctx.now);
    return { ok: true, activated, note: `${activated} root 페이즈 ready — 매매 집행은 mandate(armed/live) 게이트로만` };
  },
};
