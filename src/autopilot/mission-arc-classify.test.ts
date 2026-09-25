import { describe, it, expect } from 'bun:test';
import { deriveArcsFromGrouping, classifyArcs, type ArcClassifyPhase } from './mission-arc-classify.js';

const P = (n: number): ArcClassifyPhase[] => Array.from({ length: n }, (_, i) => ({ id: `task:p${i + 1}`, title: `페이즈 ${i + 1}` }));

describe('deriveArcsFromGrouping — 순수 변환 + 검증', () => {
  it('정상 2아크 partition → MissionArc[]', () => {
    const arcs = deriveArcsFromGrouping(P(3), [
      { name: '관측', intent: 'a', phases: [1, 2], dependsOn: [], acceptance: ['통합됨'] },
      { name: '집행', intent: 'b', phases: [3], dependsOn: [1], acceptance: ['집행됨'] },
    ]);
    expect(arcs).not.toBeNull();
    expect(arcs).toHaveLength(2);
    expect(arcs![0]!.phaseIds).toEqual(['task:p1', 'task:p2']);
    expect(arcs![1]!.dependsOnArcs).toEqual([arcs![0]!.arcId]);
  });

  it('그룹 1개(단일 응집) → null(=single)', () => {
    expect(deriveArcsFromGrouping(P(3), [{ name: 'x', intent: 'a', phases: [1, 2, 3], dependsOn: [], acceptance: [] }])).toBeNull();
  });

  it('페이즈 중복 배정(partition 위반) → null', () => {
    expect(deriveArcsFromGrouping(P(3), [
      { name: 'a', intent: '', phases: [1, 2], dependsOn: [], acceptance: [] },
      { name: 'b', intent: '', phases: [2, 3], dependsOn: [], acceptance: [] },
    ])).toBeNull();
  });

  it('페이즈 누락(전 페이즈 커버 안 됨) → null', () => {
    expect(deriveArcsFromGrouping(P(3), [
      { name: 'a', intent: '', phases: [1], dependsOn: [], acceptance: [] },
      { name: 'b', intent: '', phases: [2], dependsOn: [], acceptance: [] },
    ])).toBeNull();
  });

  it('잘못된 페이즈 번호 → null', () => {
    expect(deriveArcsFromGrouping(P(2), [
      { name: 'a', intent: '', phases: [1], dependsOn: [], acceptance: [] },
      { name: 'b', intent: '', phases: [9], dependsOn: [], acceptance: [] },
    ])).toBeNull();
  });

  it('아크 순환 의존 → null', () => {
    expect(deriveArcsFromGrouping(P(2), [
      { name: 'a', intent: '', phases: [1], dependsOn: [2], acceptance: [] },
      { name: 'b', intent: '', phases: [2], dependsOn: [1], acceptance: [] },
    ])).toBeNull();
  });

  it('아크 7개 초과(과계층화) → null', () => {
    const groups = Array.from({ length: 7 }, (_, i) => ({ name: `a${i}`, intent: '', phases: [i + 1], dependsOn: [], acceptance: [] }));
    expect(deriveArcsFromGrouping(P(7), groups)).toBeNull();
  });
});

describe('classifyArcs — 보수적 게이트', () => {
  it('페이즈 <5 면 무조건 single(휴리스틱·LLM 호출 안 함)', async () => {
    let called = false;
    const r = await classifyArcs({ goal: 'g', phases: P(4) }, { classify: async () => { called = true; return ''; } });
    expect(r.arcModel).toBe('single');
    expect(r.arcs).toEqual([]);
    expect(called).toBe(false);
  });

  it('classify 미주입(test)이면 single', async () => {
    const r = await classifyArcs({ goal: 'g', phases: P(6) });
    expect(r.arcModel).toBe('single');
  });

  it('LLM 이 유효 멀티 그룹핑 → multi', async () => {
    const classify = async () => JSON.stringify({ arcs: [
      { name: '관측 계약', intent: '관측', phases: [1, 2, 3], dependsOn: [], acceptance: ['observe 배선'] },
      { name: '집행', intent: '집행', phases: [4, 5], dependsOn: [1], acceptance: ['집행됨'] },
    ] });
    const r = await classifyArcs({ goal: 'g', phases: P(5) }, { classify });
    expect(r.arcModel).toBe('multi');
    expect(r.arcs).toHaveLength(2);
    expect(r.arcs[0]!.name).toBe('관측 계약');
  });

  it('LLM 이 그룹 1개(단일 응집) → single', async () => {
    const classify = async () => JSON.stringify({ arcs: [{ name: 'x', intent: '', phases: [1, 2, 3, 4, 5], dependsOn: [], acceptance: [] }] });
    const r = await classifyArcs({ goal: 'g', phases: P(5) }, { classify });
    expect(r.arcModel).toBe('single');
  });

  it('파싱 실패 → single 폴백', async () => {
    const r = await classifyArcs({ goal: 'g', phases: P(6) }, { classify: async () => '잡음(JSON 아님)' });
    expect(r.arcModel).toBe('single');
  });

  it('LLM 예외 → single 폴백(fail-soft)', async () => {
    const r = await classifyArcs({ goal: 'g', phases: P(6) }, { classify: async () => { throw new Error('boom'); } });
    expect(r.arcModel).toBe('single');
  });

  it('커버리지 위반 그룹핑 → single 폴백', async () => {
    const classify = async () => JSON.stringify({ arcs: [
      { name: 'a', intent: '', phases: [1], dependsOn: [], acceptance: [] },
      { name: 'b', intent: '', phases: [2], dependsOn: [], acceptance: [] },
    ] }); // 6페이즈인데 2개만 커버
    const r = await classifyArcs({ goal: 'g', phases: P(6) }, { classify });
    expect(r.arcModel).toBe('single');
  });
});

describe('classifyArcs — arcHint 결정론 폴백(#4498 3A · "arcHint=5인데 arcs=0" 수복)', () => {
  it('LLM 미주입(test) + arcHint=5·22페이즈 → 5아크 결정론 파생·전 페이즈 커버·linear chain', async () => {
    const r = await classifyArcs({ goal: 'g', phases: P(22), arcHint: 5 });
    expect(r.arcModel).toBe('multi');
    expect(r.arcs.length).toBe(5);
    expect(r.arcs.flatMap((a) => a.phaseIds).length).toBe(22);            // 전 페이즈 커버
    expect(new Set(r.arcs.flatMap((a) => a.phaseIds)).size).toBe(22);    // 중복 없음(partition)
    expect(r.arcs[0]!.dependsOnArcs).toEqual([]);                        // 첫 아크=선행 없음
    expect(r.arcs[1]!.dependsOnArcs).toEqual([r.arcs[0]!.arcId]);        // 순차 배리어
  });

  it('arcHint 없으면 기존대로 single(폴백 안 함·회귀 0)', async () => {
    expect((await classifyArcs({ goal: 'g', phases: P(22) })).arcModel).toBe('single');
  });

  it('arcHint<2 는 파생 안 함(single)', async () => {
    expect((await classifyArcs({ goal: 'g', phases: P(22), arcHint: 1 })).arcModel).toBe('single');
  });

  it('LLM 그룹핑 검증 실패해도 arcHint 있으면 결정론 파생', async () => {
    const classify = async () => JSON.stringify({ arcs: [{ name: 'x', phases: [1], dependsOn: [], acceptance: [] }] }); // 커버리지 위반→null
    const r = await classifyArcs({ goal: 'g', phases: P(10), arcHint: 3 }, { classify });
    expect(r.arcModel).toBe('multi');
    expect(r.arcs.length).toBe(3);
  });

  it('LLM multi 성공 시 그게 우선(파생은 폴백일 뿐)', async () => {
    const classify = async () => JSON.stringify({ arcs: [
      { name: 'LLM관측', intent: 'a', phases: [1, 2, 3], dependsOn: [], acceptance: ['x'] },
      { name: 'LLM집행', intent: 'b', phases: [4, 5, 6], dependsOn: [1], acceptance: ['y'] },
    ] });
    const r = await classifyArcs({ goal: 'g', phases: P(6), arcHint: 4 }, { classify });
    expect(r.arcModel).toBe('multi');
    expect(r.arcs.map((a) => a.name)).toEqual(['LLM관측', 'LLM집행']);   // LLM 결과(2아크)·arcHint(4) 아님
    expect(r.hintDeviation).toEqual({ requested: 4, actual: 2 });        // ★ 이탈 표면화(soft·대표 2026-07-20)
  });

  it('arcHint 를 LLM 프롬프트에 주입(대표 선호 표면화·soft·종전 미전달 버그)', async () => {
    let prompt = '';
    const classify = async (p: string) => { prompt = p; return JSON.stringify({ arcs: [
      { name: 'A', intent: 'a', phases: [1, 2, 3], dependsOn: [], acceptance: ['x'] },
      { name: 'B', intent: 'b', phases: [4, 5, 6], dependsOn: [1], acceptance: ['y'] },
    ] }); };
    await classifyArcs({ goal: 'g', phases: P(6), arcHint: 2 }, { classify });
    expect(prompt).toContain('대표 선호'); // 종전엔 arcHint 가 프롬프트에 없어 LLM 이 선호를 몰랐다
    expect(prompt).toContain('2');
  });

  it('arcHint 일치(지정=실제) → hintDeviation 없음', async () => {
    const classify = async () => JSON.stringify({ arcs: [
      { name: 'A', intent: 'a', phases: [1, 2, 3], dependsOn: [], acceptance: ['x'] },
      { name: 'B', intent: 'b', phases: [4, 5, 6], dependsOn: [1], acceptance: ['y'] },
    ] });
    const r = await classifyArcs({ goal: 'g', phases: P(6), arcHint: 2 }, { classify });
    expect(r.hintDeviation).toBeUndefined();
  });
});
