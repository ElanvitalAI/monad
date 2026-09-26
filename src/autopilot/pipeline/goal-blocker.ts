// GoalBlocker 유형화 — 셀프힐 라우팅 (조율자 격상 P4)
//
// ★ RFC P4(셀프힐 자동집행). DeerFlow GoalBlocker 이식 — 페이즈 실패의 "왜"를 유형화해 힐 경로를
//   가른다: needs_user_input→HITL(사람만) · missing_evidence→재조사(자동) · run_failed→재시도(자동).
//   Progress Ledger(P2) 가 "stall(재계획 필요)"을 판정하면, 이 유형화가 "무슨 힐로"를 정한다.
//   elanous 넘버원룰: 스스로 판단·힐링(자동) → 안 되면 HITL. 안전(RFC §5): 자동집행은 코딩/빌드·
//   무해·멱등·grounded 만(decideAutonomousAct 가드가 실집행 게이트). 매매 fail-CLOSED 불변.
// 순수·결정론(실패 요약/failClass → 유형). I/O 없음.

/** GoalBlocker 유형 — 실패의 근본 성격. */
export type GoalBlockerKind = 'needs_user_input' | 'missing_evidence' | 'run_failed' | 'unknown';

/** 힐 경로 — hitl(사람 승인)·re-research(재조사·자동)·retry(재시도·자동)·escalate(자율 소진→HITL). */
export type HealRoute = 'hitl' | 're-research' | 'retry' | 'escalate';

export interface GoalBlockerVerdict {
  kind: GoalBlockerKind;
  route: HealRoute;
  autoHealable: boolean;   // route 가 자동(재조사/재시도)이면 true
  reason: string;
}

/** 실패 요약에서 사용자 입력 필요 신호(범위 모호·확정 필요·되묻기). */
const NEEDS_USER = /사용자.*(확정|입력|되묻|결정)|범위.*모호|clarif|needs?[-_ ]?(user|input|clarification)|권한|승인 필요/i;
/** 전제/근거 부재 신호(재조사로 채울 수 있는 갭). */
const MISSING_EVIDENCE = /전제.*(부재|없)|근거.*(부족|없)|파일.*못 찾|경로.*불명|미확인|재조사|grounding|not found|정보.*부족/i;
/** 일시/실행 실패 신호(재시도 가치). */
const RUN_FAILED = /예산.*소진|timeout|타임아웃|일시|transient|budget|rate.?limit|재시도|네트워크|일시적/i;

/** ★ 순수 유형화 — 실패 요약(+선택 failClass) → GoalBlocker. Progress Ledger stall 위에서 "무슨 힐로".
 *  우선순위: 사용자입력(HITL) > 근거부재(재조사) > 실행실패(재시도) > unknown(보수적 HITL/escalate). */
export function classifyGoalBlocker(summary: string, opts: { failClass?: string } = {}): GoalBlockerVerdict {
  const hay = `${summary} ${opts.failClass ?? ''}`;
  if (NEEDS_USER.test(hay)) {
    return { kind: 'needs_user_input', route: 'hitl', autoHealable: false, reason: '사용자 입력/확정 필요 — 자동 불가(HITL)' };
  }
  if (MISSING_EVIDENCE.test(hay)) {
    return { kind: 'missing_evidence', route: 're-research', autoHealable: true, reason: '근거/전제 부재 — 재조사로 채움(자동·진단 주입)' };
  }
  if (RUN_FAILED.test(hay)) {
    return { kind: 'run_failed', route: 'retry', autoHealable: true, reason: '일시/실행 실패 — 재시도 가치(자동)' };
  }
  return { kind: 'unknown', route: 'escalate', autoHealable: false, reason: '유형 불명 — 보수적 escalate(HITL·기본거부)' };
}

/** GoalBlocker → aa1Heal seam recommend 형태(actClass/idempotent/grounded). 자동힐(재조사/재시도)은
 *  harmless+멱등(워킹메모리 진단 주입=비파괴)·grounded(요약에서 유형 확정). HITL 유형은 sensitive(사람).
 *  decideAutonomousAct 가드가 이 분류로 실집행 vs HITL 을 최종 결정. 순수. */
export function goalBlockerToHealRecommend(
  v: GoalBlockerVerdict,
): { kind: string; actClass: 'harmless' | 'sensitive' | 'unclassified'; idempotent: boolean; grounded: boolean } {
  if (v.autoHealable) {
    return { kind: v.route, actClass: 'harmless', idempotent: true, grounded: true };
  }
  // needs_user_input=sensitive(사람 승인)·unknown=unclassified(기본거부→HITL).
  return { kind: v.route, actClass: v.kind === 'needs_user_input' ? 'sensitive' : 'unclassified', idempotent: false, grounded: false };
}
