import { describe, it, expect } from 'bun:test';
import {
  countCritical, criticalKeys, evalCoevolveRound, runCoevolveLoop,
} from './mission-coevolve-loop.js';
import type { DecompCritiqueResult, PhaseCritique, PhaseCritiqueVerdict } from './mission-decomp-critique.js';

// ── 목 헬퍼 — 치명 키는 verdict+reason 기반이라 reason 을 구분되게 준다 ─────────────────
function mkCrit(specs: Array<{ verdict?: PhaseCritiqueVerdict; reason: string; severity?: 'critical' | 'minor' }>): DecompCritiqueResult {
  const critiques: PhaseCritique[] = specs.map((s, i) => ({
    phaseId: `p${i}`, phaseTitle: `페이즈${i}`, verdict: s.verdict ?? 'under_specified',
    severity: s.severity ?? 'critical', concerns: [], reason: s.reason, suggestion: '',
  }));
  return { critiques, hasCritical: critiques.some((c) => c.severity === 'critical') };
}
const KS = (...ks: string[]) => new Set(ks);
type P = { id: string };

describe('countCritical / criticalKeys', () => {
  it('countCritical — null·minor 제외·치명 개수', () => {
    expect(countCritical(null)).toBe(0);
    expect(countCritical(mkCrit([{ reason: 'a', severity: 'minor' }]))).toBe(0);
    expect(countCritical(mkCrit([{ reason: 'a' }, { reason: 'b' }]))).toBe(2);
  });
  it('criticalKeys — 치명만·verdict+reason 키', () => {
    const c = mkCrit([{ verdict: 'ungrounded', reason: 'analysis-matrix 전무' }, { reason: 'x', severity: 'minor' }]);
    const keys = criticalKeys(c);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain('ungrounded');
  });
  it('criticalKeys — reason 다르면 다른 키(교체 감지)', () => {
    const a = criticalKeys(mkCrit([{ verdict: 'under_specified', reason: '핵심주장 추출규칙 없음' }]));
    const b = criticalKeys(mkCrit([{ verdict: 'ungrounded', reason: 'analysis-matrix 미충족' }]));
    expect([...a][0]).not.toBe([...b][0]);
  });
});

describe('evalCoevolveRound (집합 diff 기반·단조성 코어)', () => {
  it('치명 0 → converged', () => {
    const r = evalCoevolveRound(KS('a'), KS(), KS('a'), 1, 3);
    expect(r.action).toBe('converged'); expect(r.continue).toBe(false);
  });
  it('K회 소진 → stop-exhausted', () => {
    const r = evalCoevolveRound(KS('a'), KS('b'), KS('a'), 3, 3);
    expect(r.action).toBe('stop-exhausted'); expect(r.continue).toBe(false);
  });
  it('★ 치명 증가(발산) → stop-diverged (maxRounds 前에 우선)', () => {
    const r = evalCoevolveRound(KS('a'), KS('a', 'b'), KS('a'), 1, 3); // prev 1 → next 2 (악화)
    expect(r.action).toBe('stop-diverged'); expect(r.continue).toBe(false);
  });
  it('★ 소진이어도 악화면 diverged 우선', () => {
    const r = evalCoevolveRound(KS('a'), KS('a', 'b'), KS('a'), 3, 3); // round 소진 + 악화
    expect(r.action).toBe('stop-diverged'); // stop-exhausted 아님(발산 먼저)
  });
  it('치명 교체(이전 해소 + 처음 보는 새 치명) → improved(계속) — ★ dogfood 결함 수복', () => {
    const r = evalCoevolveRound(KS('under:x'), KS('ungrounded:y'), KS('under:x'), 1, 3);
    expect(r.action).toBe('improved'); expect(r.continue).toBe(true);
    expect(r).toMatchObject({ resolved: 1, novel: 1, persisted: 0 });
  });
  it('같은 치명 반복(persisted) → stop-stalled', () => {
    const r = evalCoevolveRound(KS('a'), KS('a'), KS('a'), 1, 3);
    expect(r.action).toBe('stop-stalled'); expect(r.persisted).toBe(1);
  });
  it('진동(새 치명이 이미 seen) → stop-stalled', () => {
    // prev={b}, next={a} 인데 a 는 과거에 봤음(seen) → 되돌아옴 = 진동.
    const r = evalCoevolveRound(KS('b'), KS('a'), KS('a', 'b'), 2, 3);
    expect(r.action).toBe('stop-stalled'); expect(r.continue).toBe(false);
  });
  it('일부 해소 + 일부 잔존 → stop-stalled(잔존 있으면 헛돎)', () => {
    const r = evalCoevolveRound(KS('a', 'b'), KS('a', 'c'), KS('a', 'b'), 1, 3);
    expect(r.action).toBe('stop-stalled'); // a 잔존
    expect(r).toMatchObject({ resolved: 1, persisted: 1 });
  });
});

describe('runCoevolveLoop', () => {
  it('초기 치명 0 → 루프 미진입(rounds=0)', async () => {
    let called = false;
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([]), maxRounds: 2,
      redecompose: async () => { called = true; return [{ id: 'p' }]; },
      recritique: async () => mkCrit([]),
    });
    expect(co.rounds).toBe(0); expect(called).toBe(false); expect(co.converged).toBe(true);
  });

  it('★ 발산(2→1→3) → stop-diverged + keep-best(최선 round1 채택·발산 시 last 보고 참조)', async () => {
    const seq = [
      mkCrit([{ reason: 'A' }]),                                   // round1: 2→1 (개선·improved)
      mkCrit([{ reason: 'B' }, { reason: 'C' }, { reason: 'D' }]), // round2: 1→3 (발산)
    ];
    let i = 0;
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ reason: 'X' }, { reason: 'Y' }]), maxRounds: 3,
      redecompose: async () => [{ id: `p${i}` }],
      recritique: async () => seq[i++]!,
    });
    expect(co.history[1]?.action).toBe('stop-diverged');
    expect(co.diverged).toBe(true);
    expect(co.bestCritical).toBe(1);       // 최선 = round1
    expect(co.bestRound).toBe(1);
    expect(co.lastCritical).toBe(3);       // DB reality = round2
    expect(co.converged).toBe(false);
    expect(countCritical(co.finalCritique)).toBe(1);   // keep-best = round1 critique
    expect(countCritical(co.lastCritique)).toBe(3);    // last = DB(round2) critique
  });

  it('수렴 — 1라운드 재분해로 치명 해소', async () => {
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ reason: 'A' }]), maxRounds: 2,
      redecompose: async () => [{ id: 'p1' }],
      recritique: async () => mkCrit([]),
    });
    expect(co.converged).toBe(true); expect(co.rounds).toBe(1);
    expect(co.finalPhases).toEqual([{ id: 'p1' }]);
    expect(co.history[0]?.action).toBe('converged');
  });

  it('★ 치명 교체 — under_specified 해소 후 새 ungrounded → improved 로 계속(dogfood 재현)', async () => {
    const seq = [
      mkCrit([{ verdict: 'ungrounded', reason: 'analysis-matrix 전무' }]), // round1: 교체
      mkCrit([]),                                                          // round2: 수렴
    ];
    let i = 0;
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ verdict: 'under_specified', reason: '핵심주장 추출규칙 없음' }]), maxRounds: 3,
      redecompose: async () => [{ id: 'p' }],
      recritique: async () => seq[i++]!,
    });
    // 개수 기반이면 round1 에서 1->1 정체로 끊겼겠지만, 집합 기반은 교체를 진전으로 봐 계속 → 수렴.
    expect(co.history[0]?.action).toBe('improved');
    expect(co.rounds).toBe(2);
    expect(co.converged).toBe(true);
  });

  it('같은 치명 반복 → 단조성으로 1라운드 중단', async () => {
    let rounds = 0;
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ reason: 'A' }]), maxRounds: 3,
      redecompose: async () => { rounds++; return [{ id: 'p' }]; },
      recritique: async () => mkCrit([{ reason: 'A' }]), // 같은 치명
    });
    expect(co.converged).toBe(false); expect(co.rounds).toBe(1); expect(rounds).toBe(1);
    expect(co.history[0]?.action).toBe('stop-stalled');
  });

  it('진동(A→B→A) → 2라운드째 stalled 차단', async () => {
    const seq = [
      mkCrit([{ reason: 'B' }]), // round1: A→B (교체·improved)
      mkCrit([{ reason: 'A' }]), // round2: B→A (A 는 이미 seen·진동)
    ];
    let i = 0;
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ reason: 'A' }]), maxRounds: 5,
      redecompose: async () => [{ id: 'p' }],
      recritique: async () => seq[i++]!,
    });
    expect(co.history.map((h) => h.action)).toEqual(['improved', 'stop-stalled']);
    expect(co.rounds).toBe(2); expect(co.converged).toBe(false);
  });

  it('재분해 실패(null) → 이전 유지·중단', async () => {
    const co = await runCoevolveLoop<P>({
      missionId: 't', initialCritique: mkCrit([{ reason: 'A' }, { reason: 'B' }]), maxRounds: 2,
      redecompose: async () => null,
      recritique: async () => mkCrit([]),
    });
    expect(co.rounds).toBe(1); expect(co.finalPhases).toBeNull();
    expect(co.converged).toBe(false); expect(countCritical(co.finalCritique)).toBe(2);
    expect(co.history[0]?.action).toBe('redecompose-failed');
  });
});
