import { describe, expect, test } from 'bun:test';
import { projectScheduleHealth } from './ops-status-tool.js';

describe('projectScheduleHealth', () => {
  test('scheduleHealth 모집단과 distinct unwrapped-crontab 제외 계수를 JSON에 보존한다', () => {
    expect(projectScheduleHealth({
      monadTotal: 3,
      stale: [{ id: 'never-run', name: 'never-run', cron: '45 7 * * *', lastRun: null, lastStatus: null, overdueMs: 1 }],
      errored: [],
      noncanonical: [],
      unmeasured: [],
      excludedRunVia: 4,
      excludedUnwrappedCrontab: 49,
      excludedDisabled: 5,
      excludedMissingCron: 6,
      generatedAt: '2026-09-02T00:00:00.000Z',
    })).toEqual({
      monadTotal: 3,
      staleCount: 1,
      erroredCount: 0,
      // ⛔ 이 둘은 «다른 착지»(#15411)가 더한 값이다 — 이 시험은 그 «앞» base 에서 쓰여 빠져 있었고,
      //   git 이 «다른 줄»이라 깨끗이 합쳐서 병합 «뒤»에야 빨개졌다(양쪽 게이트는 각자 초록이었다).
      //   🔑 「정규형이 아니다」와 「못 쟀다」는 서로 «다른 값»이므로 둘 다 산출에 남아야 한다.
      noncanonicalCount: 0,
      unmeasuredCount: 0,
      excludedRunVia: 4,
      excludedUnwrappedCrontab: 49,
      excludedDisabled: 5,
      excludedMissingCron: 6,
    });
  });

  test('scheduleHealth를 셀 수 없는 null 상태는 JSON에서도 null이다', () => {
    expect(projectScheduleHealth(null)).toBeNull();
  });
});
