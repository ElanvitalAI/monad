// 조율자 Command — 실제 라우팅 제어 프리미티브 (조율자 격상 P3)
//
// ★ RFC P3(Command 실제 컨트롤). LangGraph Command(goto, update) 이식 — 조율자가 신호(분류 저신뢰·
//   Progress Ledger 판정)에 따라 실행을 어디로 보낼지 결정한다. shadow(관측만)에서 실제 제어로.
//   대표 dogfood 실패(분류 저신뢰→오분류→scope creep)의 근본 대응: 저신뢰면 조율자가 개입한다.
//
// 안전(RFC §5): 조율자=순수 위임자(판단만·집행은 스테이지). 개입은 보수적(재분류→보수 라우팅)이고
//   실제 적용은 opt-in 게이트(autopilot.coordinatorControl·기본 OFF) 뒤. 매매 fail-CLOSED 불변.
// 결정은 순수 로직(결정론·신호→command). I/O 없음.

/** 조율자 명령 종류 — proceed(현행)·reclassify(재분류 시도)·route-conservative(보수 라우팅)·
 *  replan(재계획)·escalate(HITL). LangGraph Command.goto/update 의 elanous 어휘. */
export type CommandAction = 'proceed' | 'reclassify' | 'route-conservative' | 'replan' | 'escalate';

/** 조율자 명령 — action + 선택적 goto(대상)/update(채널 갱신)/reason. */
export interface CoordinatorCommand {
  action: CommandAction;
  goto?: string;                     // 라우팅 대상(스테이지/페이즈/프레임워크)
  update?: Record<string, unknown>;  // 채널 갱신(LangGraph Command.update)
  reason: string;
}

/** 결정 입력 신호 — 분류 저신뢰(A축)·재분류 소진 여부·Progress Ledger 권장(P2). */
export interface CommandSignals {
  /** 페이즈 분류가 저신뢰(llm-fail-regex/llm-uncertain-regex) — 오분류 위험. */
  classifyLowConfidence?: boolean;
  /** 재분류(강한 tier)해도 여전히 저신뢰 — 보수 라우팅으로. */
  reclassifyExhausted?: boolean;
  /** Progress Ledger 권장(P2·evaluateProgressLedger). */
  ledgerRecommendation?: 'done' | 'continue' | 'replan' | 'escalate';
  /** ★ 자율 PR 리뷰 재작업 교착(R1·RFC-autonomous-pr-review) — 한 페이즈가 리뷰 verdict=fail 로 재작업을
   *  반복(리뷰-재작업 루프). ledger 는 페이즈 done/failed 만 보므로(res.ok=true 인 리뷰 fail 은 안 잡힘)
   *  이 신호가 별도로 replan(재분해·접근전환)을 유발한다. R2 coevolve 발산방어와 상보(관측층 bounding). */
  reviewReworkStalled?: boolean;
}

/** 보수 라우팅 대상 — 저신뢰 시 조율자가 선호하는 안전 프레임워크. operational(walker)=읽기 전용
 *  조사라 scope creep/파괴 위험이 se-isolated 보다 낮다(대표 dogfood 근본: 오분류→se→scope creep). */
export const CONSERVATIVE_ROUTE = 'operational';

/** ★ 순수 결정 — 신호 → CoordinatorCommand. 우선순위: Ledger escalate/replan > 분류 저신뢰 개입 > proceed.
 *  결정론. 실제 적용은 호출측 opt-in 게이트(조율자=위임자·집행은 스테이지). */
export function decideCoordinatorCommand(sig: CommandSignals): CoordinatorCommand {
  // Ledger 신호가 최우선(미션 전체 진행 판정).
  if (sig.ledgerRecommendation === 'escalate') {
    return { action: 'escalate', reason: 'Progress Ledger: 연속 실패 — 자동 수렴 불가(HITL)' };
  }
  if (sig.ledgerRecommendation === 'replan') {
    return { action: 'replan', reason: 'Progress Ledger: stall(진전없음/루프) — 재계획' };
  }
  // ★ 리뷰 재작업 교착(R1) — ledger 가 못 보는 리뷰-재작업 루프. ledger replan/escalate 다음 우선순위로 replan.
  if (sig.reviewReworkStalled) {
    return { action: 'replan', reason: '자율 PR 리뷰 재작업 반복(리뷰-재작업 루프) — 재분해·접근전환(HITL S7)' };
  }
  // 분류 저신뢰 개입(A축·오분류 방지).
  if (sig.classifyLowConfidence) {
    if (sig.reclassifyExhausted) {
      return {
        action: 'route-conservative', goto: CONSERVATIVE_ROUTE,
        reason: '분류 저신뢰 지속 — 보수 라우팅(operational·scope creep 방지)',
      };
    }
    return { action: 'reclassify', reason: '분류 저신뢰 — 강한 tier 로 재분류 시도(조율자 개입)' };
  }
  return { action: 'proceed', reason: '신호 정상 — 현행 라우팅 진행' };
}

// ── UR2 — 라우팅 결정을 중앙 State 가 소유(2026-07-19) ─────────────────────────
// 조율자 라우팅 결정을 State 의 routing 채널(append)에 write 하고, 재실행/재개 시 State 에서 읽어
// durable 하게 만든다(로컬 변수 shadow → State 소유). 전부 순수.

/** State routing 채널에 누적되는 라우팅 결정 1건. phaseKind=해석된 프레임워크 라우팅(operational/implementation). */
export interface RoutingDecision {
  phaseId: string;
  phaseKind: string;
  action: CommandAction;
  reason: string;
}

/** 라우팅 결정 → 중앙 State 채널 갱신(applyChannelUpdate 대상). routing=append 라 이력 누적. 순수. */
export function routingUpdate(decision: RoutingDecision): { channel: string; value: RoutingDecision } {
  return { channel: 'routing', value: decision };
}

/** 중앙 State 에서 이 페이즈의 최신 라우팅 결정 조회(effectiveArcHint 패턴 — 마지막 매칭). 순수. undefined=없음. */
export function routingForPhase(state: { routing?: unknown }, phaseId: string): RoutingDecision | undefined {
  const hist = Array.isArray(state.routing) ? state.routing : (state.routing === undefined ? [] : [state.routing]);
  for (let i = hist.length - 1; i >= 0; i--) {
    const r = hist[i];
    if (r && typeof r === 'object' && (r as RoutingDecision).phaseId === phaseId && typeof (r as RoutingDecision).phaseKind === 'string') {
      return r as RoutingDecision;
    }
  }
  return undefined;
}

// ── R1 — 자율 PR 리뷰 판정을 중앙 State 가 소유(2026-07-20) ─────────────────────
// routing 동형: 리뷰 verdict/PR/findings 를 review 채널(append)에 write → resume/재실행이 State 에서 읽어
// durable(재리뷰 방지·리뷰 압력 회상). 재작업 교착 신호는 exec 프레임에서 순수 파생. 전부 순수.

/** State review 채널에 누적되는 리뷰 판정 1건. verdict=리뷰어 판정·findings=블로커(mustFix). */
export interface ReviewDecision {
  phaseId: string;
  verdict: 'pass' | 'warn' | 'fail';
  prUrl?: string;
  findings?: string[];
}

/** 리뷰 판정 → 중앙 State 채널 갱신(review=append 이력 누적). 순수. */
export function reviewUpdate(decision: ReviewDecision): { channel: string; value: ReviewDecision } {
  return { channel: 'review', value: decision };
}

/** 중앙 State 에서 이 페이즈의 전 리뷰 판정 이력(순서 보존·R2 발산방어가 라운드/직전 블로커 파생). 순수. */
export function reviewsForPhase(state: { review?: unknown }, phaseId: string): ReviewDecision[] {
  const hist = Array.isArray(state.review) ? state.review : (state.review === undefined ? [] : [state.review]);
  return hist.filter((r): r is ReviewDecision =>
    !!r && typeof r === 'object' && (r as ReviewDecision).phaseId === phaseId && typeof (r as ReviewDecision).verdict === 'string');
}

/** 중앙 State 에서 이 페이즈의 최신 리뷰 판정 조회(마지막 매칭·routingForPhase 패턴). 순수. undefined=없음. */
export function reviewForPhase(state: { review?: unknown }, phaseId: string): ReviewDecision | undefined {
  const hist = Array.isArray(state.review) ? state.review : (state.review === undefined ? [] : [state.review]);
  for (let i = hist.length - 1; i >= 0; i--) {
    const r = hist[i];
    if (r && typeof r === 'object' && (r as ReviewDecision).phaseId === phaseId && typeof (r as ReviewDecision).verdict === 'string') {
      return r as ReviewDecision;
    }
  }
  return undefined;
}

/** ★ 리뷰 재작업 신호 파생(순수·R1) — exec 프레임에서 review-gate 판정을 집계. reviewFailures=리뷰 fail
 *  총수(status=blocked) · reviewReworkStalled=한 페이즈가 review-gate blocked ≥ stallThreshold(기본 2·
 *  리뷰-재작업 루프). ledger 가 못 보는 리뷰-재작업 교착을 decideCoordinatorCommand 로 흘린다(S7 연결). */
export function deriveReviewSignals(
  frames: readonly { phaseId?: string; op?: string; status?: string }[],
  opts: { stallThreshold?: number } = {},
): { reviewFailures: number; reviewReworkStalled: boolean } {
  const stallThreshold = opts.stallThreshold ?? 2;
  const failByPhase = new Map<string, number>();
  let reviewFailures = 0;
  for (const f of frames) {
    if (f.op !== 'review-gate' || f.status !== 'blocked') continue;
    reviewFailures++;
    if (f.phaseId) failByPhase.set(f.phaseId, (failByPhase.get(f.phaseId) ?? 0) + 1);
  }
  const reviewReworkStalled = [...failByPhase.values()].some((n) => n >= stallThreshold);
  return { reviewFailures, reviewReworkStalled };
}
