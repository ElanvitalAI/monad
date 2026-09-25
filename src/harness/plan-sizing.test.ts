// plan-sizing — C3 plan-time 크기 게이트 + C1 경량 Context Capsule 빌더 테스트
// [[RFC-plan-as-rfc-generation-2026-07-22]] §8. 미션 SSOT(gradePhaseCompletability) 재사용·오탐0·soft 규율 고정.

import { describe, test, expect } from 'bun:test';
import { gradePlanSteps, buildHarnessCapsuleFromPlan, renderCapsuleDigest } from './plan-sizing.js';

const AT = '2026-07-23T00:00:00.000Z';

describe('gradePlanSteps — C3 plan-time 크기 게이트(텍스트-only·오탐0)', () => {
  test('평범한 스텝 = 과대 아님(오탐 0)', () => {
    // concerns 2·conjunction 있어도 concerns<3 이면 too_large 아님(2026-07-19 텍스트-단독 억제).
    const s = gradePlanSteps(['결제 모듈의 환불 처리 흐름을 구현하고 관련 엣지 케이스를 분석한다, 부분환불·중복요청을 다룬다']);
    expect(s.oversizedCount).toBe(0);
    expect(s.underDecomposed).toBe(false);
    expect(s.grades[0]!.verdict).not.toBe('too_large');
  });

  test('결합·다관심사 스텝 = too_large(under-decomposition 신호)', () => {
    // concerns 3(design+implement+verify) AND conjunction(",") → 텍스트 corroborated too_large.
    const s = gradePlanSteps(['타입 설계, 로직 구현, 테스트 검증']);
    expect(s.oversizedCount).toBe(1);
    expect(s.grades[0]!.verdict).toBe('too_large');
  });

  test('과대 스텝 ≥2 → underDecomposed(narrow-redecompose 임계와 동형)', () => {
    const s = gradePlanSteps([
      '타입 설계, 로직 구현, 테스트 검증',
      '데이터 조사 및 스키마 정의 및 배포 실행',
      '문서 업데이트',
    ]);
    expect(s.oversizedCount).toBe(2);
    expect(s.underDecomposed).toBe(true);
  });

  test('빈 스텝 목록 = 무해', () => {
    const s = gradePlanSteps([]);
    expect(s).toEqual({ grades: [], oversizedCount: 0, tooSmallCount: 0, underDecomposed: false });
  });
});

describe('buildHarnessCapsuleFromPlan — C1 경량 Context Capsule', () => {
  test('steps=inScope · gate 기본 evidence · createdAt 주입(순수)', () => {
    const c = buildHarnessCapsuleFromPlan({ objective: '캡슐 결합', steps: ['a', 'b'], createdAt: AT });
    expect(c.objective).toBe('캡슐 결합');
    expect(c.target).toBe('repo');
    expect(c.inScope).toEqual(['a', 'b']);
    expect(c.evidenceRequired.length).toBeGreaterThan(0);
    expect(c.successCriteria.length).toBeGreaterThan(0);
    expect(c.createdAt).toBe(AT);
  });

  test('groundingRefs provenance 보존 · target 주입', () => {
    const c = buildHarnessCapsuleFromPlan({
      objective: 'g', steps: ['s'], target: 'main', createdAt: AT,
      groundingRefs: [{ ref: '[code:foo]', provenance: 'code' }, { ref: '[skill:bar]', provenance: 'skill' }],
    });
    expect(c.target).toBe('main');
    expect(c.groundingRefs.map((g) => g.provenance)).toEqual(['code', 'skill']);
  });

  test('같은 입력 = 같은 capsule(순수·결정론)', () => {
    const a = buildHarnessCapsuleFromPlan({ objective: 'x', steps: ['s'], createdAt: AT });
    const b = buildHarnessCapsuleFromPlan({ objective: 'x', steps: ['s'], createdAt: AT });
    expect(a).toEqual(b);
  });

  test('잘못된 provenance → throw(buildHarnessContextCapsule 검증 상속)', () => {
    expect(() => buildHarnessCapsuleFromPlan({
      objective: 'x', steps: ['s'], createdAt: AT,
      groundingRefs: [{ ref: 'r', provenance: 'bogus' as unknown as 'code' }],
    })).toThrow();
  });
});

describe('renderCapsuleDigest — 한 화면 설계 계약 본문', () => {
  test('목표·범위·성공기준·증거 렌더', () => {
    const c = buildHarnessCapsuleFromPlan({ objective: '결제 환불', steps: ['환불 API', '엣지 처리'], createdAt: AT });
    const d = renderCapsuleDigest(c);
    expect(d).toContain('설계 계약');
    expect(d).toContain('결제 환불');
    expect(d).toContain('환불 API');
    expect(d).toContain('완료 증거');
  });

  test('빈 필드는 생략(위험 경계 없으면 미표시)', () => {
    const c = buildHarnessCapsuleFromPlan({ objective: 'o', steps: ['s'], createdAt: AT });
    expect(renderCapsuleDigest(c)).not.toContain('위험 경계');
  });
});

// 🚨 73차 실측 — ***캡슐의 「나침반」 필드 둘이 정보를 «안 담는다»***(퇴화 검사 ⓐ 항상 같은 값 · ⓑ 항상 영).
//   📏 전수 `capsule-built` 24건: `successCriteria` 가 «전부 1» · `outOfScope` 가 «전부 0» 이었다.
//   🔎 기전: 씨앗(clarify 인터뷰)이 없으면 아래 «하드코딩 한 줄»이 들어가는데, clarify 는
//     autoDrive=on 이면 «스킵»되고 물을 것이 없으면 씨앗을 «안 만든다». ⇒ 사실상 항상 기본값이다.
//   🎯 그래서 ***비-코드 objective(조사·보고)는 이 기준을 원리상 만족할 수 없다***
//     (실측: read-only 런 셋이 전부 execute-failed · 사유 = *"미충족 성공기준: 계획된 모든 스텝이…"*).
//   ⛔ 이 시험은 그 사실을 «고치는» 것이 아니라 ***「알려진 상수」로 못 박는다*** — 조용히 바뀌면 여기서 깨진다.
describe('캡슐 기본 성공기준은 «하나의 상수»다 — 알려진 한계', () => {
  test('씨앗이 없으면 성공기준이 «정확히 하나»이고 그 문면이 코드 변경을 전제한다', () => {
    const capsule = buildHarnessCapsuleFromPlan({ objective: 'README 첫 줄만 보고한다', steps: ['읽는다'], createdAt: '1970-01-01T00:00:00.000Z' });
    expect(capsule.successCriteria).toHaveLength(1);
    expect(capsule.successCriteria[0]).toContain('gate');
    // ⛔ 그리고 「범위 밖」은 «비어 있다» — 나침반의 둘째 바늘이 없다.
    expect(capsule.outOfScope).toEqual([]);
  });

  test('씨앗이 있으면 그것이 «이긴다» — 퇴화는 기본값 경로에만 있다', () => {
    const capsule = buildHarnessCapsuleFromPlan({
      objective: 'o', steps: ['s'], createdAt: '1970-01-01T00:00:00.000Z',
      successCriteria: ['A 완주', 'B 검증'], outOfScope: ['C 는 안 한다'],
    });
    expect(capsule.successCriteria).toEqual(['A 완주', 'B 검증']);
    expect(capsule.outOfScope).toEqual(['C 는 안 한다']);
  });
});
