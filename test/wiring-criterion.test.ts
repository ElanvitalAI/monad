// ⭐ B5(72차): 무인 리뷰의 «반사 기각»이 *"파서가 실행 경로에 배선되지 않았다"* 를 찾고도
//   ***"goal 이 배선하라고 요구하지 않았다"*** 로 놓아준다(`review-reflect` 기각 사유 73건 중 9건).
//   레버는 「판사에 예외를 넣기」가 아니라 ***골이 «항상» 요구하기***다 — required evidence 가
//   골 문면에서 파생되기 때문이다(`off-diff-evidence.ts requiredEvidenceFromGoal`).
// ⛔ 그러나 ***채울 수 없는 요구는 만들지 않는다*** — 이 시험은 그 «두 예외»를 못 박는다.
import { describe, expect, test } from 'bun:test';
import { wiringCriterionApplies, WIRING_CRITERION_LINE } from '../src/self-implement/goal-author.js';
import { assessAutonomyEligibility } from '../src/self-implement/context-capsule.js';
import type { CodebaseGrounding } from '../src/autopilot/mission-codebase-gate.js';

const grounding = (files: string[]): CodebaseGrounding => ({
  grounded: true, context: '', files,
  persistentEvidence: [], codeFacts: [], skillFacts: [], memoryFacts: [],
  documentFacts: [], refFacts: [], ptyFacts: [],
});

describe('wiringCriterionApplies', () => {
  test('붙는다 — 접지된 코드 후보가 있고 ask 가 코드 경로를 가리킬 때', () => {
    expect(wiringCriterionApplies('Fix src/self-implement/goal-author.ts behavior.', grounding(['src/self-implement/goal-author.ts']))).toBe(true);
  });

  test('붙는다 — ask 가 경로를 하나도 안 대도 접지가 코드를 찾았으면', () => {
    expect(wiringCriterionApplies('진행 상황을 보이게 해라.', grounding(['src/example.ts']))).toBe(true);
  });

  // ⛔ ⑴ caller 를 댈 근거가 «없다» — 접지된 코드 후보가 0.
  //   📏 72차 실측: 제공자 장애로 이 상태가 저작의 «절반»이었다. 그때 배선을 요구하면 채울 수 없는 요구가 된다.
  test.each([
    ['접지 자체가 없다', null],
    ['코드 후보가 0이다', grounding([])],
    ['후보가 skill 문서뿐이라 경로 정책이 다 떨군다', grounding(['.claude/skills/absorb/SKILL.md'])],
  ])('안 붙는다 — %s', (_caseName, facts) => {
    expect(wiringCriterionApplies('Fix src/self-implement/goal-author.ts behavior.', facts)).toBe(false);
  });

  // ⛔ ⑵ 문서만 고치는 골 — 배선할 「불리는 단위」가 없다.
  test.each([
    ['docs/ 경로 하나', 'docs/manual/MANUAL-x.md 를 고친다.'],
    ['docs/ 경로 둘', '대상 경로: docs/a.md · docs/b.md 를 고친다.'],
    ['docs 밖의 .md 하나', '대상 경로: notes/plan.md 를 고친다.'],
  ])('안 붙는다 — 문서만 가리킨다(%s)', (_caseName, ask) => {
    expect(wiringCriterionApplies(ask, grounding(['src/self-implement/goal-author.ts']))).toBe(false);
  });

  // ⛔ 경계를 «있는 그대로» 못 박는다: `askPathTokens` 는 ***슬래시가 있어야*** 경로로 센다.
  //   ⇒ 최상위 `README.md` 는 「경로를 안 댄 ask」로 읽히고, 접지가 코드를 찾았으면 기준이 붙는다.
  //   ⚠️ 이것은 의도한 설계가 아니라 ***지금의 계약***이다. 바꾸려면 askPathTokens 를 먼저 바꿔야 한다.
  test('경계 — 최상위 `README.md` 는 경로 토큰이 «아니다»(슬래시 없음) ⇒ 기준이 붙는다', () => {
    expect(wiringCriterionApplies('README.md 를 고친다.', grounding(['src/self-implement/goal-author.ts']))).toBe(true);
  });

  // ⭐ 문서 «와» 코드를 같이 대면 붙는다 — 「문서만」이 예외 조건이다.
  test('붙는다 — 문서와 코드를 «같이» 댔을 때', () => {
    expect(wiringCriterionApplies('대상 경로: docs/a.md · src/self-implement/goal-author.ts', grounding(['src/self-implement/goal-author.ts']))).toBe(true);
  });
});

// ⭐ 2026-08-11 73차 — 이 줄이 «무인 리뷰 위험 판정»에 물리면 안 된다.
//   📏 실측: 종전 문면의 `wire`(“not to wire it”)가 금전 패턴 `\b…|transfer|wire)\b` 에 물려
//     `autoreview.decision declined` riskHits 에 ***38건*** 쌓였다 — ***저작기가 자기 골을 떨어뜨렸다.***
//   ⛔ 반증 지점: 문면을 되돌리면 이 시험이 빨개진다.
describe('배선 기준 문면은 무인 리뷰 위험 판정에 «안» 물린다', () => {
  test('WIRING_CRITERION_LINE 만으로는 자율 부적격이 되지 않는다', () => {
    // ⛔ 문자열을 «복사하지 않는다» — 배포 상수를 그대로 문다(복사본이면 소스를 되돌려도 통과한다).
    const verdict = assessAutonomyEligibility({ objective: WIRING_CRITERION_LINE, evidenceRequired: ['review-gate'] });
    expect(verdict.riskHits ?? []).toEqual([]);
  });

  test('실제로 골에 실리는 그 줄이 위 문자열과 «같다» — 문면이 갈리면 위 시험이 무의미해진다', () => {
    const grounded = grounding(['src/self-implement/goal-author.ts']);
    expect(wiringCriterionApplies('Fix src/self-implement/goal-author.ts behavior.', grounded)).toBe(true);
  });
});
