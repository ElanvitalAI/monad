import { describe, it, expect } from 'bun:test';
import {
  mintArcId,
  resolveArcs,
  isFlatMission,
  arcForPhase,
  formatArcContextForPhase,
  formatArcHandoffForPhase,
  nextRunnableArcs,
  hasArcCycle,
  allArcsDone,
  isArcResolved,
  mergeTrivialArcChains,
  mintUniqueArcId,
  insertArc,
  reorderArc,
  upsertRelationLink,
  removeRelationLink,
  resolveArcExternal,
} from './mission-arc.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (over: Partial<MissionArc> & { arcId: string }): MissionArc => ({
  name: over.name ?? 'arc', intent: 'x', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

describe('C3 — formatArcContextForPhase(아크 통합 의도 RUN 전파·2026-07-19)', () => {
  it('아크 intent + 통합 acceptance 를 블록으로', () => {
    const arcs = [arc({ arcId: 'a', name: '관측 계약', intent: '프레임 저널 계약 확립', phaseIds: ['task:p1'], acceptance: ['계약 배선됨', 'dead-code 0'] })];
    const block = formatArcContextForPhase(arcs, 'task:p1');
    expect(block).toContain("아크 '관측 계약'");
    expect(block).toContain('아크 통합 의도: 프레임 저널 계약 확립');
    expect(block).toContain('계약 배선됨 · dead-code 0');
  });
  it('acceptance 없으면 acceptance 줄 생략', () => {
    const arcs = [arc({ arcId: 'a', name: 'A', intent: 'i', phaseIds: ['task:p1'], acceptance: [] })];
    const block = formatArcContextForPhase(arcs, 'task:p1');
    expect(block).toContain('아크 통합 의도: i');
    expect(block).not.toContain('아크 통합 acceptance');
  });
  it('flat(아크 없음/빈배열) 미션은 무주입', () => {
    expect(formatArcContextForPhase(undefined, 'task:p1')).toBe('');
    expect(formatArcContextForPhase([], 'task:p1')).toBe('');
  });
  it('페이즈가 어느 아크에도 없으면 무주입', () => {
    const arcs = [arc({ arcId: 'a', phaseIds: ['task:p1'] })];
    expect(formatArcContextForPhase(arcs, 'task:zzz')).toBe('');
  });
});

describe('C2 — formatArcHandoffForPhase(아크 경계 핸드오프·2026-07-19)', () => {
  const prev = arc({ arcId: 'a', name: '관측', intent: '계약 확립', phaseIds: ['task:p1'], status: 'done', verifyResult: { ok: true, evidence: '프레임 저널 6파일 계약 배선' } });
  const next = arc({ arcId: 'b', name: '집행', intent: '수복 배선', phaseIds: ['task:p2', 'task:p3'], dependsOnArcs: ['a'] });
  it('새 아크 첫 페이즈에 선행 아크 완주 요약(verifyResult.evidence) 핸드오프', () => {
    const block = formatArcHandoffForPhase([prev, next], 'task:p2');
    expect(block).toContain("새 아크 '집행'의 시작");
    expect(block).toContain("'관측' (의도: 계약 확립)");
    expect(block).toContain('프레임 저널 6파일 계약 배선');
    expect(block).toContain('재구현하지 말 것');
  });
  it('verifyResult 없으면 status 로 폴백', () => {
    const p2 = arc({ arcId: 'a', name: 'A', intent: 'i', phaseIds: ['task:p1'], status: 'descoped' });
    const block = formatArcHandoffForPhase([p2, next], 'task:p2');
    expect(block).toContain('상태: descoped');
  });
  it('아크 첫 페이즈가 아니면 무주입(중간 페이즈)', () => {
    expect(formatArcHandoffForPhase([prev, next], 'task:p3')).toBe('');
  });
  it('선행 아크 없으면 무주입', () => {
    const solo = arc({ arcId: 'x', name: 'X', phaseIds: ['task:z1'] });
    expect(formatArcHandoffForPhase([solo], 'task:z1')).toBe('');
  });
  it('flat 미션 무주입', () => {
    expect(formatArcHandoffForPhase(undefined, 'task:p2')).toBe('');
    expect(formatArcHandoffForPhase([], 'task:p2')).toBe('');
  });
});

describe('descoped 상태 — 완주 non-blocking(2026-07-15)', () => {
  it('isArcResolved: done·descoped 만 해소', () => {
    expect(isArcResolved('done')).toBe(true);
    expect(isArcResolved('descoped')).toBe(true);
    expect(isArcResolved('failed')).toBe(false);
    expect(isArcResolved('pending')).toBe(false);
    expect(isArcResolved('verifying')).toBe(false);
  });
  it('allArcsDone: descoped 아크가 있어도 완주(done 과 동등)', () => {
    expect(allArcsDone([
      arc({ arcId: 'a', status: 'done' }),
      arc({ arcId: 'b', status: 'descoped' }),
    ])).toBe(true);
    expect(allArcsDone([arc({ arcId: 'a', status: 'done' }), arc({ arcId: 'b', status: 'failed' })])).toBe(false);
  });
  it('nextRunnableArcs: descoped 선행 아크는 배리어 통과(downstream 언블록)', () => {
    const runnable = nextRunnableArcs([
      arc({ arcId: 'a', status: 'descoped' }),
      arc({ arcId: 'b', status: 'pending', dependsOnArcs: ['a'] }),
    ]);
    expect(runnable.map((a) => a.arcId)).toEqual(['b']); // a(descoped) 는 재실행 안 함·b 는 언블록
  });
});

describe('mergeTrivialArcChains — 과분할 가드(A7-L1)', () => {
  it('단편화 1-페이즈 사슬 흡수 — [a(1)→b(1)] 는 a 로 병합', () => {
    const r = mergeTrivialArcChains([
      arc({ arcId: 'a', name: 'A', phaseIds: ['task:p1'], acceptance: ['A됨'] }),
      arc({ arcId: 'b', name: 'B', phaseIds: ['task:p2'], dependsOnArcs: ['a'], acceptance: ['B됨'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.phaseIds).toEqual(['task:p1', 'task:p2']);
    expect(r[0]!.acceptance).toEqual(['A됨', 'B됨']); // acceptance 보존(병합)
  });

  it('정당한 소deliverable 보존 — [관측(2ph)→집행(1ph)] 는 병합 안 함', () => {
    const r = mergeTrivialArcChains([
      arc({ arcId: 'a', name: '관측', phaseIds: ['task:p1', 'task:p2'] }),
      arc({ arcId: 'b', name: '집행', phaseIds: ['task:p3'], dependsOnArcs: ['a'] }),
    ]);
    expect(r).toHaveLength(2); // a 가 2-페이즈 → 흡수 안 함
  });

  it('의존 재배선 — [a(1)→b(1)→c(2)] 병합 후 c 는 a 를 의존', () => {
    const r = mergeTrivialArcChains([
      arc({ arcId: 'a', name: 'A', phaseIds: ['task:p1'] }),
      arc({ arcId: 'b', name: 'B', phaseIds: ['task:p2'], dependsOnArcs: ['a'] }),
      arc({ arcId: 'c', name: 'C', phaseIds: ['task:p3', 'task:p4'], dependsOnArcs: ['b'] }),
    ]);
    expect(r).toHaveLength(2);
    const c = r.find((x) => x.arcId === 'c')!;
    expect(c.dependsOnArcs).toEqual(['a']); // b 흡수됨 → c 는 a 로 재배선
    expect(r.find((x) => x.arcId === 'a')!.phaseIds).toEqual(['task:p1', 'task:p2']);
  });

  it('병합 대상 없으면 원형 유지(2+페이즈 아크들)', () => {
    const arcs = [
      arc({ arcId: 'a', phaseIds: ['task:p1', 'task:p2'] }),
      arc({ arcId: 'b', phaseIds: ['task:p3', 'task:p4'], dependsOnArcs: ['a'] }),
    ];
    expect(mergeTrivialArcChains(arcs)).toHaveLength(2);
  });
});

describe('mintArcId', () => {
  it('name+idx → arc_<slug>_<idx>', () => {
    expect(mintArcId('관측 계약', 0)).toBe('arc_관측-계약_0');
    expect(mintArcId('Gating & Judge', 1)).toBe('arc_gating-judge_1');
  });
  it('빈 name 폴백', () => {
    expect(mintArcId('!!!', 2)).toBe('arc_arc_2');
  });
});

describe('resolveArcs — flat 하위호환', () => {
  it('명시 아크 없으면 전 페이즈 담은 암묵적 단일 아크', () => {
    const r = resolveArcs(undefined, ['t1', 't2', 't3']);
    expect(r).toHaveLength(1);
    expect(r[0]!.arcId).toBe('arc_default_0');
    expect(r[0]!.phaseIds).toEqual(['t1', 't2', 't3']);
    expect(r[0]!.acceptance).toEqual([]); // flat=페이즈 로컬만
  });
  it('빈 배열도 flat 취급', () => {
    expect(resolveArcs([], ['t1'])).toHaveLength(1);
  });
  it('명시 아크 있으면 그대로(복사)', () => {
    const arcs = [arc({ arcId: 'a1', phaseIds: ['t1'] }), arc({ arcId: 'a2', phaseIds: ['t2'] })];
    const r = resolveArcs(arcs, ['t1', 't2']);
    expect(r).toHaveLength(2);
    expect(r[0]).not.toBe(arcs[0]); // 복사(불변)
  });
});

describe('isFlatMission', () => {
  it('undefined/빈 = flat', () => {
    expect(isFlatMission(undefined)).toBe(true);
    expect(isFlatMission([])).toBe(true);
  });
  it('아크 있으면 not flat', () => {
    expect(isFlatMission([arc({ arcId: 'a1' })])).toBe(false);
  });
});

describe('arcForPhase', () => {
  const arcs = [arc({ arcId: 'a1', phaseIds: ['t1', 't2'] }), arc({ arcId: 'a2', phaseIds: ['t3'] })];
  it('페이즈가 속한 아크', () => {
    expect(arcForPhase(arcs, 't2')!.arcId).toBe('a1');
    expect(arcForPhase(arcs, 't3')!.arcId).toBe('a2');
  });
  it('없으면 null', () => {
    expect(arcForPhase(arcs, 'tX')).toBeNull();
  });
});

describe('nextRunnableArcs — 순차 배리어', () => {
  it('선행 없는 아크는 즉시 runnable', () => {
    const arcs = [arc({ arcId: 'a1' }), arc({ arcId: 'a2', dependsOnArcs: ['a1'] })];
    const r = nextRunnableArcs(arcs);
    expect(r.map((a) => a.arcId)).toEqual(['a1']); // a2 는 a1 미완이라 대기
  });
  it('선행 done 이면 다음 아크 runnable', () => {
    const arcs = [arc({ arcId: 'a1', status: 'done' }), arc({ arcId: 'a2', dependsOnArcs: ['a1'] })];
    expect(nextRunnableArcs(arcs).map((a) => a.arcId)).toEqual(['a2']);
  });
  it('done/failed 아크는 제외', () => {
    const arcs = [arc({ arcId: 'a1', status: 'done' }), arc({ arcId: 'a2', status: 'failed' })];
    expect(nextRunnableArcs(arcs)).toHaveLength(0);
  });
});

describe('hasArcCycle', () => {
  it('사이클 없으면 false', () => {
    expect(hasArcCycle([arc({ arcId: 'a1' }), arc({ arcId: 'a2', dependsOnArcs: ['a1'] })])).toBe(false);
  });
  it('사이클 있으면 true', () => {
    expect(hasArcCycle([
      arc({ arcId: 'a1', dependsOnArcs: ['a2'] }),
      arc({ arcId: 'a2', dependsOnArcs: ['a1'] }),
    ])).toBe(true);
  });
});

describe('allArcsDone', () => {
  it('전부 done 이면 true', () => {
    expect(allArcsDone([arc({ arcId: 'a1', status: 'done' }), arc({ arcId: 'a2', status: 'done' })])).toBe(true);
  });
  it('하나라도 미완이면 false', () => {
    expect(allArcsDone([arc({ arcId: 'a1', status: 'done' }), arc({ arcId: 'a2', status: 'active' })])).toBe(false);
  });
  it('빈 배열 false', () => {
    expect(allArcsDone([])).toBe(false);
  });
});

describe('연관 미션 링크 — upsert/remove', () => {
  it('추가', () => {
    const r = upsertRelationLink(undefined, { id: 'm2', relation: 'friend' });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('m2');
  });
  it('같은 id+relation 은 병합(중복 방지·note 갱신)', () => {
    const r = upsertRelationLink([{ id: 'm2', relation: 'friend', note: 'old' }], { id: 'm2', relation: 'friend', note: 'new' });
    expect(r).toHaveLength(1);
    expect(r[0]!.note).toBe('new');
  });
  it('같은 id 다른 relation 은 별개', () => {
    const r = upsertRelationLink([{ id: 'm2', relation: 'friend' }], { id: 'm2', relation: 'associate' });
    expect(r).toHaveLength(2);
  });
  it('remove: relation 지정 없으면 id 전체 제거', () => {
    const links = [{ id: 'm2', relation: 'friend' as const }, { id: 'm2', relation: 'associate' as const }, { id: 'm3', relation: 'friend' as const }];
    expect(removeRelationLink(links, 'm2')).toHaveLength(1);
    expect(removeRelationLink(links, 'm2', 'friend')).toHaveLength(2);
  });
});

describe('아크 구조 편집 — insertArc / reorderArc / mintUniqueArcId (E2·E3)', () => {
  it('mintUniqueArcId — 최대 suffix+1 로 충돌 방지', () => {
    const arcs = [arc({ arcId: 'arc_a_0' }), arc({ arcId: 'arc_b_3' })];
    expect(mintUniqueArcId(arcs, 'research lens')).toBe('arc_research-lens_4'); // idx=max(0,3)+1
    expect(mintUniqueArcId([], 'x')).toBe('arc_x_0'); // 빈 배열 → idx 0
  });

  it('insertArc — A 뒤에 B 삽입: 위치 + B.dependsOn=[A]', () => {
    const arcs = [arc({ arcId: 'A' }), arc({ arcId: 'C', dependsOnArcs: ['A'] })];
    const B = arc({ arcId: 'B', name: 'mid' });
    const out = insertArc(arcs, 'A', B);
    expect(out.map((a) => a.arcId)).toEqual(['A', 'B', 'C']); // 위치
    expect(out.find((a) => a.arcId === 'B')!.dependsOnArcs).toEqual(['A']);
  });

  it('insertArc — A 를 의존하던 C 는 B 의존으로 재배선(배리어)', () => {
    const arcs = [arc({ arcId: 'A' }), arc({ arcId: 'C', dependsOnArcs: ['A'] })];
    const out = insertArc(arcs, 'A', arc({ arcId: 'B' }));
    expect(out.find((a) => a.arcId === 'C')!.dependsOnArcs).toEqual(['B']); // A→B 로 재배선
    expect(hasArcCycle(out)).toBe(false);
  });

  it('insertArc — 마지막 아크 뒤 삽입(후속 없음)', () => {
    const arcs = [arc({ arcId: 'A' }), arc({ arcId: 'B', dependsOnArcs: ['A'] })];
    const out = insertArc(arcs, 'B', arc({ arcId: 'C' }));
    expect(out.map((a) => a.arcId)).toEqual(['A', 'B', 'C']);
    expect(out.find((a) => a.arcId === 'C')!.dependsOnArcs).toEqual(['B']);
  });

  it('insertArc — 앵커 미존재면 무변경(회귀 0)', () => {
    const arcs = [arc({ arcId: 'A' })];
    expect(insertArc(arcs, 'ZZZ', arc({ arcId: 'B' })).map((a) => a.arcId)).toEqual(['A']);
  });

  it('reorderArc — 위치 이동(핸들 순번 갱신용)·의존 불변', () => {
    const arcs = [arc({ arcId: 'A' }), arc({ arcId: 'B' }), arc({ arcId: 'C', dependsOnArcs: ['B'] })];
    const out = reorderArc(arcs, 'C', 0);
    expect(out.map((a) => a.arcId)).toEqual(['C', 'A', 'B']);
    expect(out.find((a) => a.arcId === 'C')!.dependsOnArcs).toEqual(['B']); // 의존 불변
  });

  it('reorderArc — newIdx 범위 clamp', () => {
    const arcs = [arc({ arcId: 'A' }), arc({ arcId: 'B' })];
    expect(reorderArc(arcs, 'A', 99).map((a) => a.arcId)).toEqual(['B', 'A']);
  });
});

describe('resolveArcExternal — 외부 아크 수습(L3 아크판·2026-07-16)', () => {
  const arcs: MissionArc[] = [
    arc({ arcId: 'arc_prod_0', name: '생산자 코어', status: 'verifying', verifyResult: { ok: false, evidence: 'x', missing: 'glue 부재' } }),
    arc({ arcId: 'arc_cons_1', name: '소비 배선', status: 'pending', dependsOnArcs: ['arc_prod_0'] }),
  ];
  it('name 매칭으로 아크 done+verified(external 근거) 처리', () => {
    const { arcs: next, resolved } = resolveArcExternal(arcs, '생산자 코어', '[external·PR #4324] 글루 완성');
    expect(resolved?.arcId).toBe('arc_prod_0');
    expect(next[0]!.status).toBe('done');
    expect(next[0]!.verifyResult).toEqual({ ok: true, evidence: '[external·PR #4324] 글루 완성' });
    // 후속 아크는 이제 배리어 통과(선행 done).
    expect(nextRunnableArcs(next).map((a) => a.arcId)).toContain('arc_cons_1');
  });
  it('index·arcId 매칭도 지원', () => {
    expect(resolveArcExternal(arcs, '0', 'ev').resolved?.arcId).toBe('arc_prod_0');
    expect(resolveArcExternal(arcs, 'arc_cons_1', 'ev').resolved?.arcId).toBe('arc_cons_1');
  });
  it('부분일치·매칭 실패 처리', () => {
    expect(resolveArcExternal(arcs, '생산자', 'ev').resolved?.arcId).toBe('arc_prod_0'); // 부분일치
    expect(resolveArcExternal(arcs, '없는아크', 'ev').resolved).toBeNull();
  });
  it('원본 불변(순수) — 반환 배열만 변경', () => {
    resolveArcExternal(arcs, '생산자 코어', 'ev');
    expect(arcs[0]!.status).toBe('verifying'); // 원본 그대로
  });
});
