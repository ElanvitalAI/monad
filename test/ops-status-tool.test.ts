// Unit tests for ops_status L2 core tool (Ops Observability P2).
// action 분기(snapshot|health|timeline) 응답 shape + core-tools 등록 grep 가드.

import { describe, expect, spyOn, test } from 'bun:test';
import { OPS_STATUS_SPEC, dispatchOpsStatus } from '../src/domains/ops-status-tool.js';
import * as opsStatus from '../src/domains/ops-status.js';
import type { OpsHealthReport, OpsSnapshot } from '../src/domains/ops-status.js';
import { buildCoreTools, CORE_TOOL_SPECS } from '../src/domains/core-tools.js';

const SNAPSHOT_FIXTURE: OpsSnapshot = {
  missions: { total: 0, byStatus: {}, active: [] },
  tasks: { total: 0, byStatus: {}, scheduleBacked: 0, recentlyActive: 0, dispatchPending: 0, blocked: [], dispatchable: [] },
  loops: { loops: [], armed: false, live: false, executionMode: 'per-cycle', paperSources: [] },
  orchestration: { recent: [] },
  schedules: {
    monadTotal: 1, stale: [], errored: [],
    noncanonical: [], unmeasured: [],
    excludedRunVia: 0, excludedUnwrappedCrontab: 0, excludedDisabled: 0, excludedMissingCron: 0,
    generatedAt: '2026-09-02T00:00:00.000Z',
  },
  generatedAt: '2026-09-02T00:00:00.000Z',
};

const HEALTH_FIXTURE: OpsHealthReport = {
  healthy: true,
  anomalies: [],
  generatedAt: '2026-09-02T00:00:00.000Z',
};

describe('ops_status tool — dispatch action 분기', () => {
  test('snapshot(기본) — missions/tasks/loops/health 키 존재', async () => {
    const snapshot = spyOn(opsStatus, 'opsSnapshot').mockReturnValue(SNAPSHOT_FIXTURE);
    const healthSpy = spyOn(opsStatus, 'opsHealth').mockReturnValue(HEALTH_FIXTURE);
    try {
      const r = (await dispatchOpsStatus({})) as Record<string, unknown>;
      expect(r).toHaveProperty('missions');
      expect(r).toHaveProperty('tasks');
      expect(r).toHaveProperty('loops');
      expect(r).toHaveProperty('orchestration');
      expect(r).toHaveProperty('health');
      expect(r).toHaveProperty('generatedAt');
      const schedules = r.schedules as Record<string, unknown> | null;
      if (schedules) {
        expect(typeof schedules.monadTotal).toBe('number');
        expect(typeof schedules.staleCount).toBe('number');
        expect(typeof schedules.erroredCount).toBe('number');
        expect(typeof schedules.noncanonicalCount).toBe('number');
        expect(typeof schedules.unmeasuredCount).toBe('number');
        expect(typeof schedules.excludedRunVia).toBe('number');
        expect(typeof schedules.excludedUnwrappedCrontab).toBe('number');
        expect(typeof schedules.excludedDisabled).toBe('number');
        expect(typeof schedules.excludedMissingCron).toBe('number');
      }
      // 스냅샷 health 는 count 뿐 아니라 anomalies 상세도 실어야("무엇이 이상인지"를
      // ops health 재조회 없이 — 관측 갭 해소·2026-07-24).
      const health = r.health as Record<string, unknown>;
      expect(typeof health.anomalyCount).toBe('number');
      expect(Array.isArray(health.anomalies)).toBe(true);
    } finally {
      snapshot.mockRestore();
      healthSpy.mockRestore();
    }
  });

  test('snapshot은 측정된 정규형 위반과 미측정을 별도 수로 투영한다', async () => {
    const snapshot = spyOn(opsStatus, 'opsSnapshot').mockReturnValue({
      missions: { total: 0, byStatus: {}, active: [] },
      tasks: { total: 0, byStatus: {}, scheduleBacked: 0, recentlyActive: 0, dispatchPending: 0, blocked: [], dispatchable: [] },
      loops: { loops: [], armed: false, live: false, executionMode: 'per-cycle', paperSources: [] },
      orchestration: { recent: [] },
      schedules: {
        monadTotal: 1, stale: [], errored: [],
        noncanonical: [{ id: 'noncanonical', name: 'noncanonical', cron: '0 * * * *', lastRun: null, lastStatus: null, overdueMs: 0 }],
        unmeasured: [], excludedRunVia: 0, excludedUnwrappedCrontab: 0, excludedDisabled: 0, excludedMissingCron: 0,
        generatedAt: '2026-09-02T00:00:00.000Z',
      },
      generatedAt: '2026-09-02T00:00:00.000Z',
    });
    try {
      const r = (await dispatchOpsStatus({})) as Record<string, unknown>;
      const schedules = r.schedules as Record<string, unknown>;
      expect(schedules.noncanonicalCount).toBe(1);
      expect(schedules.unmeasuredCount).toBe(0);
    } finally {
      snapshot.mockRestore();
    }
  });

  test('health — healthy·anomalies·anomalyCount', async () => {
    const healthSpy = spyOn(opsStatus, 'opsHealth').mockReturnValue(HEALTH_FIXTURE);
    try {
      const r = (await dispatchOpsStatus({ action: 'health' })) as Record<string, unknown>;
      expect(typeof r.healthy).toBe('boolean');
      expect(Array.isArray(r.anomalies)).toBe(true);
      expect(typeof r.anomalyCount).toBe('number');
    } finally {
      healthSpy.mockRestore();
    }
  });

  test('timeline — count·timeline 배열', async () => {
    const timeline = spyOn(opsStatus, 'opsTimeline').mockReturnValue([]);
    try {
      const r = (await dispatchOpsStatus({ action: 'timeline', limit: 5 })) as Record<string, unknown>;
      expect(typeof r.count).toBe('number');
      expect(Array.isArray(r.timeline)).toBe(true);
    } finally {
      timeline.mockRestore();
    }
  });
});

describe('ops_status tool — L2 core-tools 등록(grep 가드)', () => {
  test('CORE_TOOL_SPECS 에 ops_status spec 포함', () => {
    expect(CORE_TOOL_SPECS.some((s) => s.name === 'ops_status')).toBe(true);
    expect(OPS_STATUS_SPEC.name).toBe('ops_status');
  });

  test('buildCoreTools names + dispatch 라우팅', async () => {
    const healthSpy = spyOn(opsStatus, 'opsHealth').mockReturnValue(HEALTH_FIXTURE);
    try {
      const core = buildCoreTools();
      expect(core.names.has('ops_status')).toBe(true);
      const r = (await core.dispatch('ops_status', { action: 'health' })) as Record<string, unknown>;
      expect(typeof r.healthy).toBe('boolean');
    } finally {
      healthSpy.mockRestore();
    }
  });
});
