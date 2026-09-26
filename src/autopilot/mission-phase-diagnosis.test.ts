// ── mission-phase-diagnosis — 진단 + 셀프 힐 정책(대표 2026-07-13·PLAN O1/O5/O6) ──
import { describe, it, expect } from 'bun:test';
import {
  classifyFailClass, isTooBig, recommendHeal, synthesizePhaseDiagnosis, renderAttemptTrail,
  buildPhaseOutcomeFromSummary, parseTriageHealOverride,
  type PhaseOutcome, type PhaseAttempt,
} from './mission-phase-diagnosis.js';

function outcome(over: Partial<PhaseOutcome> = {}): PhaseOutcome {
  return {
    phaseId: 'task:p2', missionId: 'apm_x', title: '후보를 verify-first로 검증하고 상위 3개를 산정하라',
    index: 2, total: 7, status: 'failed', attempts: [], ...over,
  };
}
const A = (o: Partial<PhaseAttempt>): PhaseAttempt => ({ backend: 'elanous-self:gpt-5.6-terra', gateResult: 'gate-failed', ...o });

describe('O1 · classifyFailClass', () => {
  it('환경 제약(gh 인증 부재)은 텍스트보다 우선 → missing-capability', () => {
    expect(classifyFailClass({ text: '예산 소진으로 실패', envSignals: { ghAuth: false } })).toBe('missing-capability');
  });
  it('보안 경계(문서 명령 거부) → provenance', () => {
    expect(classifyFailClass({ text: '문서 안 명령 실행 거부(권한 없는 데이터)' })).toBe('provenance');
  });
  it('★ P0 — LLM/API 인증 401·delegate command-failed → missing-capability (budget-exhausted 오귀속 차단·2a014e)', () => {
    expect(classifyFailClass({ text: 'ApiHttpError: Anthropic API 401: invalid x-api-key' })).toBe('missing-capability');
    expect(classifyFailClass({ text: 'authentication_error' })).toBe('missing-capability');
    expect(classifyFailClass({ text: 'delegate 오류: Command failed: bun scripts/se-elanous-self-impl.ts' })).toBe('missing-capability');
    // gate 실패는 여전히 gate-failed-tests (auth 패턴에 안 삼켜짐)
    expect(classifyFailClass({ text: '무결성 게이트 실패 3 test fail' })).toBe('gate-failed-tests');
  });
  it('비평 verdict fail → gate-failed-critique', () => {
    expect(classifyFailClass({ critiqueVerdict: 'fail' })).toBe('gate-failed-critique');
    expect(classifyFailClass({ text: 'draft-plan.ts가 변경되지 않아 dead-code' })).toBe('gate-failed-critique');
  });
  it('★ 이미 구현/랜딩됨 → already-satisfied (dead-code no-op 과 구분·P1b)', () => {
    expect(classifyFailClass({ text: '이미 구현되어 변경 불필요' })).toBe('already-satisfied');
    expect(classifyFailClass({ text: 'nothing to commit(이미 반영됨)' })).toBe('already-satisfied');
    expect(classifyFailClass({ text: 'invalid vault root 테스트가 이미 main 에 있음' })).toBe('already-satisfied');
    // dead-code no-op(배선 누락)은 여전히 critique — critiqueVerdict fail 이면 already 로 안 샘.
    expect(classifyFailClass({ text: '이미 있으나 dead-code', critiqueVerdict: 'fail' })).toBe('gate-failed-critique');
  });
  it('테스트 실패 → gate-failed-tests', () => {
    expect(classifyFailClass({ text: '무결성 게이트 실패: 3 fail' })).toBe('gate-failed-tests');
  });
  it('일시 → transient', () => {
    expect(classifyFailClass({ text: '네트워크 연결 실패, 잠시 후 다시 시도' })).toBe('transient');
  });
  it('기본 폴백 → budget-exhausted', () => {
    expect(classifyFailClass({ text: 'terra 1000턴 폴백까지 소진' })).toBe('budget-exhausted');
    expect(classifyFailClass({})).toBe('budget-exhausted');
  });
});

describe('isTooBig — 분할 신호', () => {
  it('opus 폴백 + 게이트 실패 → too big', () => {
    expect(isTooBig(outcome({ attempts: [A({}), A({ backend: 'opus-4.8' })] }))).toBe(true);
  });
  it('게이트 실패 2회 이상 → too big', () => {
    expect(isTooBig(outcome({ attempts: [A({}), A({})] }))).toBe(true);
  });
  it('5파일 이상 동시 변경 → too big', () => {
    expect(isTooBig(outcome({ attempts: [A({})], diffSummary: { filesTouched: ['a','b','c','d','e'], plannedFiles: [], added: 1, deleted: 0 } }))).toBe(true);
  });
  it('단일 게이트 실패 → not too big', () => {
    expect(isTooBig(outcome({ attempts: [A({})] }))).toBe(false);
  });
});

describe('O6 · recommendHeal (§4 정책)', () => {
  it('transient → rebuild(high)', () => {
    const h = recommendHeal(outcome({ failClass: 'transient', attempts: [A({ gateResult: 'error' })] }));
    expect(h.kind).toBe('rebuild'); expect(h.confidence).toBe('high');
  });
  it('dead-code(critique) 단발 → rebuild', () => {
    expect(recommendHeal(outcome({ failClass: 'gate-failed-critique', attempts: [A({})] })).kind).toBe('rebuild');
  });
  it('budget + too-big → split', () => {
    const h = recommendHeal(outcome({ failClass: 'budget-exhausted', attempts: [A({}), A({ backend: 'opus-4.8' })] }));
    expect(h.kind).toBe('split');
  });
  it('missing-capability → revise', () => {
    expect(recommendHeal(outcome({ failClass: 'missing-capability', attempts: [A({})] })).kind).toBe('revise');
  });
  it('★ already-satisfied → skip(high·재구현 무의미·P1b)', () => {
    const h = recommendHeal(outcome({ failClass: 'already-satisfied', attempts: [A({})] }));
    expect(h.kind).toBe('skip'); expect(h.confidence).toBe('high');
  });
  it('provenance → escalate', () => {
    expect(recommendHeal(outcome({ failClass: 'provenance', attempts: [A({})] })).kind).toBe('escalate');
  });
});

describe('renderAttemptTrail', () => {
  it('백엔드·턴·게이트결과를 트레일로(정상 ladder=프리픽스 없음)', () => {
    expect(renderAttemptTrail([A({ maxTurns: 1000 }), A({ backend: 'opus-4.8' })]))
      .toBe('gpt-5.6-terra 1000턴→gate-failed → opus-4.8→gate-failed');
  });
  it('★ no-change 는 "no-op(변경0)"로 정직 표시(built=성공 오인 방지·대표 2026-07-14)', () => {
    const t = renderAttemptTrail([A({ backend: 'opus-4.8', gateResult: 'no-change' })]);
    expect(t).toContain('no-op(변경0)');
    expect(t).not.toContain('→built'); // no-op 을 built 로 위장 안 함
  });
  it('★ 누적(rebuild 여러 번)로 6회 초과면 "누적 N회(앞 M 생략)" + 최근 6만', () => {
    const many = Array.from({ length: 9 }, (_, i) => A({ backend: i % 2 ? 'opus-4.8' : 'elanous-self:gpt-5.6-terra', gateResult: 'no-change' }));
    const t = renderAttemptTrail(many);
    expect(t).toContain('누적 9회');
    expect(t).toContain('앞 3 생략');                       // 9 - 6 = 3
    expect((t.match(/no-op\(변경0\)/g) ?? []).length).toBe(6); // 최근 6개만 표시
  });
});

describe('O5 · synthesizePhaseDiagnosis — P2 실제 시나리오(opus 수준)', () => {
  // 실측 P2: terra 1000턴 gate-failed → opus 폴백 gate-failed · gh 인증 부재.
  const p2 = outcome({
    goal: 'draft-plan 확장, 후보를 코드/테스트/git/GitHub 증거와 대조해 9열 점수표 상위 3개 산정',
    failClass: 'budget-exhausted',
    attempts: [A({ maxTurns: 1000 }), A({ backend: 'opus-4.8', maxTurns: 300 })],
    envSignals: { ghAuth: false, worktree: 'se-...-b689' },
    evidenceRefs: { runLogPath: '/x/run.log' },
  });

  it('narrative = 목표 + 시도 트레일 + 분류(사실)', () => {
    const d = synthesizePhaseDiagnosis(p2);
    expect(d.narrative).toContain('목표:');
    expect(d.narrative).toContain('gpt-5.6-terra 1000턴→gate-failed → opus-4.8 300턴→gate-failed');
    expect(d.narrative).toContain('예산');
  });

  it('rootCause = 왜(추론) + 근거 · "추정" 명시 · gh 제약 포착', () => {
    const d = synthesizePhaseDiagnosis(p2);
    expect(d.rootCauseInference).toContain('추정');
    expect(d.rootCauseInference).toContain('과대 페이즈');       // 여러 재시도 게이트 실패
    expect(d.rootCauseInference).toContain('gh 인증 부재');       // envSignals 근거
    expect(d.confidence).toBe('high');                           // 환경 신호 있음
  });

  it('권장 힐 = 분할(budget+too-big)', () => {
    expect(synthesizePhaseDiagnosis(p2).healRecommendation.kind).toBe('split');
  });

  it('LLM 없이도 동작(결정론 골격·fail-soft)', () => {
    const d = synthesizePhaseDiagnosis(outcome({ failClass: 'budget-exhausted', attempts: [A({})] }));
    expect(d.narrative.length).toBeGreaterThan(10);
    expect(d.rootCauseInference).toContain('추정');
    expect(d.confidence).toBe('low');                            // 근거 신호 없음
  });

  it('LLM 추론 주입 시 rootCause 대체(narrative는 결정론 유지)', () => {
    const d = synthesizePhaseDiagnosis(p2, { llmRootCause: 'gh 접근 없이 원격 증거를 못 모아 검증 불가한 구조.' });
    expect(d.rootCauseInference).toBe('gh 접근 없이 원격 증거를 못 모아 검증 불가한 구조.');
    expect(d.narrative).toContain('시도:');                      // narrative는 사실이라 그대로
  });
});

describe('O1 배선 · buildPhaseOutcomeFromSummary (요약 → 사실 복원)', () => {
  it('실패 요약 태그에서 failClass·시도수 복원', () => {
    const o = buildPhaseOutcomeFromSummary({
      phaseId: 'task:p2', missionId: 'apm_x', title: 'verify-first', index: 2, total: 7,
      status: 'failed', summary: '[FAIL·budget·3회내 시도] gpt-5.6-terra 1000턴 gate-failed → opus 4.8 폴백 실패',
    });
    expect(o.failClass).toBe('budget-exhausted');
    expect(o.attempts.length).toBe(3);
    expect(o.attempts[0]!.maxTurns).toBe(1000);
    expect(o.attempts[o.attempts.length - 1]!.backend).toBe('opus-4.8'); // 마지막=opus 폴백
    expect(isTooBig(o)).toBe(true);                                       // opus 폴백+게이트실패
  });

  it('비평 fail 요약 → gate-failed-critique', () => {
    const o = buildPhaseOutcomeFromSummary({
      phaseId: 'task:p1', missionId: 'apm_x', title: 'index', index: 1, total: 7,
      status: 'failed', summary: '[FAIL·unknown·1회내 시도] draft-plan 미수정 dead-code',
      critiqueVerdict: 'fail', critiqueReason: 'draft-plan.ts 미변경',
    });
    expect(o.failClass).toBe('gate-failed-critique');
    expect(o.critiqueReason).toBe('draft-plan.ts 미변경');
  });

  it('envSignals gh 부재 → 요약과 무관하게 missing-capability + 진단이 gh 포착', () => {
    const o = buildPhaseOutcomeFromSummary({
      phaseId: 'task:p2', missionId: 'apm_x', title: 'verify-first', index: 2, total: 7,
      status: 'failed', summary: '[FAIL·budget·2회내 시도] 소진', envSignals: { ghAuth: false },
    });
    expect(o.failClass).toBe('missing-capability');
    expect(synthesizePhaseDiagnosis(o).rootCauseInference).toContain('능력 부재');
  });

  it('done 페이즈 → failClass 없음·built 감지', () => {
    const o = buildPhaseOutcomeFromSummary({
      phaseId: 'task:p1', missionId: 'apm_x', title: 'index', index: 1, total: 7,
      status: 'done', summary: '[SE·PR] 격리 구현 완료 → PR https://github.com/x/y/pull/3970',
    });
    expect(o.failClass).toBeUndefined();
    expect(o.attempts[o.attempts.length - 1]!.gateResult).toBe('built');
  });
});

describe('R2 모순 감지 → 시스템 의심(price-guard 회귀·2026-07-13)', () => {
  it('변경 파일 있는데 "diff 본문 없음" 비평 실패 → escalate(split 오진 방지) + narrative 시스템 의심', () => {
    const o = outcome({
      title: '단일 시세 스냅샷 수집 루프를 구현하라', failClass: 'gate-failed-critique',
      critiqueVerdict: 'fail', critiqueReason: '실제 diff 본문이 없어 acceptance 충족 여부를 검증할 수 없습니다.',
      attempts: [A({ gateResult: 'gate-failed' }), A({ gateResult: 'gate-failed' })],
      diffSummary: { filesTouched: ['docs/x.md'], plannedFiles: [], added: 0, deleted: 0 },
    });
    const d = synthesizePhaseDiagnosis(o);
    expect(d.healRecommendation.kind).toBe('escalate'); // 모순=시스템 의심 → split/재시도 오진 아님
    expect(d.narrative).toContain('시스템 결함 의심');
  });

  it('정상 diff(본문 있음) → 모순 없음, 기존 힐 유지(과탐 방지)', () => {
    const o = outcome({
      failClass: 'gate-failed-critique', critiqueVerdict: 'fail', critiqueReason: 'dead-code 의심',
      attempts: [A({ gateResult: 'gate-failed' })],
      diffSummary: { filesTouched: ['a.ts'], plannedFiles: ['a.ts'], added: 10, deleted: 2 },
    });
    const d = synthesizePhaseDiagnosis(o);
    expect(d.healRecommendation.kind).not.toBe('escalate');
    expect(d.narrative).not.toContain('시스템 결함 의심');
  });
});

describe('parseTriageHealOverride — triage 결정을 힐로 매핑', () => {
  it('walker 마커 revise → revise(P6·premise 부재)', () => {
    expect(parseTriageHealOverride('[실패·blocked] [재시도 triage 권장: revise — 전제 부재] 사후검증...')).toBe('revise');
  });
  it('walker 마커 split → split', () => {
    expect(parseTriageHealOverride('[재시도 triage 권장: split — 과대]')).toBe('split');
  });
  it('SE 마커 split → split', () => {
    expect(parseTriageHealOverride('[SE triage: split] ✂️ 분할 필요 — 구조적 실패. VERDICT: FAIL')).toBe('split');
  });
  it('SE 마커 revise → revise', () => {
    expect(parseTriageHealOverride('[SE triage: revise] 📝 골 범위 축소 — gh 인증 부재')).toBe('revise');
  });
  it('retry 경로(retry-discipline/retry-escalate) → rebuild', () => {
    expect(parseTriageHealOverride('[재시도 triage 권장: retry-discipline — 규율]')).toBe('rebuild');
    expect(parseTriageHealOverride('[SE triage: retry-escalate] 재시도')).toBe('rebuild');
  });
  it('마커 없으면 null(결정론 recommendHeal 유지)', () => {
    expect(parseTriageHealOverride('[실패·budget] 그냥 예산 소진, triage 마커 없음')).toBeNull();
    expect(parseTriageHealOverride('')).toBeNull();
  });
  it('walker 과부하(compact-breaker-open) 요약 마커 → split (자율 폐루프 배선 계약·2026-07-21)', () => {
    // run-mission 이 과부하 감지 시 heavyDecision(path=split, 괄호·한글 rationale)로 실는 실제 요약 형태.
    // 다운스트림 parseTriageHealOverride → split → 자율 splitPhaseIntoSubphases 로 라우팅되는 hinge 를 잠근다.
    const summary = '[overload(fail)·overload·1회 시도] [재시도 triage 권장: split — walker 과부하(compaction-no-reduce·turn 12·연속압축실패 3) — 컨텍스트 폭발 조기 분할(예산 상향 역효과)] 부분 조사...';
    expect(parseTriageHealOverride(summary)).toBe('split');
  });
})

describe('isTooBig requireSizeSignal — split 남발 교정(대표 2026-07-21)', () => {
  // 재시도 2회 게이트실패(terra, diff 없음) — "walker 가 완수 못한 실패"이지 크기 신호 아님.
  const retried = outcome({ attempts: [A({ gateResult: 'gate-failed' }), A({ gateResult: 'gate-failed' })] });

  it('OFF(종전): 재시도 2회 = big(재시도로 과대 자동성립 — 남발 근원)', () => {
    expect(isTooBig(retried)).toBe(true);
  });
  it('ON: 재시도 2회 단독으론 big=false(실패를 크기로 오귀속 차단)', () => {
    expect(isTooBig(retried, { requireSizeSignal: true })).toBe(false);
  });
  it('ON: 실제 파일 다수(≥5)면 big=true(진짜 크기 신호)', () => {
    const bigDiff = outcome({ attempts: [A({})], diffSummary: { filesTouched: ['a', 'b', 'c', 'd', 'e'], plannedFiles: [], added: 20, deleted: 0 } });
    expect(isTooBig(bigDiff, { requireSizeSignal: true })).toBe(true);
  });
  it('ON: 계단소진(opus)+반복이면 big=true(강신호)', () => {
    const escalated = outcome({ attempts: [A({ gateResult: 'gate-failed' }), A({ gateResult: 'gate-failed', backend: 'elanous-self:opus-4-8' })] });
    expect(isTooBig(escalated, { requireSizeSignal: true })).toBe(true);
  });
  it('ON: recommendHeal 도 재시도만이면 split 아닌 rebuild(예산 리셋 재시도)', () => {
    expect(recommendHeal({ ...retried, failClass: 'budget-exhausted' }, { requireSizeSignal: true }).kind).toBe('rebuild');
    // OFF 는 종전대로 split(무회귀 대조).
    expect(recommendHeal({ ...retried, failClass: 'budget-exhausted' }).kind).toBe('split');
  });
})

describe('grounding-rejected — walker 완주·grounding 반려 = split 아닌 rebuild(대표 2026-07-21·⑤)', () => {
  it('grounding 반려 마커 → grounding-rejected (budget-exhausted 오분류 차단)', () => {
    expect(classifyFailClass({ text: '[grounding 실패] 조사 증거 합성 없이 완료 참칭 — 재조사 필요(grounding·missing_evidence).' })).toBe('grounding-rejected');
  });
  it('grounding-rejected → rebuild (opus 계단·재시도로 big 이어도 split 아님)', () => {
    const escalated = outcome({ failClass: 'grounding-rejected', attempts: [A({ gateResult: 'gate-failed' }), A({ gateResult: 'gate-failed', backend: 'elanous-self:opus-4-8' })] });
    expect(recommendHeal(escalated).kind).toBe('rebuild');
    // strictOversize 무관하게도 rebuild.
    expect(recommendHeal(escalated, { requireSizeSignal: true }).kind).toBe('rebuild');
  });
})
