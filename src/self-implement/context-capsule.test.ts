import { describe, expect, test } from 'bun:test';
import { buildHarnessContextCapsule, assessAutonomyEligibility, resolveAutoReview, resolveAutoReviewLabels, AUTO_REVIEW_LABEL, type HarnessContextCapsuleInput, type HarnessGroundingRef } from './context-capsule.js';
import { verbatimOriginalAsk } from './goal-author.js';

describe('buildHarnessContextCapsule — W1 shared outcome contract', () => {
  test('모든 계약 필드와 grounding provenance를 보존한다', () => {
    const input: HarnessContextCapsuleInput = {
      objective: 'Context Capsule을 구현한다',
      target: 'src/self-implement/context-capsule.ts',
      inScope: ['순수 타입과 빌더', 'unit test'],
      outOfScope: ['run-store 배선', '새 store'],
      successCriteria: ['모든 consumer가 같은 capsule을 소비한다'],
      evidenceRequired: ['focused bun:test 통과', 'tsc 통과'],
      riskBoundaries: ['디스크와 네트워크에 접근하지 않는다'],
      groundingRefs: [
        { ref: 'src/self-implement/orchestrator.ts', provenance: 'code' },
        { ref: 'elanous-self-build', provenance: 'skill' },
        { ref: 'self-harness prior run', provenance: 'memory' },
        { ref: 'PLAN-waza-borrowings-for-self-harness-2026-07-23', provenance: 'doc' },
      ],
      createdAt: '2026-07-23T00:00:00.000Z',
    };

    expect(buildHarnessContextCapsule(input)).toEqual(input);
  });

  test('알 수 없는 grounding provenance는 거부한다', () => {
    const input = {
      objective: 'X', target: 'Y', inScope: [], outOfScope: [], successCriteria: [], evidenceRequired: [], riskBoundaries: [],
      groundingRefs: [{ ref: 'unknown', provenance: 'url' }], createdAt: '2026-07-23T00:00:00.000Z',
    } as unknown as HarnessContextCapsuleInput;

    expect(() => buildHarnessContextCapsule(input)).toThrow('Unknown harness grounding provenance: url');
  });

  test("provenance='pty'를 수용한다(F2 — 상류 PTY 잡 capsule 을 하류 grounding 으로)", () => {
    const input: HarnessContextCapsuleInput = {
      objective: 'X', target: 'Y', inScope: [], outOfScope: [], successCriteria: [], evidenceRequired: [], riskBoundaries: [],
      groundingRefs: [{ ref: 'upstream-job:build-x', provenance: 'pty' }], createdAt: '2026-07-25T00:00:00.000Z',
    };
    expect(buildHarnessContextCapsule(input).groundingRefs[0]!.provenance).toBe('pty');
  });

  test('원본 groundingRefs를 나중에 변경해도 capsule은 독립적으로 보존한다', () => {
    const groundingRefs: HarnessGroundingRef[] = [{ ref: 'src/original.ts', provenance: 'code' }];
    const input: HarnessContextCapsuleInput = {
      objective: 'X', target: 'Y', inScope: [], outOfScope: [], successCriteria: [], evidenceRequired: [], riskBoundaries: [],
      groundingRefs, createdAt: '2026-07-23T00:00:00.000Z',
    };

    const capsule = buildHarnessContextCapsule(input);
    groundingRefs[0]!.ref = 'src/mutated.ts';
    groundingRefs.push({ ref: 'later', provenance: 'doc' });

    expect(capsule.groundingRefs).toEqual([{ ref: 'src/original.ts', provenance: 'code' }]);
  });
});

describe('assessAutonomyEligibility — G8 무인 완결 자기판단(fail-safe)', () => {
  test('저위험·객관게이트·리뷰 clean → eligible', () => {
    const r = assessAutonomyEligibility({
      objective: '순수 퍼센트 포매터에 경계값 단위 테스트를 추가한다',
      target: 'main', evidenceRequired: ['tsc'], reviewVerdict: 'pass',
    });
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('내부 리뷰 verdict=fail(must-fix) → 부적합', () => {
    const r = assessAutonomyEligibility({ objective: '포매터 추가', evidenceRequired: ['tsc'], reviewVerdict: 'fail' });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some(x => x.includes('must-fix'))).toBe(true);
  });

  test.each([
    ['외부 배포', '이 기능을 production 에 배포하고 롤아웃한다', '외부 배포/운영 반영'],
    ['실주문', 'place order 로 실매수 주문을 넣는다', '실주문/금전 거래'],
    ['설계 분기', '전체 스키마를 재설계하고 마이그레이션한다', '설계/아키텍처 분기'],
    ['파괴적', 'drop table 로 전면 삭제한다', '파괴적 작업'],
    ['보안', 'api-key 와 secret 을 로테이션한다', '보안/인증 정보'],
  ])('위험 신호(%s) → 부적합', (_label, objective, expectedReason) => {
    const r = assessAutonomyEligibility({ objective, evidenceRequired: ['tsc'], reviewVerdict: 'pass' });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some(x => x.includes(expectedReason))).toBe(true);
  });

  test.each([
    'Do not import this module anywhere in production code',
    'must not silently destroy the rework budget',
    'This is a measurement task, not a migration. do NOT copy or rewrite classification logic',
    '운영 반영은 금지하고 마이그레이션은 하지 않는다',
    'Do not deploy to production',
    '배포하지 말 것',
    // ⚠️ 문장부호로 끝나는 형태 — 종전 lookahead 가 `,`/`$` 만 허용해 마침표가 남으면 억제에 실패했다.
    //    위 무-마침표 케이스만 있어서 그 구멍이 테스트를 통과했다(행위 검증에서 실측으로 드러남).
    '운영 반영은 하지 말 것.',
    '배포하지 않는다!',
  ])('명시적 부정 범위 문장(%s)은 위험 신호를 억제해 eligible', (objective) => {
    const r = assessAutonomyEligibility({ objective, evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(true);
    expect(r.riskHits).toEqual([]);
    expect(r.suppressedRiskHits.length).toBeGreaterThan(0);
  });

  test.each([
    ['배포', 'production code로 배포한다'],
    ['거래', 'place order로 payment를 실행한다'],
    ['설계', 'migration으로 schema change를 적용한다'],
    ['파괴', 'destroy the rework budget'],
    ['보안', 'secret을 로테이션한다'],
  ])('부정 없는 위험 문장(%s)은 계속 거절', (_family, objective) => {
    const r = assessAutonomyEligibility({ objective, evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(false);
    expect(r.riskHits.length).toBeGreaterThan(0);
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('", or "로 끝나는 부정된 등위 나열은 쌍반점 전 쉼표를 범위 경계로 삼지 않는다', () => {
    const list = assessAutonomyEligibility({
      objective: 'Do not replace, rewrite, summarize, truncate, translate, or clean up the verbatim ask',
      evidenceRequired: ['tsc'],
    });
    expect(list.riskHits).toEqual([]);
    expect(list.suppressedRiskHits.map((hit) => hit.match)).toContain('rewrite');

    const semicolon = assessAutonomyEligibility({ objective: 'Do not update docs; deploy to production', evidenceRequired: ['tsc'] });
    expect(semicolon.riskHits.map((hit) => hit.match)).toContain('production');
    expect(semicolon.suppressedRiskHits).toEqual([]);

    const direct = assessAutonomyEligibility({ objective: 'Do not deploy to production', evidenceRequired: ['tsc'] });
    expect(direct.riskHits).toEqual([]);
    expect(direct.suppressedRiskHits.map((hit) => hit.match)).toContain('deploy');
  });

  test.each(['but', 'however', 'except', 'unless'])('모호한 대조 표지 %s는 fail-safe로 위험 신호를 유지', (marker) => {
    const r = assessAutonomyEligibility({ objective: `Do not deploy, ${marker} release it after approval`, evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(false);
    expect(r.riskHits.map((hit) => hit.reason)).toContain('외부 배포/운영 반영');
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('앞선 production은 뒤의 "not a migration"에 억제되지 않는다', () => {
    const r = assessAutonomyEligibility({ objective: 'Deploy to production is not a migration', evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(false);
    expect(r.riskHits.some((hit) => hit.reason === '외부 배포/운영 반영')).toBe(true);
    expect(r.suppressedRiskHits).toEqual([{ reason: '설계/아키텍처 분기', match: 'migration', sentence: 'Deploy to production is not a migration', field: 'objective', suppressionReason: 'explicit-negation' }]);
    expect(resolveAutoReviewLabels(true, { objective: 'Deploy to production is not a migration', evidenceRequired: ['tsc'] }).declineReasons)
      .toContain('위험 신호: 외부 배포/운영 반영');
  });

  test('다른 술어인 "Never skip approval"은 뒤의 deployment를 억제하지 않는다', () => {
    const r = assessAutonomyEligibility({ objective: 'Never skip approval before deploying to production', evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(false);
    expect(r.riskHits.map((hit) => hit.reason)).toContain('외부 배포/운영 반영');
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('키워드 없는 목표는 기존처럼 eligible', () => {
    const r = assessAutonomyEligibility({ objective: '순수 포매터 단위 테스트를 추가한다', evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(true);
    expect(r.riskHits).toEqual([]);
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('골 문서 objective는 ask 밖 위험 히트를 억제하되 ask 안의 위험과 사람 입력 필드는 계속 차단한다', () => {
    const objective = [
      '## PROBLEM',
      '접지 산문은 production deployment를 증거로 인용한다.',
      'Original ask (verbatim, unmodified):',
      '```',
      'Deploy to production',
      '```',
      '## ACCEPTANCE CRITERIA',
      '저작기 기준은 migration을 언급한다.',
    ].join('\n');
    const r = assessAutonomyEligibility({
      objective, originalAsk: verbatimOriginalAsk(objective) ?? undefined,
      riskBoundaries: ['production deployment'],
      outOfScope: ['migration'],
      evidenceRequired: ['tsc'],
    });

    expect(r.eligible).toBe(false);
    expect(r.riskHits.map((hit) => [hit.field, hit.match])).toEqual([
      ['objective', 'Deploy'],
      ['objective', 'production'],
      ['riskBoundaries', 'production'],
      ['outOfScope', 'migration'],
    ]);
    expect(r.suppressedRiskHits).toEqual([
      expect.objectContaining({ field: 'objective', match: 'production', suppressionReason: 'outside-original-ask' }),
      expect.objectContaining({ field: 'objective', match: 'migration', suppressionReason: 'outside-original-ask' }),
    ]);
  });

  test('ask 밖 prefix와 suffix를 붙여서만 생기는 위험 토큰은 만들지 않고 실제 구간 문장을 보존한다', () => {
    const originalAsk = '안전한 ask';
    const objective = `Deploy prefix.\nproduc${originalAsk}tion\nMigration suffix.`;
    const r = assessAutonomyEligibility({ objective, originalAsk, evidenceRequired: ['tsc'] });

    expect(r.eligible).toBe(true);
    expect(r.riskHits).toEqual([]);
    expect(r.suppressedRiskHits).toEqual([
      {
        reason: '외부 배포/운영 반영',
        match: 'Deploy',
        sentence: 'Deploy prefix.',
        field: 'objective',
        suppressionReason: 'outside-original-ask',
      },
      {
        reason: '설계/아키텍처 분기',
        match: 'Migration',
        sentence: 'Migration suffix.',
        field: 'objective',
        suppressionReason: 'outside-original-ask',
      },
    ]);
    expect(r.suppressedRiskHits.map((hit) => hit.match.toLowerCase())).not.toContain('production');
  });

  test('ask를 떼어 낼 수 없는 objective는 전체 위험 스캔을 계속 차단한다', () => {
    const r = assessAutonomyEligibility({ objective: '접지 산문에 production deployment를 인용한다', evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(false);
    expect(r.riskHits.map((hit) => hit.field)).toEqual(['objective']);
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('objective에 없는 originalAsk는 전체 위험 스캔으로 fail-safe 폴백한다', () => {
    const objective = '접지 산문에 production deployment를 인용한다';
    const r = assessAutonomyEligibility({ objective, originalAsk: '유틸을 추가한다', evidenceRequired: ['tsc'] });

    expect(r.eligible).toBe(false);
    expect(r.riskHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'objective', match: 'production' }),
    ]));
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('추출 때 검증된 ask 범위는 반복된 ask 문자열에도 ask 밖 위험을 억제한다', () => {
    const ask = 'Deploy to production';
    const objective = [
      `RootIntent: ${ask}`,
      'Original ask (verbatim, unmodified):',
      '```',
      ask,
      '```',
      '저작기 기준은 migration을 언급한다.',
    ].join('\n');
    const start = objective.lastIndexOf(ask);
    const r = assessAutonomyEligibility({ objective, originalAsk: ask, originalAskRange: { start, end: start + ask.length }, evidenceRequired: ['tsc'] });

    expect(r.eligible).toBe(false);
    expect(r.riskHits).toHaveLength(2);
    expect(r.riskHits.every((hit) => hit.sentence === ask)).toBe(true);
    expect(r.suppressedRiskHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ sentence: `RootIntent: ${ask}`, suppressionReason: 'outside-original-ask' }),
      expect.objectContaining({ match: 'migration', suppressionReason: 'outside-original-ask' }),
    ]));
  });

  test('문자열과 어긋난 제공 범위는 사용하지 않고 fail-safe 전체 스캔한다', () => {
    const ask = 'Deploy to production';
    const objective = `prefix ${ask}\nsuffix migration`;
    const r = assessAutonomyEligibility({ objective, originalAsk: ask, originalAskRange: { start: 0, end: ask.length }, evidenceRequired: ['tsc'] });

    expect(r.riskHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ match: 'Deploy' }),
      expect.objectContaining({ match: 'migration' }),
    ]));
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('선행 중복 ask 문구는 모호하므로 전체 위험 스캔으로 fail-safe 폴백한다', () => {
    const ask = 'Deploy to production';
    const objective = [
      `접지 산문이 ${ask}를 증거로 인용한다.`,
      'Original ask (verbatim, unmodified):',
      '```',
      ask,
      '```',
      '저작기 기준은 migration을 언급한다.',
    ].join('\n');
    const r = assessAutonomyEligibility({ objective, originalAsk: verbatimOriginalAsk(objective) ?? undefined, evidenceRequired: ['tsc'] });

    expect(r.eligible).toBe(false);
    expect(r.riskHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ sentence: `접지 산문이 ${ask}를 증거로 인용한다.`, match: 'Deploy' }),
      expect.objectContaining({ sentence: ask, match: 'Deploy' }),
      expect.objectContaining({ match: 'migration' }),
    ]));
    expect(r.suppressedRiskHits).toEqual([]);
  });

  test('명시적 부정과 ask 밖 objective 억제는 서로 다른 사유를 보존한다', () => {
    const objective = [
      'Original ask (verbatim, unmodified):',
      '```',
      'Do not deploy to production',
      '```',
      '저작기 기준은 migration을 언급한다.',
    ].join('\n');
    const r = assessAutonomyEligibility({ objective, originalAsk: verbatimOriginalAsk(objective) ?? undefined, evidenceRequired: ['tsc'] });

    expect(r.eligible).toBe(true);
    expect(r.suppressedRiskHits.map((hit) => hit.suppressionReason)).toEqual([
      'outside-original-ask',
      'explicit-negation',
      'explicit-negation',
    ]);
  });

  test('capsule 의 riskBoundaries/outOfScope 도 부정 없는 위험 신호를 스캔한다', () => {
    const r = assessAutonomyEligibility({
      objective: '유틸 추가', riskBoundaries: ['운영 반영 적용'], evidenceRequired: ['tsc'],
    });
    expect(r.eligible).toBe(false);
  });

  test('필드별 출처를 보존하고 같은 필드의 반복 위험 문장과 reasons를 중복 제거한다', () => {
    const sentence = 'Deploy to production';
    const acrossFields = assessAutonomyEligibility({ objective: sentence, target: sentence, evidenceRequired: ['tsc'] });
    expect(acrossFields.eligible).toBe(false);
    expect(acrossFields.riskHits).toEqual([
      { reason: '외부 배포/운영 반영', match: 'Deploy', sentence, field: 'objective' },
      { reason: '외부 배포/운영 반영', match: 'production', sentence, field: 'objective' },
      { reason: '외부 배포/운영 반영', match: 'Deploy', sentence, field: 'target' },
      { reason: '외부 배포/운영 반영', match: 'production', sentence, field: 'target' },
    ]);

    const repeatedInField = assessAutonomyEligibility({ objective: '유틸 추가', riskBoundaries: [sentence, sentence], evidenceRequired: ['tsc'] });
    expect(repeatedInField.eligible).toBe(false);
    expect(repeatedInField.riskHits).toEqual([
      { reason: '외부 배포/운영 반영', match: 'Deploy', sentence, field: 'riskBoundaries' },
      { reason: '외부 배포/운영 반영', match: 'production', sentence, field: 'riskBoundaries' },
    ]);
    expect(repeatedInField.reasons).toEqual(['위험 신호: 외부 배포/운영 반영']);
  });

  test('서로 다른 문장과 필드의 같은 분류 히트는 보존하되 reasons는 출력 문자열로 중복 제거한다', () => {
    const r = assessAutonomyEligibility({
      objective: 'Deploy to production now',
      target: 'Release this change today',
      evidenceRequired: ['tsc'],
    });

    expect(r.eligible).toBe(false);
    expect(r.riskHits).toEqual([
      { reason: '외부 배포/운영 반영', match: 'Deploy', sentence: 'Deploy to production now', field: 'objective' },
      { reason: '외부 배포/운영 반영', match: 'production', sentence: 'Deploy to production now', field: 'objective' },
      { reason: '외부 배포/운영 반영', match: 'Release', sentence: 'Release this change today', field: 'target' },
    ]);
    expect(r.reasons).toEqual(['위험 신호: 외부 배포/운영 반영']);
  });

  test('같은 필드의 반복된 억제 위험 문장도 중복 제거하고 기존 값과 출처를 보존한다', () => {
    const sentence = 'Do not deploy to production';
    const r = assessAutonomyEligibility({ objective: '유틸 추가', outOfScope: [sentence, sentence], evidenceRequired: ['tsc'] });
    expect(r.eligible).toBe(true);
    expect(r.riskHits).toEqual([]);
    expect(r.suppressedRiskHits).toEqual([
      { reason: '외부 배포/운영 반영', match: 'deploy', sentence, field: 'outOfScope', suppressionReason: 'explicit-negation' },
      { reason: '외부 배포/운영 반영', match: 'production', sentence, field: 'outOfScope', suppressionReason: 'explicit-negation' },
    ]);
  });

  test('evidenceRequired 가 명시적으로 비면 부적합(심판 근거 약함)·미지정은 보류(통과)', () => {
    expect(assessAutonomyEligibility({ objective: '문서만 수정', evidenceRequired: [] }).eligible).toBe(false);
    expect(assessAutonomyEligibility({ objective: '유틸 추가' }).eligible).toBe(true); // evidenceRequired 미지정
  });

  test('AUTO_REVIEW_LABEL 상수', () => {
    expect(AUTO_REVIEW_LABEL).toBe('auto-review');
  });
});

describe('resolveAutoReview — G8 자동부착 확대(config 모드 × 플래그)', () => {
  test('off = kill switch (플래그 있어도 false)', () => {
    expect(resolveAutoReview('off', true)).toBe(false);
    expect(resolveAutoReview('off', false)).toBe(false);
  });
  test('opt-in(기본) = 플래그 있을 때만', () => {
    expect(resolveAutoReview('opt-in', true)).toBe(true);
    expect(resolveAutoReview('opt-in', false)).toBe(false);
  });
  test('auto = 플래그 없어도 시도(eligibility 게이트가 위험 거부)', () => {
    expect(resolveAutoReview('auto', false)).toBe(true);
    expect(resolveAutoReview('auto', true)).toBe(true);
  });
});

describe('resolveAutoReviewLabels — G9 P1 라벨 해석 SSOT(harness↔self-implement 공유)', () => {
  test('autoReview=false → 빈 결과(라벨·사유 없음·게이트 스킵)', () => {
    const r = resolveAutoReviewLabels(false, { objective: '유틸 추가', evidenceRequired: ['tsc'] });
    expect(r.labels).toBeUndefined();
    expect(r.declineReasons).toBeUndefined();
  });

  test('적격(저위험+증거) → labels=[AUTO_REVIEW_LABEL]·사유 없음', () => {
    const r = resolveAutoReviewLabels(true, { objective: '포매터 추가', evidenceRequired: ['tsc'], reviewVerdict: 'pass' });
    expect(r.labels).toEqual([AUTO_REVIEW_LABEL]);
    expect(r.declineReasons).toBeUndefined();
  });

  test('부적합(리뷰 fail) → labels 없음·declineReasons 채워짐(사람 판단)', () => {
    const r = resolveAutoReviewLabels(true, { objective: '포매터 추가', evidenceRequired: ['tsc'], reviewVerdict: 'fail' });
    expect(r.labels).toBeUndefined();
    expect(r.declineReasons && r.declineReasons.length).toBeGreaterThan(0);
  });

  test('부적합(위험 신호=배포) → labels 없음·사유에 위험 반영', () => {
    const r = resolveAutoReviewLabels(true, { objective: '운영 배포 반영', evidenceRequired: ['tsc'] });
    expect(r.labels).toBeUndefined();
    expect(r.declineReasons?.some((s) => /위험/.test(s))).toBe(true);
  });

  test('harness 시맨틱(verdict 없음 → evidenceRequired=[]) = 증거약함으로 부적합', () => {
    // harness deploy 는 verdict 미존재 시 evidenceRequired:[] 를 넘김(fail-safe·비-TS 오라벨 방지).
    const r = resolveAutoReviewLabels(true, { objective: '문서 갱신', evidenceRequired: [] });
    expect(r.labels).toBeUndefined();
    expect(r.declineReasons && r.declineReasons.length).toBeGreaterThan(0);
  });
});
