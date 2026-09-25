import { describe, it, expect } from 'bun:test';
import {
  computePhaseBudget,
  computeSplitAllowance,
  phaseBudgetFromConfig,
  parsePhaseBudget,
  DEFAULT_PHASE_BUDGET,
} from './mission-phase-budget.js';

// ★ PLAN-anti-infinite-phase-split Device 1 — 누적 페이즈 예산 cap 순수 로직.
describe('computePhaseBudget', () => {
  it('arcCount×perArc (기본 5/arc)', () => {
    expect(computePhaseBudget(1)).toBe(5);   // e4f97b(아크1) = 5에서 멈춤
    expect(computePhaseBudget(2)).toBe(10);
    expect(computePhaseBudget(4)).toBe(20);
  });

  it('아크 없으면(0) floor', () => {
    expect(computePhaseBudget(0)).toBe(DEFAULT_PHASE_BUDGET.floor); // 8
  });

  it('hardCeiling 로 절대 상한', () => {
    expect(computePhaseBudget(100)).toBe(DEFAULT_PHASE_BUDGET.hardCeiling); // 40 (100×5=500 차단)
  });

  it('custom config 반영', () => {
    expect(computePhaseBudget(3, { perArc: 4, floor: 6, hardCeiling: 30 })).toBe(12);
    expect(computePhaseBudget(0, { perArc: 4, floor: 6, hardCeiling: 30 })).toBe(6);
  });

  it('비정상 arcCount 방어', () => {
    expect(computePhaseBudget(NaN)).toBe(DEFAULT_PHASE_BUDGET.floor);
    expect(computePhaseBudget(-1)).toBe(DEFAULT_PHASE_BUDGET.floor);
    expect(computePhaseBudget(1.4)).toBe(10); // ceil(1.4)=2 → 2×5=10
  });
});

describe('computeSplitAllowance', () => {
  it('여유 충분 — maxSub 그대로 허용', () => {
    const a = computeSplitAllowance(2, 10, 4); // room=8
    expect(a.room).toBe(8);
    expect(a.allowedSub).toBe(4);
    expect(a.capHit).toBe(false);
  });

  it('여유 좁음 — room+1 로 제한(예산 정확히 채움)', () => {
    const a = computeSplitAllowance(9, 10, 4); // room=1 → N≤2
    expect(a.room).toBe(1);
    expect(a.allowedSub).toBe(2); // 1페이즈→2개(net +1) = 예산 10 정확히 도달
    expect(a.capHit).toBe(false);
  });

  it('여유 0 — cap-hit(분할 불가)', () => {
    const a = computeSplitAllowance(10, 10, 4); // room=0 → allowedSub=1 → cap-hit
    expect(a.room).toBe(0);
    expect(a.allowedSub).toBe(1);
    expect(a.capHit).toBe(true);
  });

  it('이미 초과 — cap-hit', () => {
    const a = computeSplitAllowance(12, 10, 4); // room=-2
    expect(a.room).toBe(-2);
    expect(a.allowedSub).toBe(0);
    expect(a.capHit).toBe(true);
  });

  it('경계: room=1 은 split 허용(마지막 1칸)', () => {
    expect(computeSplitAllowance(9, 10, 4).capHit).toBe(false);
    expect(computeSplitAllowance(10, 10, 4).capHit).toBe(true); // 그 다음은 차단
  });
});

describe('parsePhaseBudget (순수·config 파싱)', () => {
  it('전체 지정 반영', () => {
    expect(parsePhaseBudget({ perArc: 4, floor: 6, hardCeiling: 30 })).toEqual({ perArc: 4, floor: 6, hardCeiling: 30 });
  });
  it('부분 지정 — 나머지는 기본값', () => {
    expect(parsePhaseBudget({ perArc: 7 })).toEqual({ perArc: 7, floor: DEFAULT_PHASE_BUDGET.floor, hardCeiling: DEFAULT_PHASE_BUDGET.hardCeiling });
  });
  it('오타/타입오류/음수 방어 — 기본값', () => {
    expect(parsePhaseBudget({ perArc: 'x', floor: -1, hardCeiling: 0 })).toEqual(DEFAULT_PHASE_BUDGET);
    expect(parsePhaseBudget(null)).toEqual(DEFAULT_PHASE_BUDGET);
    expect(parsePhaseBudget(undefined)).toEqual(DEFAULT_PHASE_BUDGET);
    expect(parsePhaseBudget('nonsense')).toEqual(DEFAULT_PHASE_BUDGET);
  });
});

describe('phaseBudgetFromConfig', () => {
  it('config 미설정/실패 시 기본값(fail-soft)', () => {
    const cfg = phaseBudgetFromConfig();
    expect(cfg.perArc).toBeGreaterThan(0);
    expect(cfg.floor).toBeGreaterThan(0);
    expect(cfg.hardCeiling).toBeGreaterThanOrEqual(cfg.floor);
  });
});
