import { test, expect, describe } from 'bun:test';
import { applyHardCap, budgetExhausted, combineChecks, runVerifiedStep, type CheckResult, type CheckerVerdict } from './loop-contract.js';

const ok = (name: string): CheckResult => ({ name, passed: true, detail: 'ok' });
const bad = (name: string): CheckResult => ({ name, passed: false, detail: 'fail' });

describe('combineChecks — AND 합성', () => {
  test('전부 통과 → approved', () => {
    const v = combineChecks([ok('a'), ok('b')]);
    expect(v.approved).toBe(true);
    expect(v.reason).toContain('2개 체크 통과');
  });
  test('하나라도 실패 → 미승인 + 실패 이름 나열', () => {
    const v = combineChecks([ok('a'), bad('b'), bad('c')]);
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('b·c');
  });
  test('빈 목록 → approved(무조건)', () => {
    expect(combineChecks([]).approved).toBe(true);
  });
});

describe('runVerifiedStep — builder != checker 오케스트레이터', () => {
  const approve = (): CheckerVerdict => combineChecks([ok('x')]);
  const reject = (): CheckerVerdict => combineChecks([bad('x')]);

  test('advisory: 미승인이어도 모든 제안 실행(회귀 안전)', async () => {
    const ran: number[] = [];
    const out = await runVerifiedStep([1, 2, 3], reject, async (p) => { ran.push(p); return `r${p}`; }, { mode: 'advisory' });
    expect(ran).toEqual([1, 2, 3]);         // 판정 무관하게 전부 실행
    expect(out.every((o) => o.blocked === false)).toBe(true);
    expect(out.map((o) => o.result)).toEqual(['r1', 'r2', 'r3']);
    expect(out.every((o) => o.verdict.approved === false)).toBe(true); // 판정은 기록됨
  });

  test('enforce: 미승인 제안은 실행 안 함(blocked) + onBlocked 결과', async () => {
    const ran: number[] = [];
    const out = await runVerifiedStep([1, 2], reject, async (p) => { ran.push(p); return `r${p}`; }, {
      mode: 'enforce',
      onBlocked: (p) => `blocked${p}`,
    });
    expect(ran).toEqual([]);                 // 아무것도 실행 안 됨
    expect(out.every((o) => o.blocked === true)).toBe(true);
    expect(out.map((o) => o.result)).toEqual(['blocked1', 'blocked2']);
  });

  test('enforce: 승인 제안은 실행됨', async () => {
    const ran: number[] = [];
    const out = await runVerifiedStep([1, 2], approve, async (p) => { ran.push(p); return `r${p}`; }, { mode: 'enforce' });
    expect(ran).toEqual([1, 2]);
    expect(out.every((o) => o.blocked === false)).toBe(true);
  });

  test('순서 보존', async () => {
    const out = await runVerifiedStep(['a', 'b', 'c'], approve, async (p) => p.toUpperCase(), { mode: 'advisory' });
    expect(out.map((o) => o.proposal)).toEqual(['a', 'b', 'c']);
    expect(out.map((o) => o.result)).toEqual(['A', 'B', 'C']);
  });
});

describe('applyHardCap — stop/budget 하드캡(Phase C)', () => {
  test('상한 미지정 → 전량 통과', () => {
    const r = applyHardCap([1, 2, 3]);
    expect(r.capped).toBe(false);
    expect(r.items).toEqual([1, 2, 3]);
    expect(r.dropped).toBe(0);
  });
  test('상한 이내 → 전량 통과', () => {
    const r = applyHardCap([1, 2], { maxItems: 5 });
    expect(r.capped).toBe(false);
    expect(r.dropped).toBe(0);
  });
  test('상한 초과 → 잘라내고 capped + dropped 기록', () => {
    const r = applyHardCap([1, 2, 3, 4, 5], { maxItems: 2 });
    expect(r.capped).toBe(true);
    expect(r.items).toEqual([1, 2]);          // 앞 N개만
    expect(r.dropped).toBe(3);
    expect(r.reason).toContain('하드캡 2건');
  });
  test('상한 = 길이 → 경계(capped false)', () => {
    expect(applyHardCap([1, 2, 3], { maxItems: 3 }).capped).toBe(false);
  });
});

describe('budgetExhausted — 시간 데드라인(Phase C)', () => {
  test('데드라인 미지정 → 소진 아님', () => {
    expect(budgetExhausted(undefined, 999)).toBe(false);
    expect(budgetExhausted({ maxItems: 5 }, 999)).toBe(false);
  });
  test('now < deadline → 소진 아님', () => {
    expect(budgetExhausted({ deadlineMs: 1000 }, 500)).toBe(false);
  });
  test('now >= deadline → 소진', () => {
    expect(budgetExhausted({ deadlineMs: 1000 }, 1000)).toBe(true);
    expect(budgetExhausted({ deadlineMs: 1000 }, 1500)).toBe(true);
  });
});
