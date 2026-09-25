// 회고 에이전트 C1 — 미션 안착 점검(결정론). 골↔아크 정합·검증갭·descoped·dead-arc.

import { test, expect } from 'bun:test';
import { retrospectMission, renderMissionReflection, imprintMissionReflection } from '../src/autopilot/mission-retrospect.js';
import { openSurfaceEventsDb } from '../src/domains/surface-events.js';

test('coherent — 전 아크 done+verified', () => {
  const r = retrospectMission({
    id: 'm1', goal: '기능 X 구현',
    arcs: [
      { arcId: 'a1', name: 'A', status: 'done', verifyResult: { ok: true } },
      { arcId: 'a2', name: 'B', status: 'done', verifyResult: { ok: true }, dependsOnArcs: ['a1'] },
    ],
  });
  expect(r.verdict).toBe('coherent');
  expect(r.arcs.verified).toBe(2);
  expect(renderMissionReflection(r)).toContain('coherent');
});

test('partial — 미검증 done + descoped', () => {
  const r = retrospectMission({
    id: 'm2', goal: 'g',
    arcs: [
      { arcId: 'a1', status: 'done', verifyResult: { ok: true } },
      { arcId: 'a2', status: 'done', verifyResult: { ok: false }, dependsOnArcs: ['a1'] }, // unverified
      { arcId: 'a3', status: 'descoped', verifyResult: { ok: true }, dependsOnArcs: ['a2'] },
    ],
  });
  expect(r.verdict).toBe('partial');
  expect(r.arcs.unverified.length).toBe(1);
  expect(r.arcs.descoped).toBe(1);
});

test('incoherent — 아크 0 / 미완 다수', () => {
  expect(retrospectMission({ id: 'm3', goal: 'g', arcs: [] }).verdict).toBe('incoherent');
  const r = retrospectMission({
    id: 'm4', goal: 'g',
    arcs: [
      { arcId: 'a1', status: 'verifying' },
      { arcId: 'a2', status: 'proposed' },
      { arcId: 'a3', status: 'done', verifyResult: { ok: true }, dependsOnArcs: ['a1'] },
    ],
  });
  expect(r.verdict).toBe('incoherent'); // incomplete(2) > done(1)
  expect(r.arcs.incomplete.length).toBe(2);
});

test('dead-arc — 소비 안 되는(마지막 아님) done 아크 → partial', () => {
  const r = retrospectMission({
    id: 'm5', goal: 'g',
    arcs: [
      { arcId: 'a1', name: 'orphan', status: 'done', verifyResult: { ok: true } }, // 아무도 dependsOn 안 함·마지막 아님
      { arcId: 'a2', name: 'last', status: 'done', verifyResult: { ok: true } },     // 마지막 → dead 제외
    ],
  });
  expect(r.arcs.deadArcs).toContain('orphan');
  expect(r.arcs.deadArcs).not.toContain('last');
  expect(r.verdict).toBe('partial');
});

test('imprintMissionReflection — surface_events 각인(in-memory·프로덕션 무접촉)', () => {
  const db = openSurfaceEventsDb(':memory:');
  const r = retrospectMission({
    id: 'apm_test', goal: 'g',
    arcs: [{ arcId: 'a1', status: 'done', verifyResult: { ok: false } }],
  });
  const eventId = imprintMissionReflection(r, db);
  expect(typeof eventId).toBe('string');
  const row = db.prepare(`SELECT category, kind, importance, summary FROM events WHERE id = ?`).get(eventId) as
    { category: string; kind: string; importance: number; summary: string } | undefined;
  expect(row?.category).toBe('mission.retro');
  expect(row?.kind).toBe('mission-retro');
  expect(row?.summary).toContain('apm_test');
  db.close();
});

// ── C2 진행 간 피드백 회고 ──────────────────────────────
import {
  retrospectMissionFeedback,
  imprintMissionFeedback,
  aggregateMissionRetros,
  imprintMissionReflection as imprintRetro,
  retrospectMission as retro,
} from '../src/autopilot/mission-retrospect.js';

const wm = (provenance: string, summary: string, decisions: string[] = []) =>
  ({ phaseId: 'p', phaseTitle: 't', kind: 'investigation', at: '', summary, reusables: [], decisions, artifacts: [], provenance }) as never;

test('C2 retrospectMissionFeedback — provenance 분류(self 제외)', () => {
  const r = retrospectMissionFeedback('m', [
    wm('reconcile', '현실과 다름 정정'),
    wm('decision', '', ['HITL 승인하라']),
    wm('external', '대표 주입 가이드'),
    wm('self', '페이즈 자기작업'),
  ]);
  expect(r.frictionPoints.length).toBe(1);
  expect(r.willSignals.length).toBe(1);
  expect(r.externalGuidance.length).toBe(1);
  expect(r.count).toBe(3); // self 제외
});

// ── C3 주간 회고 소스 집계 ──────────────────────────────
test('C3 aggregateMissionRetros — mission.retro/feedback 기간 집계', () => {
  const db = openSurfaceEventsDb(':memory:');
  imprintRetro(retro({ id: 'm1', goal: 'g', arcs: [{ arcId: 'a1', status: 'done', verifyResult: { ok: true } }] }), db); // coherent
  imprintRetro(retro({ id: 'm2', goal: 'g', arcs: [
    { arcId: 'a1', status: 'verifying' }, { arcId: 'a2', status: 'proposed' }, { arcId: 'a3', status: 'done', verifyResult: { ok: true }, dependsOnArcs: ['a1'] },
  ] }), db); // incoherent
  imprintMissionFeedback(retrospectMissionFeedback('m1', [wm('reconcile', '불편1'), wm('reconcile', '불편2')]), db); // friction 2

  const agg = aggregateMissionRetros('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z', db);
  expect(agg).not.toBeNull();
  expect(agg!.count).toBe(2);
  expect(agg!.coherent).toBe(1);
  expect(agg!.incoherent).toBe(1);
  expect(agg!.feedbackCount).toBe(1);
  expect(agg!.frictionTotal).toBe(2);
  db.close();
});

test('C3 aggregateMissionRetros — 각인 없으면 null(섹션 생략)', () => {
  const db = openSurfaceEventsDb(':memory:');
  expect(aggregateMissionRetros('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z', db)).toBeNull();
  db.close();
});
