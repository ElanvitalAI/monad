// 미션 예산 config-first 오버라이드 — 결정 순서(config→env→기본) 검증 (2026-07-14).
import { test, expect, describe, afterEach } from 'bun:test';
import {
  parseBudgetList, resolveSeBudgetLadder, resolveWalkerBudget, resolveWalkerMaxTurns,
  SE_BUDGET_LADDER_DEFAULT, WALKER_BUDGET_DEFAULT,
  WALKER_TOKENS_PER_TURN, WALKER_MAX_TURNS_CEIL,
} from './mission-budget.js';
import { setUserConfigOverlay } from '../user-config.js';

const savedSe = process.env.ELANOUS_SE_BUDGET;
const savedWalker = process.env.ELANOUS_WALKER_BUDGET;
afterEach(() => {
  setUserConfigOverlay(null);
  if (savedSe === undefined) delete process.env.ELANOUS_SE_BUDGET; else process.env.ELANOUS_SE_BUDGET = savedSe;
  if (savedWalker === undefined) delete process.env.ELANOUS_WALKER_BUDGET; else process.env.ELANOUS_WALKER_BUDGET = savedWalker;
});

describe('parseBudgetList', () => {
  test('배열 → 양수만', () => {
    expect(parseBudgetList([150, 400, 1000])).toEqual([150, 400, 1000]);
    expect(parseBudgetList([150, -5, 0, 'x', 400])).toEqual([150, 400]);
  });
  test('"a,b,c" 문자열 파싱', () => {
    expect(parseBudgetList('200,600,1500')).toEqual([200, 600, 1500]);
  });
  test('유효값 0개 → null(폴백 유도)', () => {
    expect(parseBudgetList([])).toBeNull();
    expect(parseBudgetList('')).toBeNull();
    expect(parseBudgetList(null)).toBeNull();
    expect(parseBudgetList(42)).toBeNull();
  });
});

describe('resolveSeBudgetLadder — config→env→기본', () => {
  test('아무것도 없으면 기본값', () => {
    delete process.env.ELANOUS_SE_BUDGET;
    setUserConfigOverlay(null);
    expect(resolveSeBudgetLadder()).toEqual([...SE_BUDGET_LADDER_DEFAULT]);
  });
  test('env 오버라이드(이제 있다 — 전엔 전무)', () => {
    delete process.env.ELANOUS_SE_BUDGET;
    process.env.ELANOUS_SE_BUDGET = '200,600,1600';
    expect(resolveSeBudgetLadder()).toEqual([200, 600, 1600]);
  });
  test('user-config 가 env 보다 우선(config-first)', () => {
    process.env.ELANOUS_SE_BUDGET = '200,600,1600';
    setUserConfigOverlay((c) => ({ ...c, autopilot: { budget: { se: [300, 800, 2000] } } } as typeof c));
    expect(resolveSeBudgetLadder()).toEqual([300, 800, 2000]);
  });
  test('config 가 "a,b,c" 문자열이어도 파싱', () => {
    delete process.env.ELANOUS_SE_BUDGET;
    setUserConfigOverlay((c) => ({ ...c, autopilot: { budget: { se: '250,700,1800' } } } as typeof c));
    expect(resolveSeBudgetLadder()).toEqual([250, 700, 1800]);
  });
});

describe('resolveWalkerBudget — 정책 통일', () => {
  test('기본값', () => {
    delete process.env.ELANOUS_WALKER_BUDGET;
    setUserConfigOverlay(null);
    expect(resolveWalkerBudget()).toEqual([...WALKER_BUDGET_DEFAULT]);
  });
  test('config 가 env 보다 우선', () => {
    process.env.ELANOUS_WALKER_BUDGET = '100000';
    setUserConfigOverlay((c) => ({ ...c, autopilot: { budget: { walker: [200000, 400000] } } } as typeof c));
    expect(resolveWalkerBudget()).toEqual([200000, 400000]);
  });
  // ★ 2026-07-19 회귀가드 — 실 디스크 config 는 autopilot 을 .raw 아래 둔다(typed 필드 아님). budgetFromConfig
  //   가 .raw.autopilot.budget 을 읽어야 config 노브가 실제로 먹는다(종전엔 typed .autopilot 만 읽어 죽어 있었음).
  test('raw.autopilot.budget 경로에서 읽는다(실 디스크 config 형태)', () => {
    delete process.env.ELANOUS_WALKER_BUDGET;
    setUserConfigOverlay((c) => ({ ...c, raw: { ...(c as { raw?: object }).raw, autopilot: { budget: { walker: [8000] } } } } as typeof c));
    expect(resolveWalkerBudget()).toEqual([8000]);
  });
});

describe('resolveWalkerMaxTurns — 예산→턴 상한(무회귀 tighten-only)', () => {
  test('기본 계단(≥128k)은 undefined — family 기본 유지(회귀0)', () => {
    // 현행 배선을 절대 tighten/loosen 하지 않는다: 모든 기본 예산은 상한 미설정.
    for (const b of WALKER_BUDGET_DEFAULT) expect(resolveWalkerMaxTurns(b)).toBeUndefined();
  });
  test('경계값 정확 — 최소 기본값(128k) 바로 아래에서만 상한 발동', () => {
    const floor = WALKER_BUDGET_DEFAULT[0]!; // 128000
    expect(resolveWalkerMaxTurns(floor)).toBeUndefined();       // 같으면 미발동(family 기본)
    expect(resolveWalkerMaxTurns(floor - 1)).toBe(16);          // 바로 아래는 발동: round(127999/8000)=16
  });
  test('작은 예산 → 비례 상한(tiny 예산 강제)', () => {
    expect(resolveWalkerMaxTurns(200)).toBe(1);                          // round(0.025)→max(1,·)
    expect(resolveWalkerMaxTurns(WALKER_TOKENS_PER_TURN)).toBe(1);       // 8000→1턴
    expect(resolveWalkerMaxTurns(WALKER_TOKENS_PER_TURN * 6)).toBe(6);   // 48000→6턴
  });
  test('실링 초과 금지 — 어떤 예산도 family 기본 위로 loosen 안 함', () => {
    // 127999(floor 바로 아래·최대) → round(16.0)=16 ≤ 24 실링. 절대 24 초과 없음.
    expect(resolveWalkerMaxTurns(127999)).toBeLessThanOrEqual(WALKER_MAX_TURNS_CEIL);
  });
  test('비정상 입력 → undefined(폴백)', () => {
    expect(resolveWalkerMaxTurns(0)).toBeUndefined();
    expect(resolveWalkerMaxTurns(-100)).toBeUndefined();
    expect(resolveWalkerMaxTurns(Number.NaN)).toBeUndefined();
    expect(resolveWalkerMaxTurns(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
