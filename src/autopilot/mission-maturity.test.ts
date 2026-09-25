import { describe, it, expect } from 'bun:test';
import { openAutopilotMissionsDb, createMission, getChildMissionIds } from './mission-registry.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import {
  detectMaturityOverScope, buildMaturityProposal, formatMaturityProposal, applyMaturitySplit,
} from './mission-maturity.js';

const AT = new Date('2026-07-14T00:00:00Z');

function arc(id: string, deps: string[], phases: number, over?: boolean): MissionArc {
  return {
    arcId: id, name: `아크 ${id}`, intent: `${id} 서브골`,
    phaseIds: Array.from({ length: phases }, (_, i) => `${id}-p${i}`),
    dependsOnArcs: deps, acceptance: [], status: 'pending',
    ...(over ? { preflightVerdict: { verdict: 'over_scope' as const, reason: 'r', action: 'descope' as const } } : {}),
  };
}

describe('A6-b detectMaturityOverScope', () => {
  it('heavy + 아크 3개 이상 = 과대', () => {
    const d = detectMaturityOverScope([arc('a', [], 2), arc('b', ['a'], 2), arc('c', ['b'], 2)], 'heavy');
    expect(d.oversized).toBe(true);
    expect(d.estArcs).toBe(3);
    expect(d.estPhases).toBe(6);
  });

  it('아크 2개 heavy = 과대 아님(보수적)', () => {
    expect(detectMaturityOverScope([arc('a', [], 2), arc('b', ['a'], 2)], 'heavy').oversized).toBe(false);
  });

  it('over_scope preflight 아크 + 아크≥2 = 과대', () => {
    expect(detectMaturityOverScope([arc('a', [], 2), arc('b', ['a'], 2, true)], 'heavy').oversized).toBe(true);
  });

  it('light 는 아크 많아도 과대 아님', () => {
    expect(detectMaturityOverScope([arc('a', [], 1), arc('b', ['a'], 1), arc('c', ['b'], 1)], 'light').oversized).toBe(false);
  });

  it('아크 없음 = 과대 아님', () => {
    expect(detectMaturityOverScope(undefined, 'heavy').oversized).toBe(false);
  });
});

describe('A6-b buildMaturityProposal', () => {
  it('root 아크=핵심, 종속 아크=후속', () => {
    const p = buildMaturityProposal([arc('a', [], 2), arc('b', ['a'], 2), arc('c', ['b'], 2)], 'heavy');
    expect(p.core.arcIds).toEqual(['a']);
    expect(p.followups.map((f) => f.arcIds[0])).toEqual(['b', 'c']);
  });

  it('formatMaturityProposal 은 과대 아니면 빈 문자열', () => {
    const p = buildMaturityProposal([arc('a', [], 2)], 'heavy');
    expect(formatMaturityProposal(p)).toBe('');
  });
});

describe('A6-b applyMaturitySplit (비파괴·proposed 후속)', () => {
  function oversizedMission() {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: '과대 골', source: 'manual', now: AT, slug: 'big-goal', triage: { tier: 'heavy' } });
    const raw = db.getMission(m.id)!;
    db.saveMission({
      ...raw,
      autopilot: { ...(raw.autopilot ?? { origin: 'manual' }), tier: 'heavy', arcModel: 'multi',
        arcs: [arc('a', [], 2), arc('b', ['a'], 2), arc('c', ['b'], 2)] },
    });
    return { db, id: m.id };
  }

  it('후속 아크를 proposed 후속 미션으로 생성하고 parent-child 연결', () => {
    const { db, id } = oversizedMission();
    const r = applyMaturitySplit(db, id, AT);
    expect(r.ok).toBe(true);
    expect(r.created.length).toBe(2);
    // 후속은 proposed·부모 종속
    for (const cid of r.created) {
      expect(db.getMission(cid)?.autopilot?.apmStatus).toBe('proposed');
      expect(db.getMission(cid)?.autopilot?.parentMissionId).toBe(id);
    }
    expect(getChildMissionIds(db, id).sort()).toEqual([...r.created].sort());
  });

  it('비파괴 — M1 아크는 불변', () => {
    const { db, id } = oversizedMission();
    applyMaturitySplit(db, id, AT);
    expect(db.getMission(id)?.autopilot?.arcs?.length).toBe(3);
  });

  it('과대 아니면 no-op', () => {
    const db = openAutopilotMissionsDb(':memory:');
    const m = createMission(db, { goal: '작은 골', source: 'manual', now: AT, slug: 'small', triage: { tier: 'light' } });
    const raw = db.getMission(m.id)!;
    db.saveMission({ ...raw, autopilot: { ...(raw.autopilot ?? { origin: 'manual' }), tier: 'light', arcs: [arc('a', [], 1)] } });
    const r = applyMaturitySplit(db, m.id, AT);
    expect(r.ok).toBe(false);
    expect(r.created).toEqual([]);
  });
});
