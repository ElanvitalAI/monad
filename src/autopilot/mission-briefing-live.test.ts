import { test, expect, describe } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { liveBriefingReaders, buildLiveMissionBriefing } from './mission-briefing-live.js';

describe('mission-briefing-live — 실 소스 배선(B2)', () => {
  test('없는 미션도 fail-soft — readers 가 null/빈 배열 반환(throw 안 함)', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    try {
      const r = liveBriefingReaders('apm_missing', { store });
      expect(r.revisions?.()).toBeNull();
      expect(r.mission?.()).toBeNull();
      expect(r.phases?.()).toEqual([]);
      expect(r.history?.()).toEqual([]);
      expect(r.resourceCount?.()).toBe(0);
      // grounded 기본 OFF — reader 미포함.
      expect(r.grounded).toBeUndefined();
      // routeDecision reader 존재(실행 레인·#4249) — 없는 미션은 골 없어 null(fail-soft·throw 안 함).
      expect(typeof r.routeDecision).toBe('function');
      expect(r.routeDecision?.()).toBeNull();
    } finally { store.close(); }
  });

  test('grounded=true 면 grounded reader 포함(현실 관측 opt-in)', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    try {
      const r = liveBriefingReaders('apm_missing', { store, grounded: true });
      expect(typeof r.grounded).toBe('function');
    } finally { store.close(); }
  });

  test('buildLiveMissionBriefing — 없는 미션도 구조 반환(빈 브리핑·throw 안 함)', () => {
    const b = buildLiveMissionBriefing('apm_missing');
    expect(b.missionId).toBe('apm_missing');
    expect(b.settlement.phasesTotal).toBe(0);
    expect(b.deliverables.groundedChecked).toBe(false);
  });
});
