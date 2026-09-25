// #24 — event-loop watchdog. evaluateStall(순수) + activity API. 워커 통합은 라이브 스모크로 검증됨
// (scratchpad·bun 워커 stall 감지+activity 특정 실증) — 유닛은 결정론 코어만.
import { describe, test, expect } from 'bun:test';
import { evaluateStall, setEventLoopActivity, currentEventLoopActivity, startEventLoopWatchdog, stopEventLoopWatchdog, isEventLoopWatchdogActive } from './event-loop-watchdog.js';

describe('gate 격리 — MONAD_NO_WATCHDOG', () => {
  test('MONAD_NO_WATCHDOG=1 → startEventLoopWatchdog no-op(gate test 프로세스 격리)', () => {
    const prev = process.env.MONAD_NO_WATCHDOG;
    process.env.MONAD_NO_WATCHDOG = '1';
    try {
      startEventLoopWatchdog({ heartbeatFile: '/tmp/wd-test.hb', stallLogFile: '/tmp/wd-test.stall' });
      expect(isEventLoopWatchdogActive()).toBe(false); // 워커/interval 미기동
    } finally {
      stopEventLoopWatchdog();
      if (prev === undefined) delete process.env.MONAD_NO_WATCHDOG; else process.env.MONAD_NO_WATCHDOG = prev;
    }
  });
});

describe('evaluateStall', () => {
  test('heartbeat 신선(stale ≤ 임계) → ok', () => {
    const r = evaluateStall(1000, 1200, 500, false);
    expect(r.stalling).toBe(false);
    expect(r.event).toBe('ok');
    expect(r.staleMs).toBe(200);
  });

  test('stale > 임계·직전 정상 → stall-START', () => {
    const r = evaluateStall(1000, 1600, 500, false);
    expect(r.stalling).toBe(true);
    expect(r.event).toBe('stall-START');
    expect(r.staleMs).toBe(600);
  });

  test('stale > 임계·직전도 stall → stall-ONGOING(지속 추적)', () => {
    const r = evaluateStall(1000, 2000, 500, true);
    expect(r.stalling).toBe(true);
    expect(r.event).toBe('stall-ONGOING');
  });

  test('회복(stale ≤ 임계)·직전 stall → stall-RECOVERED', () => {
    const r = evaluateStall(1000, 1300, 500, true);
    expect(r.stalling).toBe(false);
    expect(r.event).toBe('stall-RECOVERED');
  });

  test('경계 — 정확히 임계는 stall 아님(초과만)', () => {
    expect(evaluateStall(1000, 1500, 500, false).event).toBe('ok'); // staleMs=500, >500 아님
    expect(evaluateStall(1000, 1501, 500, false).event).toBe('stall-START');
  });
});

describe('setEventLoopActivity / currentEventLoopActivity', () => {
  test('activity 라벨 갱신 + since 스탬프', () => {
    setEventLoopActivity('test:phase-a');
    const a = currentEventLoopActivity();
    expect(a.label).toBe('test:phase-a');
    expect(a.sinceMs).toBeGreaterThan(0);
    setEventLoopActivity('test:phase-b');
    expect(currentEventLoopActivity().label).toBe('test:phase-b');
  });
});
