import { describe, it, expect } from 'bun:test';
import { recallCoevolutionContext } from './mission-coevolve-recall.js';
import { openMissionEdgesDb, addMissionEdge } from './mission-edges.js';
import type { WorkingMemoryEntry } from './mission-working-memory.js';
import type { Database } from 'bun:sqlite';

const freshDb = (): Database => openMissionEdgesDb(':memory:');

function wm(_id: string, entries: Partial<WorkingMemoryEntry>[]): WorkingMemoryEntry[] {
  return entries.map((e, i) => ({
    phaseId: `p${i}`, phaseTitle: 't', kind: 'implementation', at: '', summary: 's',
    reusables: [], decisions: [], artifacts: [], ...e,
  })) as WorkingMemoryEntry[];
}

describe('recallCoevolutionContext (E5-b 미션 간 공진화 회상)', () => {
  it('연관 미션의 deviation 을 회상 블록으로', () => {
    const db = freshDb();
    addMissionEdge('M', 'A', 'association', '', { db, now: 1 });
    addMissionEdge('B', 'M', 'lineage', '', { db, now: 2 }); // 역방향도 잡힘(both)
    const readWM = (id: string): WorkingMemoryEntry[] => {
      if (id === 'A') return wm('A', [{ deviation: { kind: 'scope_reduction', note: 'API 2개만' } }]);
      if (id === 'B') return wm('B', [{ deviation: { kind: 'env_improved', note: '선행 설정 추가' } }]);
      return [];
    };
    const ctx = recallCoevolutionContext('M', { edgeDb: db, readWM });
    expect(ctx).toContain('연관 미션 학습');
    expect(ctx).toContain('scope_reduction(API 2개만)');
    expect(ctx).toContain('env_improved(선행 설정 추가)');
  });

  it('연관 미션 없으면 ""', () => {
    const db = freshDb();
    expect(recallCoevolutionContext('M', { edgeDb: db, readWM: () => [] })).toBe('');
  });

  it('연관은 있으나 deviation 없으면 ""(무영향)', () => {
    const db = freshDb();
    addMissionEdge('M', 'A', 'association', '', { db, now: 1 });
    expect(recallCoevolutionContext('M', { edgeDb: db, readWM: () => wm('A', [{ summary: '이탈 없음' }]) })).toBe('');
  });

  it('self 제외·중복 제거·maxMissions 상한', () => {
    const db = freshDb();
    addMissionEdge('M', 'M', 'association', '', { db, now: 1 }); // self → 애초에 저장 안 됨
    addMissionEdge('M', 'A', 'association', '', { db, now: 2 });
    addMissionEdge('A', 'M', 'lineage', '', { db, now: 3 }); // A 중복(다른 kind)
    const readWM = (id: string): WorkingMemoryEntry[] => wm(id, [{ deviation: { kind: 'other', note: `dev-${id}` } }]);
    const ctx = recallCoevolutionContext('M', { edgeDb: db, readWM, maxMissions: 5 });
    // A 한 번만(중복 제거)·M(self) 없음
    expect((ctx.match(/dev-A/g) ?? []).length).toBe(1);
    expect(ctx).not.toContain('dev-M');
  });

  it('회고 각인(mission.retro/feedback) 회상 — surfaceDb 주입 (#4564 얼라인)', () => {
    const db = freshDb();
    addMissionEdge('M', 'A', 'association', '', { db, now: 1 });
    const rows: Record<string, Array<{ refs: string; summary: string; text: string }>> = {
      'mission.retro': [{ refs: JSON.stringify({ missionId: 'A' }), summary: 'A 회고: partial(아크 2/3)', text: '' }],
      'mission.feedback': [{ refs: JSON.stringify({ missionId: 'A' }), summary: 'A 피드백: 범위 모호', text: '' }],
    };
    const queryEvents = ((_db: unknown, opts: { category?: string }) => rows[opts.category ?? ''] ?? []) as never;
    const ctx = recallCoevolutionContext('M', { edgeDb: db, readWM: () => [], surfaceDb: {} as never, queryEvents });
    expect(ctx).toContain('회고: A 회고');
    expect(ctx).toContain('피드백: A 피드백');
  });

  it('회고 각인 — 연관 아닌 미션 refs 는 제외', () => {
    const db = freshDb();
    addMissionEdge('M', 'A', 'association', '', { db, now: 1 });
    const queryEvents = ((_db: unknown, opts: { category?: string }) =>
      (opts.category === 'mission.retro' ? [{ refs: JSON.stringify({ missionId: 'Z' }), summary: 'Z 회고', text: '' }] : [])) as never;
    const ctx = recallCoevolutionContext('M', { edgeDb: db, readWM: () => [], surfaceDb: {} as never, queryEvents });
    expect(ctx).toBe(''); // Z 는 연관 아님 → 제외 → 빈
  });

  it('deviation + 회고 각인 통합', () => {
    const db = freshDb();
    addMissionEdge('M', 'A', 'association', '', { db, now: 1 });
    const readWM = (id: string): WorkingMemoryEntry[] => (id === 'A' ? wm('A', [{ deviation: { kind: 'scope_reduction', note: '축소' } }]) : []);
    const queryEvents = ((_db: unknown, opts: { category?: string }) =>
      (opts.category === 'mission.feedback' ? [{ refs: JSON.stringify({ missionId: 'A' }), summary: '피드백내용', text: '' }] : [])) as never;
    const ctx = recallCoevolutionContext('M', { edgeDb: db, readWM, surfaceDb: {} as never, queryEvents });
    expect(ctx).toContain('이탈: scope_reduction');
    expect(ctx).toContain('피드백: 피드백내용');
  });
});
