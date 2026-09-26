import { test, expect, describe } from 'bun:test';
import { formatHealthReport, humanizeMs } from './schedule-health-report.js';
import type { ScheduleHealth } from './schedule-registry.js';

const clean: ScheduleHealth = {
  elanousTotal: 30, excludedRunVia: 0, excludedUnwrappedCrontab: 0, excludedDisabled: 0, excludedMissingCron: 0,
  errored: [], stale: [], noncanonical: [], unmeasured: [], generatedAt: '2026-07-09T00:00:00Z',
};
const problem: ScheduleHealth = {
  elanousTotal: 30,
  excludedRunVia: 0,
  excludedUnwrappedCrontab: 0,
  excludedDisabled: 0,
  excludedMissingCron: 0,
  stale: [{ id: 'a', name: 'run-morning-report', cron: '45 7 * * *', lastRun: null, lastStatus: null, overdueMs: 3 * 3600_000 + 12 * 60_000 }],
  errored: [{ id: 'b', name: 'us-pulse', cron: '0 23 * * 1-5', lastRun: '2026-07-08T14:00:00Z', lastStatus: 'error', overdueMs: 0 }],
  noncanonical: [],
  unmeasured: [],
  generatedAt: '2026-07-09T00:00:00Z',
};

describe('humanizeMs', () => {
  test('시분초', () => {
    expect(humanizeMs(3 * 3600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(humanizeMs(12 * 60_000)).toBe('12m');
    expect(humanizeMs(45_000)).toBe('45s');
  });
});

describe('formatHealthReport', () => {
  test('alert 모드 — 문제 없으면 null(무음)', () => {
    expect(formatHealthReport(clean, { mode: 'alert', nowLabel: '07-09 08:00' })).toBeNull();
  });
  test('alert 모드 — 문제 있으면 밀림/실패 나열', () => {
    const msg = formatHealthReport(problem, { mode: 'alert', nowLabel: '07-09 08:00' })!;
    expect(msg).toContain('밀림 1 · 실패 1');
    expect(msg).toContain('run-morning-report');
    expect(msg).toContain('3h 12m 지남');
    expect(msg).toContain('us-pulse');
  });
  test('digest 모드 — 문제 없어도 정상 요약 발송', () => {
    const msg = formatHealthReport(clean, { mode: 'digest', nowLabel: '07-09 08:00' })!;
    expect(msg).not.toBeNull();
    expect(msg).toContain('대상 30');
    expect(msg).toContain('전 잡 정상 발화');
  });
  test('비정규 크론 줄은 경보에 이름과 별도 범주로 나온다', () => {
    const msg = formatHealthReport({
      ...clean,
      noncanonical: [{ id: 'c', name: 'mission-request-judge', cron: '5 8 * * *', lastRun: null, lastStatus: null, overdueMs: 0 }],
    }, { mode: 'alert', nowLabel: '07-09 08:00' })!;
    expect(msg).toContain('비정규 크론 줄');
    expect(msg).toContain('mission-request-judge');
    expect(msg).toContain('비정규 1');
    expect(msg).not.toContain('밀린 잡(유실 의심):');
    expect(msg).not.toContain('실패한 잡:');
  });

  test('정규형 측정 불가는 안전으로 숨기지 않고 경보에 나온다', () => {
    const msg = formatHealthReport({
      ...clean,
      unmeasured: [{ id: 'd', name: 'daily-health', cron: '0 8 * * *', lastRun: null, lastStatus: null, overdueMs: 0 }],
    }, { mode: 'alert', nowLabel: '07-09 08:00' })!;
    expect(msg).toContain('측정 불가 1');
    expect(msg).toContain('정규형 측정 불가');
    expect(msg).toContain('daily-health');
    expect(msg).toContain('안전 여부 미판정');
  });

  test('독립 싱크 커버리지는 스케줄 헬스와 별도 수·이름으로 나온다', () => {
    const msg = formatHealthReport(clean, {
      mode: 'alert',
      nowLabel: '07-09 08:00',
      sinkCoverage: {
        sinkLoss: [{ name: 'mission-request-judge' }],
        unmeasurable: [{ name: 'nightly-docops' }],
      },
    })!;
    expect(msg).toContain('싱크 유실 1');
    expect(msg).toContain('싱크 측정 불가 1');
    expect(msg).toContain('관측을 잃는');
    expect(msg).toContain('독립 싱크 측정 불가');
    expect(msg).toContain('mission-request-judge');
    expect(msg).toContain('nightly-docops');
    expect(msg).not.toContain('밀린 잡(유실 의심):');
    expect(msg).not.toContain('실패한 잡:');
    expect(msg).not.toContain('정규형 측정 불가');
    expect(msg).toContain('측정 불가 0');
  });

  test('독립 싱크만 문제여도 alert 가 울리고 스케줄 요약은 그대로다', () => {
    const msg = formatHealthReport(problem, {
      mode: 'alert',
      nowLabel: '07-09 08:00',
      sinkCoverage: {
        sinkLoss: [{ name: 'signal-router-cycle' }],
        unmeasurable: [],
      },
    })!;
    expect(msg).toContain('밀림 1 · 실패 1');
    expect(msg).toContain('run-morning-report');
    expect(msg).toContain('us-pulse');
    expect(msg).toContain('싱크 유실 1');
    expect(msg).toContain('싱크 측정 불가 0');
    expect(msg).toContain('signal-router-cycle');
    expect(msg).toContain('관측을 잃는');
    expect(msg).not.toContain('독립 싱크 측정 불가:');
  });

  test('싱크 커버리지가 비어 있으면 기존 스케줄 문면만 나온다', () => {
    const digest = formatHealthReport(clean, {
      mode: 'digest',
      nowLabel: '07-09 08:00',
      sinkCoverage: { sinkLoss: [], unmeasurable: [] },
    })!;
    expect(digest).toContain('대상 30');
    expect(digest).toContain('전 잡 정상 발화');
    expect(digest).not.toContain('독립 싱크');
    expect(digest).not.toContain('싱크 유실');
    expect(formatHealthReport(clean, {
      mode: 'alert',
      nowLabel: '07-09 08:00',
      sinkCoverage: { sinkLoss: [], unmeasurable: [] },
    })).toBeNull();
  });
});

describe('formatHealthReport — 목록을 자르면 몇 개를 숨겼는지 말한다', () => {
  test('싱크 유실 20 이면 15 줄 뒤에 「… 외 5」가 붙는다', () => {
    const health = { elanousTotal: 20, stale: [], errored: [], noncanonical: [], unmeasured: [], ok: [] } as unknown as Parameters<typeof formatHealthReport>[0];
    const sinkLoss = Array.from({ length: 20 }, (_, i) => ({ name: `job-${i}` }));
    const msg = formatHealthReport(health, { mode: 'digest', nowLabel: 'now', sinkCoverage: { sinkLoss, unmeasurable: [] } }) ?? '';
    expect(msg).toContain(' · job-14');
    expect(msg).not.toContain(' · job-15');
    expect(msg).toContain(' · … 외 5');
  });
});
