// ── Loop Engineering 통일 계약: builder != checker (2026-07-08 · Phase 0) ──
//
// 캐논(ClaudeDevs "Getting started with loops") 1번 교훈: 제안을 "만든"
// 로직이 자기 제안을 채점하면 안 된다(self-grading). 작동하는 모든 루프는
// 만드는 역할(builder)과 검증하는 역할(checker)이 분리돼 있다.
//
// 이 모듈은 금융 자율 루프(trade/backtest/retro/dig)가 공유하는 최소 계약을
// 정의한다 — 제안과 판정을 구조적으로 분리하는 순수 헬퍼(I/O 없음·테스트
// 결정론). backtest 는 이미 evaluateGate 로 이 원칙을 지킨다; trade/retro/dig
// 는 이 계약으로 얹는다.
//
// ★ 롤아웃 안전(2단계): mode='advisory'는 판정을 기록만 하고 흐름을 바꾸지
//   않는다(회귀 0). 검증이 무르익으면 mode='enforce'로 승격 → 미승인 제안
//   차단. (elanous 자체 패턴: loop-prompt termination advisory → hard-gate §5-②.)
//
// 근거: 내부 문서 `PLAN-loop-engineering-finance-reconnect-2026-07-08` §3·§4.

/** 독립 체크 1건의 결과. */
export interface CheckResult {
  /** 체크 이름(감사·디버그). */
  name: string;
  /** 통과 여부. */
  passed: boolean;
  /** 사람이 읽는 근거(comprehension-debt 가드). */
  detail: string;
}

/** checker 가 제안 1건에 내리는 판정(builder 와 분리된 인스턴스가 생성). */
export interface CheckerVerdict {
  /** 모든 체크 통과 시 true. */
  approved: boolean;
  /** 한 줄 요약(감사). */
  reason: string;
  /** 개별 체크 내역. */
  checks: CheckResult[];
}

/** 독립 체크들을 AND 로 합성 — 하나라도 실패하면 미승인. 빈 목록=승인(무조건). */
export function combineChecks(checks: CheckResult[]): CheckerVerdict {
  const failed = checks.filter((c) => !c.passed);
  return {
    approved: failed.length === 0,
    reason:
      failed.length === 0
        ? `승인(${checks.length}개 체크 통과)`
        : `미승인: ${failed.map((c) => c.name).join('·')}`,
    checks,
  };
}

/** advisory=기록만(회귀 안전) · enforce=미승인 차단. */
export type CheckerMode = 'advisory' | 'enforce';

/** 검증된 스텝 1건의 산출 — 제안·판정·차단여부·(실행 시)결과. */
export interface VerifiedStepItem<P, R> {
  proposal: P;
  verdict: CheckerVerdict;
  /** enforce + 미승인이면 true(실행 안 함). advisory 면 항상 false. */
  blocked: boolean;
  result?: R;
}

export interface VerifiedStepOpts<P, R> {
  mode: CheckerMode;
  /** enforce 에서 차단된 제안의 결과 대체값(옵션). */
  onBlocked?: (proposal: P, verdict: CheckerVerdict) => R;
}

/**
 * 검증된 루프 스텝: 이미 build 된 제안들을 받아, 각 제안을 (builder 와
 * 분리된) checker 로 판정한 뒤 execute 로 흘려보낸다.
 *  - advisory: 판정을 기록만 하고 모든 제안을 실행(회귀 안전).
 *  - enforce:  승인된 제안만 실행. 미승인은 blocked(onBlocked 결과·없으면 result 없음).
 * 순차 실행(순서 보존). 개별 실행 실패는 execute 가 처리(여기선 throw 전파).
 */
export async function runVerifiedStep<P, R>(
  proposals: P[],
  check: (p: P) => CheckerVerdict,
  execute: (p: P) => Promise<R>,
  opts: VerifiedStepOpts<P, R>,
): Promise<Array<VerifiedStepItem<P, R>>> {
  const out: Array<VerifiedStepItem<P, R>> = [];
  for (const p of proposals) {
    const verdict = check(p); // ★ builder 가 아닌 독립 checker 가 판정
    const blocked = opts.mode === 'enforce' && !verdict.approved;
    if (blocked) {
      out.push({
        proposal: p,
        verdict,
        blocked: true,
        ...(opts.onBlocked ? { result: opts.onBlocked(p, verdict) } : {}),
      });
      continue;
    }
    const result = await execute(p);
    out.push({ proposal: p, verdict, blocked: false, result });
  }
  return out;
}

// ── stop/budget 하드캡 (Phase C · 2026-07-08) ──────────────────────────────
//
// 캐논 교훈(dig v2 의 150k 토큰캡)을 자율 루프 전반에 대칭 적용: 루프는 명시적
// stop condition 없이 돌면 과최적화·과다연산으로 새어나간다. backtest 는 가설을
// 무한히 만들 수 있고(generateHypotheses 확장 시), retro 는 밤마다 돈다. 각 루프에
// "한 틱당 상한(개수·시간)"을 부여해 예산을 상속한다 — 순수 헬퍼(I/O 없음).

/** 루프 1틱의 하드캡. 미지정 항목은 무제한(하위호환). */
export interface StopBudget {
  /** 이번 틱 처리할 최대 항목 수(예: 가설). 초과분은 잘라냄. */
  maxItems?: number;
  /** 이번 틱 예산 소진 기한(epoch ms). 초과 시 이후 항목 중단. */
  deadlineMs?: number;
}

/** 하드캡 적용 결과 — 잘라낸 목록 + 절삭 여부(감사). */
export interface HardCapResult<T> {
  /** 캡 적용 후 실제 처리할 항목. */
  items: T[];
  /** 상한 초과로 잘라냈으면 true. */
  capped: boolean;
  /** 잘라낸 항목 수. */
  dropped: number;
  /** 사람이 읽는 근거(comprehension-debt). */
  reason: string;
}

/** maxItems 로 목록을 잘라 하드캡을 적용(순수). 미지정이면 전량 통과. */
export function applyHardCap<T>(items: T[], budget?: StopBudget): HardCapResult<T> {
  const cap = budget?.maxItems;
  if (cap == null || items.length <= cap) {
    return { items, capped: false, dropped: 0, reason: `상한 내(${items.length}건)` };
  }
  const dropped = items.length - cap;
  return {
    items: items.slice(0, cap),
    capped: true,
    dropped,
    reason: `하드캡 ${cap}건 적용 — ${dropped}건 이월(과다연산 차단)`,
  };
}

/** 예산 소진 여부(시간 데드라인). 루프 매 반복 앞에서 호출해 조기중단. */
export function budgetExhausted(budget: StopBudget | undefined, now: number): boolean {
  return budget?.deadlineMs != null && now >= budget.deadlineMs;
}
