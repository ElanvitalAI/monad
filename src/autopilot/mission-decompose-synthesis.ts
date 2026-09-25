// ── 골분해 종합 스마트 제안 (RFC-general-coordinator-custom-contracts-2026-07-20 §3c · CC1) ──
//
// 골분해 파이프라인이 내는 파편 신호(골 역제안·분해 비평·granularity·성숙도·아크 preflight·게이팅)를
// fan-in 해 **단일 스마트 제안**(recommendation + 근거)으로 종합한다. 종전 se-mission-prepare 의
// advisoryCount(경고 신호 "개수만" 셈)를 대체한다.
//
// 설계 원칙(RFC):
//   · 신호원은 이미 존재(각 게이트가 산출) — 이 모듈은 "종합 계층"만 신규.
//   · 순수 함수(신호 주입) — mission-briefing.ts 패턴. 테스트/실 소스 분리, 부수효과 없음.
//   · CC1 = 결정론 규칙(LLM 없음·저위험·라이브 즉효). LLM sol 종합·문구 다듬기는 후속(CC1b+).
//   · "검토하세요(파편 나열)" → "이렇게 하시죠(종합된 단일 판단)".

/** 종합 판단 — 에스컬레이션 사다리(승인 < 검토 < 좁혀재분해 < 근본재설계). */
export type DecomposeRecommendation = 'approve' | 'review' | 'narrow-redecompose' | 'redesign';

/** ★ 조율자 UX 액션(대표 2026-07-20) — 4단계 판정 위에 얹는 "사용자 default 액션"(항상 추천·2방향).
 *  방향을 3개로 좁히고, 카드는 [추천 액션 1개] + [정정] 2버튼만. proceed 가 대부분(구현서 수습 우선). */
export type RecommendedAction = 'proceed' | 'redecompose' | 'redesign';

/** 골분해 파편 신호 fan-in 입력. 모두 optional — 없으면 무신호(정상)로 취급. */
export interface DecomposeSignals {
  /** 골 리디자인 역제안 있음(A6-a·골 형태 재구성 제안). */
  redesign?: boolean;
  /** 분해 비평 치명 개수(D1). hasCritical 만 알면 1/0 으로 근사 전달. */
  criticalCritique?: number;
  /** granularity 결정론 게이트가 과대 페이즈 검출(D2). */
  granularityOversized?: boolean;
  /** ★ 완주가능 게이트(gradePhaseCompletability) 과대 페이즈 **개수**(대표 2026-07-23·플랜 sizing 실집행).
   *  단일/소수 과대 = review(구현 위임·플랜 가볍게 유지). 다수(≥2) 과대 = **체계적 under-decomposition**
   *  (e4f97b 7페이즈 붕괴형) → narrow-redecompose 로 플랜에서 재분해(구현 무한 split 로 떠넘기지 않게).
   *  granularityOversized 는 존재여부(review 소프트 신호)로, count 는 체계성(재분해 승격)으로 이원. */
  granularityOversizedCount?: number;
  /** 성숙도 분리 권장 — 과대 미션(A6-b·아크≥3 등). */
  maturityOversized?: boolean;
  /** 아크 preflight = mirage(허상 의심) 개수. */
  mirageArcs?: number;
  /** ★ mirage 진단이 build:context 로 carry 되어 구현 SE 가 "아크 전제 교정" 메모로 받는가(대표 2026-07-21).
   *  carry 배선(#4875)이 상시라 기본 true — 단순 전제 오인은 플랜단 재분해로 완벽제거하지 말고 구현이 소화.
   *  명시 false(carry 불가·예외)만 종전대로 구조 결함 취급. mirageArcs=0 이면 무관. */
  mirageCarried?: boolean;
  /** 아크 preflight = over_scope(과대·이미 존재) 개수. */
  overScopeArcs?: number;
  /** 분해 게이팅(terra) verdict — 있으면 최우선 신호(CC1b 에서 카드 前으로 끌어올려 주입). */
  gateVerdict?: 'pass' | 'revise' | 'reject';
  arcCount?: number;
  phaseCount?: number;
}

export interface DecomposeSynthesis {
  /** 종합 판단(에스컬레이션 사다리·하위호환). */
  recommendation: DecomposeRecommendation;
  /** ★ 사용자 default 액션(항상 추천·2방향 UX). 카드 주 버튼 1개를 이걸로. */
  recommendedAction: RecommendedAction;
  /** ★ 지적을 구현 페이즈에서 수습(true 면 재분해 대신 proceed 근거·"구현서 처리" 안내). */
  deferToBuild: boolean;
  /** 카드 1줄 스마트 제안(라벨 + 핵심 근거 1-2개). */
  headline: string;
  /** ★ 정련된 액션 안내(항상 추천 + 2방향 + defer 시 "구현서 수습"). 카드 메시지. */
  actionHint: string;
  /** 근거(경고 신호별·심각도 순). */
  reasons: string[];
  /** 하위호환 — 종전 advisoryCount 대체값(경고 신호 수). */
  advisoryCount: number;
}

const REC_LABEL: Record<DecomposeRecommendation, string> = {
  approve: '✅ 승인 권장',
  review: '🔍 검토 후 승인 권장',
  'narrow-redecompose': '⚠️ 좁혀서 재분해 권장',
  redesign: '⛔ 근본 재설계 권장',
};

/**
 * 골분해 파편 신호 → 단일 스마트 제안 종합(순수·결정론).
 * 판단 사다리: reject/다중 over_scope = redesign · revise/(carry불가 mirage≥2)/성숙도+치명 = narrow-redecompose ·
 *              그 외 경고(carry 되는 mirage 포함) = review → proceed · 무경고 = approve.
 * ★ mirage 유연화(대표 2026-07-21): carry 되는 mirage 는 재분해 아닌 proceed(구현이 전제 교정 메모 소화).
 */
export function synthesizeDecomposition(sig: DecomposeSignals): DecomposeSynthesis {
  const reasons: string[] = [];
  const critical = Math.max(0, sig.criticalCritique ?? 0);
  const mirage = Math.max(0, sig.mirageArcs ?? 0);
  const overScope = Math.max(0, sig.overScopeArcs ?? 0);
  // ★ mirage carry(대표 2026-07-21) — 허상 진단이 build:context 로 carry 되면(구현 SE 가 "아크 전제 교정"
  //   메모로 받으면) 단순 전제 오인은 플랜단 재분해로 완벽제거하지 말고 구현이 소화(대표 철학: 플랜의 비대함보다
  //   구현의 유연함). carry 배선(#4875)이 상시라 기본 true → mirage 는 구조 결함에서 제외. 명시 false(carry
  //   불가·예외)일 때만 종전대로 구조 결함으로 계상(무회귀).
  const mirageCarried = sig.mirageCarried ?? true;
  const mirageStructural = mirage > 0 && !mirageCarried;

  // 근거 수집 — 심각도 높은 순.
  if (sig.gateVerdict === 'reject') reasons.push('분해 게이팅 거부(근본 재설계 필요)');
  if (sig.gateVerdict === 'revise') reasons.push('분해 게이팅 revise(정련 권장)');
  if (sig.redesign) reasons.push('골 리디자인 역제안');
  if (mirage > 0) reasons.push(`허상 의심 ${mirage}아크(mirage)`);
  if (overScope > 0) reasons.push(`과대 의심 ${overScope}아크(over_scope)`);
  if (sig.maturityOversized) reasons.push('과대 미션(성숙도 분리 권장)');
  if (sig.granularityOversized) reasons.push('과대 페이즈(granularity)');
  if (critical > 0) reasons.push(`분해 비평 치명 ${critical}건`);

  // 종합 판단 — 근본 > 재분해 > 검토 > 승인.
  // ★ 완화(대표 2026-07-21) — redesign 카드는 **하드 게이트 거부 or 다중 over_scope(≥2·진짜 별도미션급
  //   대공사)**만. 종전엔 골형태 redesign 힌트 + (maturity | 단일 over_scope) 로도 redesign 카드를 강제해
  //   "이질 관심사 묶음 골"이 매번 근본재설계 역제안으로 막혔다. 대표 철학: 경미 정련은 브리핑 상세·HITL 로
  //   막지 말고 구현단 메모로 넘겨 실행 지능이 페이즈/아크 조정·목표 스코핑으로 대응. → 단일 over_scope·
  //   maturity·골형태 redesign 은 proceed+deferToBuild(구현 메모)로 흡수. 근거는 reasons[]→메모로 전달.
  let recommendation: DecomposeRecommendation;
  if (sig.gateVerdict === 'reject' || overScope >= 2) {
    recommendation = 'redesign';
  } else if (
    sig.gateVerdict === 'revise' ||
    (mirageStructural && mirage >= 2) || overScope >= 2 ||   // ★ carry 안 되는 mirage 만 재분해 승격(carry 되면 구현 소화)
    (sig.maturityOversized && critical > 0) ||
    (mirageStructural && critical > 0) ||                    // ★ carry 안 되는 mirage + 치명 결합만
    (sig.granularityOversizedCount ?? 0) >= 2                // ★ 체계적 과대(다수 페이즈 under-decompose·2026-07-23) → 플랜 재분해
  ) {
    recommendation = 'narrow-redecompose';
  } else if (critical > 0 || mirage > 0 || overScope > 0 || sig.maturityOversized || sig.granularityOversized || sig.redesign) {
    recommendation = 'review';
  } else {
    recommendation = 'approve';
  }

  const topReasons = reasons.slice(0, 2).join(' · ');
  const headline = topReasons ? `${REC_LABEL[recommendation]} — ${topReasons}` : REC_LABEL[recommendation];

  // ★ 조율자 UX 액션(대표 2026-07-20) — 4단계 판정을 3 액션으로 좁히고 "구현서 수습" 우선. 재분해는
  //   구조적 결함(치명·over_scope≥2·carry 불가 mirage)만. gate revise·review 등 실행/구현서 해소 가능한 지적
  //   (의존성 순차·저장경계는 구현 페이즈 소관, ★carry 되는 mirage=전제 오인)은 proceed(승인·착수)로 흡수 —
  //   재분해로 못 푸는 것을 재분해로 돌리는 낭비 차단(CC1c 프로파일링 근거). 카드는 [추천 액션 1개]+[정정] 2버튼만.
  //   ★ mirage 유연화(대표 2026-07-21) — carry 되는 mirage 는 구조 결함이 아니다(구현이 소화). carry 안 되는
  //   mirage(예외)와 치명 비평·다중 over_scope 만 구조 결함으로 재분해.
  const structuralDefect = (mirageStructural && mirage >= 2) || critical > 0 || overScope >= 2;
  let recommendedAction: RecommendedAction;
  let deferToBuild = false;
  if (recommendation === 'redesign') {
    recommendedAction = 'redesign';
  } else if (recommendation === 'narrow-redecompose' && structuralDefect) {
    recommendedAction = 'redecompose';
  } else {
    recommendedAction = 'proceed'; // approve·review·(gate revise 만인 narrow-redecompose)·carry 되는 mirage
    deferToBuild = reasons.length > 0; // 지적은 있으나 구현 페이즈에서 수습
  }

  // ★ mirage 가 proceed 로 흡수될 때(carry) 카드 톤은 "재분해 경고"가 아니라 "구현이 참고할 전제 교정 메모".
  const mirageDeferred = recommendedAction === 'proceed' && mirage > 0 && mirageCarried;
  const actionHint =
    recommendedAction === 'redesign'
      ? '🔀 재설계 추천 — 골 범위가 과대합니다. [재설계 수용] 또는 [정정].'
      : recommendedAction === 'redecompose'
        ? '🔁 좁혀 재분해 추천 — 구조적 결함(치명/과대)입니다. [재분해] 또는 [정정].'
        : mirageDeferred
          ? '✅ 승인 추천 — 아크 전제 오인 지적은 구현 페이즈에 참고 메모로 전달돼 구현이 실제 코드로 교정합니다. [승인·착수] 또는 [정정].'
          : deferToBuild
            ? '✅ 승인 추천 — 지적사항은 구현 페이즈에서 수습됩니다. [승인·착수] 또는 [정정].'
            : '✅ 승인 추천 — 깨끗한 분해입니다. [승인·착수].';

  return { recommendation, recommendedAction, deferToBuild, headline, actionHint, reasons, advisoryCount: reasons.length };
}
