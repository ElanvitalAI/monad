import { test, expect, describe } from 'bun:test';
import { classifyLanding, scanMissionLanding, formatLandingScanLine } from './mission-landing-scan.js';
import { TaskStore } from '../task-orchestrator/store.js';

describe('classifyLanding — 순수 분류(B7)', () => {
  test('open=blocking(확정 미머지) · merged/closed/none=non-blocking', () => {
    expect(classifyLanding(1, 'OPEN')).toEqual({ state: 'open', blocking: true });
    expect(classifyLanding(1, 'MERGED')).toEqual({ state: 'merged', blocking: false });
    expect(classifyLanding(1, 'CLOSED')).toEqual({ state: 'closed', blocking: false });
    expect(classifyLanding(null, undefined)).toEqual({ state: 'none', blocking: false });
    expect(classifyLanding(1, undefined)).toEqual({ state: 'none', blocking: false }); // 조회 실패=미상
  });
});

describe('scanMissionLanding — 없는 미션 fail-soft', () => {
  test('없는 미션은 빈 스캔(throw 안 함·prStates 주입)', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    try {
      const s = scanMissionLanding('apm_missing', { store, prStates: () => new Map() });
      expect(s.total).toBe(0);
      expect(s.blocking).toBe(0);
      expect(formatLandingScanLine(s)).toContain('기록 PR 없음');
    } finally { store.close(); }
  });
});

describe('formatLandingScanLine — 게이트 힌트', () => {
  const base = { missionId: 'apm_x', total: 3, merged: 0, open: 0, closed: 0, none: 0, blocking: 0, needsRecheck: 0, phases: [] };
  test('open 있으면 ⛔ 완주 차단', () => {
    expect(formatLandingScanLine({ ...base, open: 2, blocking: 2 })).toContain('⛔ 완주 차단');
  });
  test('closed 만 있으면 ⚠️ 확인 권장(grounded)', () => {
    expect(formatLandingScanLine({ ...base, closed: 2, needsRecheck: 2 })).toContain('⚠️ 확인 권장');
  });
  test('전부 merged 면 ✅ 랜딩 확인', () => {
    expect(formatLandingScanLine({ ...base, merged: 3 })).toContain('✅ 랜딩 확인');
  });
});
