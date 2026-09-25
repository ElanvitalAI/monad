// ── §5-③ Phase C2: ContinuationScheduler ──

import { describe, test, expect } from 'bun:test';
import {
  ContinuationScheduler,
  SCHEDULER_LOG_CATEGORY,
  type SteppableDriver,
  type ContinuationSchedulerDeps,
  type ActiveGoalRef,
} from '../../src/dispatch/continuation-scheduler';
import type { ContinuationStepResult } from '../../src/dispatch/continuation-driver';
import { debug } from '../../src/debug/log';
import { isAuthoredGoalTerminalOutcome } from '../../src/dispatch/authored-goal-queue';

function fakeDriver(outcomes: ContinuationStepResult['outcome'][]): SteppableDriver & { calls: number } {
  let i = 0;
  const d = {
    calls: 0,
    isHalted: false,
    async step(): Promise<ContinuationStepResult> {
      d.calls++;
      const outcome = outcomes[Math.min(i++, outcomes.length - 1)]!;
      if (outcome === 'complete' || outcome === 'max_turns' || outcome === 'andon-no-progress') {
        (d as { isHalted: boolean }).isHalted = true;
      }
      return { outcome, turns: d.calls, noProgressStreak: 0 };
    },
  };
  return d;
}

function captureSchedulerLogs() {
  const records: Array<{ event: string; data: unknown }> = [];
  const off = debug.registerSink({
    name: 'continuation-scheduler-test-capture',
    emit: (record) => {
      if (record.category === SCHEDULER_LOG_CATEGORY) records.push({ event: record.event, data: record.data });
    },
  });
  return { records, off };
}

function makeScheduler(over: Partial<ContinuationSchedulerDeps> = {}) {
  const outcomes: Array<[string, string]> = [];
  const driver = fakeDriver(['continued', 'continued', 'complete']);
  const deps: ContinuationSchedulerDeps = {
    isIdle: () => true,
    getActiveGoal: () => ({ goalSlug: 'g1' }),
    makeDriver: () => driver,
    onOutcome: (goal, r) => { outcomes.push([goal.goalSlug, r.outcome]); },
    setInterval: () => 'H',
    clearInterval: () => {},
    ...over,
  };
  return { scheduler: new ContinuationScheduler(deps), driver, outcomes };
}

describe('ContinuationScheduler', () => {
  test('not idle → no step', async () => {
    const { scheduler, driver } = makeScheduler({ isIdle: () => false });
    await scheduler.tick();
    expect(driver.calls).toBe(0);
  });

  test('no active goal → no step', async () => {
    const { scheduler, driver } = makeScheduler({ getActiveGoal: () => null });
    await scheduler.tick();
    expect(driver.calls).toBe(0);
  });

  test('idle + active goal → steps and records outcome', async () => {
    const { scheduler, driver, outcomes } = makeScheduler();
    await scheduler.tick();
    expect(driver.calls).toBe(1);
    expect(outcomes).toEqual([['g1', 'continued']]);
  });

  test('halts after a terminal outcome (no further steps)', async () => {
    const { scheduler, driver } = makeScheduler();
    await scheduler.tick(); // continued
    await scheduler.tick(); // continued
    await scheduler.tick(); // complete → isHalted latches
    expect(driver.calls).toBe(3);
    await scheduler.tick(); // halted → skipped
    await scheduler.tick();
    expect(driver.calls).toBe(3);
  });

  test('delivers the terminal outcome so a queue owner can advance its head', async () => {
    let goal: { goalSlug: string } | null = { goalSlug: 'first' };
    const completed: string[] = [];
    const { scheduler } = makeScheduler({
      getActiveGoal: () => goal,
      makeDriver: () => fakeDriver(['complete']),
      onOutcome: (activeGoal, result) => {
        if (isAuthoredGoalTerminalOutcome(result.outcome)) {
          completed.push(activeGoal.goalSlug);
          goal = { goalSlug: 'second' };
        }
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(completed).toEqual(['first', 'second']);
  });

  test('same slug from distinct sources builds a fresh driver and preserves queue ownership', async () => {
    let goal: ActiveGoalRef = { goalSlug: 'shared', source: 'auto-mode' };
    const received: Array<{ source?: string; id?: string }> = [];
    const drivers: SteppableDriver[] = [];
    const { scheduler } = makeScheduler({
      getActiveGoal: () => goal,
      makeDriver: () => { const driver = fakeDriver(['continued']); drivers.push(driver); return driver; },
      onOutcome: (activeGoal) => { received.push({ source: activeGoal.source, id: activeGoal.id }); },
    });
    await scheduler.tick();
    goal = { goalSlug: 'shared', source: 'file-queue', id: 'queue-1' };
    await scheduler.tick();
    expect(drivers).toHaveLength(2);
    expect(received).toEqual([{ source: 'auto-mode', id: undefined }, { source: 'file-queue', id: 'queue-1' }]);
  });

  test('a new active goal builds a fresh driver', async () => {
    let slug = 'g1';
    const drivers: Array<SteppableDriver & { calls: number }> = [];
    const { scheduler } = makeScheduler({
      getActiveGoal: () => ({ goalSlug: slug }),
      makeDriver: () => { const d = fakeDriver(['continued']); drivers.push(d); return d; },
    });
    await scheduler.tick();
    slug = 'g2';
    await scheduler.tick();
    expect(drivers).toHaveLength(2);
    expect(drivers[0]!.calls).toBe(1);
    expect(drivers[1]!.calls).toBe(1);
  });

  test('start()/stop() manage the timer seam idempotently', () => {
    let started = 0; let cleared = 0;
    const { scheduler } = makeScheduler({
      setInterval: () => { started++; return 'H'; },
      clearInterval: () => { cleared++; },
    });
    scheduler.start();
    scheduler.start(); // idempotent
    expect(scheduler.running).toBe(true);
    expect(started).toBe(1);
    scheduler.stop();
    scheduler.stop(); // idempotent
    expect(scheduler.running).toBe(false);
    expect(cleared).toBe(1);
  });

  test('records a distinct event for every scheduler tick branch', async () => {
    const capture = captureSchedulerLogs();
    try {
      const notIdle = makeScheduler({ isIdle: () => false });
      await notIdle.scheduler.tick();

      const noGoal = makeScheduler({ getActiveGoal: () => null });
      await noGoal.scheduler.tick();

      const replacement = makeScheduler();
      await replacement.scheduler.tick();

      const haltedDriver = fakeDriver(['complete']);
      const halted = makeScheduler({ makeDriver: () => haltedDriver });
      await halted.scheduler.tick();
      await halted.scheduler.tick();

      let releaseStep!: () => void;
      const pendingStep = new Promise<ContinuationStepResult>((resolve) => { releaseStep = () => resolve({ outcome: 'continued', turns: 1, noProgressStreak: 0 }); });
      const inProgressDriver: SteppableDriver = { isHalted: false, step: () => pendingStep };
      const inProgress = makeScheduler({ makeDriver: () => inProgressDriver });
      const firstTick = inProgress.scheduler.tick();
      await Promise.resolve();
      await inProgress.scheduler.tick();
      releaseStep();
      await firstTick;

      // ⛔ `step-result` 는 스텝이 **끝난 뒤** 난다 — 그래서 진행 중이던 첫 틱의 결과가
      //   두 번째 틱의 `step-in-progress` **뒤에** 온다. 순서 자체가 그 의미를 고정한다.
      expect(capture.records.map((record) => record.event)).toEqual([
        'not-idle',
        'no-active-goal',
        'driver-replaced',
        'step-result',
        'driver-replaced',
        'step-result',
        'driver-halted',
        'step-in-progress',
        'driver-replaced',
        'step-result',
      ]);
      expect(capture.records.find((record) => record.event === 'driver-replaced')?.data).toEqual({ goalSlug: 'g1', previousGoalSlug: null });
      expect(capture.records.find((record) => record.event === 'step-result')?.data).toEqual({ goalSlug: 'g1', outcome: 'continued', turns: 1, noProgressStreak: 0 });
    } finally {
      capture.off();
    }
  });

  test('logs a step failure for a rejecting driver step and preserves the rejection', async () => {
    const capture = captureSchedulerLogs();
    const failure = new Error('driver step failed');
    const driver: SteppableDriver = {
      isHalted: false,
      step: async () => { throw failure; },
    };
    try {
      const { scheduler } = makeScheduler({ makeDriver: () => driver });
      await expect(scheduler.tick()).rejects.toBe(failure);
      // 반증 입력: 거부한 스텝은 `step-result` 를 **받지 않는다** — 받으면 실행 완료로 읽힌다.
      expect(capture.records).toEqual([
        { event: 'driver-replaced', data: { goalSlug: 'g1', previousGoalSlug: null } },
        { event: 'step-failed', data: { goalSlug: 'g1', error: 'driver step failed' } },
      ]);
    } finally {
      capture.off();
    }
  });

  test('logs a repeated waiting branch once until a different branch occurs', async () => {
    const capture = captureSchedulerLogs();
    try {
      let idle = false;
      const { scheduler } = makeScheduler({ isIdle: () => idle });
      for (let i = 0; i < 100; i++) await scheduler.tick();
      idle = true;
      await scheduler.tick();
      idle = false;
      await scheduler.tick();

      expect(capture.records.map((record) => record.event)).toEqual([
        'not-idle',
        'driver-replaced',
        'step-result',
        'not-idle',
      ]);
    } finally {
      capture.off();
    }
  });

  // 리뷰 should-fix — 억제 검증이 `not-idle` 하나만 덮고 있었다. 대기 갈래 **넷 전부**와
  //   갈래가 바뀐 뒤 다시 남는 것까지 본다.
  test('suppresses every repeated waiting branch and records again after the branch changes', async () => {
    const capture = captureSchedulerLogs();
    try {
      let idle = false;
      let goal: { goalSlug: string } | null = null;
      const haltedDriver: SteppableDriver = { isHalted: true, step: async () => ({ outcome: 'complete', turns: 1, noProgressStreak: 0 }) };
      const { scheduler } = makeScheduler({ isIdle: () => idle, getActiveGoal: () => goal, makeDriver: () => haltedDriver });

      for (let i = 0; i < 100; i++) await scheduler.tick();   // not-idle ×100
      idle = true;
      for (let i = 0; i < 100; i++) await scheduler.tick();   // no-active-goal ×100
      goal = { goalSlug: 'g1' };
      for (let i = 0; i < 100; i++) await scheduler.tick();   // driver-replaced + driver-halted ×100
      idle = false;
      for (let i = 0; i < 100; i++) await scheduler.tick();   // not-idle ×100 — 갈래가 바뀌었으니 다시 1줄

      expect(capture.records.map((record) => record.event)).toEqual([
        'not-idle',
        'no-active-goal',
        'driver-replaced',
        'driver-halted',
        'not-idle',
      ]);
    } finally {
      capture.off();
    }
  });

  // 반증 입력 — 드라이버 생성 실패는 스텝 거부가 아니다. 던지면 타이머의 미처리 rejection 이 되고
  //   그 골이 다시 시도되지도 않는다(리뷰 must-fix). 이 틱만 건너뛰고 다음 틱에 다시 만든다.
  test('skips the tick when driver creation throws and retries on the next tick', async () => {
    const capture = captureSchedulerLogs();
    try {
      let attempts = 0;
      const { scheduler, driver } = makeScheduler({
        makeDriver: () => { attempts += 1; if (attempts === 1) throw new Error('boom'); return driver; },
      });
      await scheduler.tick();
      await scheduler.tick();

      expect(attempts).toBe(2);
      expect(capture.records.map((record) => record.event)).toEqual(['driver-create-failed', 'driver-replaced', 'step-result']);
    } finally {
      capture.off();
    }
  });

  // 반증 입력 — `step-failed` 는 **스텝 거부에만** 붙는다. onOutcome 콜백이 던진 것을
  //   step-failed 로 적으면 "스텝이 실패했다" 는 거짓이 된다(리뷰 must-fix).
  test('does not record a step failure when the onOutcome callback throws', async () => {
    const capture = captureSchedulerLogs();
    const callbackFailure = new Error('outcome sink failed');
    try {
      const { scheduler } = makeScheduler({ onOutcome: () => { throw callbackFailure; } });
      await expect(scheduler.tick()).rejects.toBe(callbackFailure);

      expect(capture.records.map((record) => record.event)).toEqual(['driver-replaced', 'step-result']);
      expect(capture.records.some((record) => record.event === 'step-failed')).toBe(false);
    } finally {
      capture.off();
    }
  });

  // 리뷰 should-fix — 단발 둘은 억제 대상이 아니다. 반복해도 매번 남는다는 것을 전용 케이스로 고정한다.
  test('records driver-replaced and step-result every time they occur', async () => {
    const capture = captureSchedulerLogs();
    try {
      let slug = 'g1';
      const { scheduler } = makeScheduler({
        getActiveGoal: () => ({ goalSlug: slug }),
        makeDriver: () => ({ isHalted: false, step: async () => ({ outcome: 'continued', turns: 1, noProgressStreak: 0 }) }),
      });
      await scheduler.tick();
      await scheduler.tick();          // 같은 골 — 교체 없음, 결과는 또 남는다
      slug = 'g2';
      await scheduler.tick();          // 골이 바뀌었다 — 교체가 또 남는다

      expect(capture.records.map((record) => record.event)).toEqual([
        'driver-replaced',
        'step-result',
        'step-result',
        'driver-replaced',
        'step-result',
      ]);
    } finally {
      capture.off();
    }
  });

  // 반증 입력 — `step-in-progress` 도 억제 대상이다(위 케이스는 그 갈래에 못 들어간다).
  test('suppresses a repeated step-in-progress branch while one step is still running', async () => {
    const capture = captureSchedulerLogs();
    let releaseStep!: () => void;
    const pending = new Promise<ContinuationStepResult>((resolve) => { releaseStep = () => resolve({ outcome: 'continued', turns: 1, noProgressStreak: 0 }); });
    try {
      const { scheduler } = makeScheduler({ makeDriver: () => ({ isHalted: false, step: () => pending }) });
      const first = scheduler.tick();
      await Promise.resolve();
      for (let i = 0; i < 100; i++) await scheduler.tick();
      releaseStep();
      await first;

      expect(capture.records.map((record) => record.event)).toEqual([
        'step-in-progress',
        'driver-replaced',
        'step-in-progress',
        'step-result',
      ]);
    } finally {
      capture.off();
    }
  });
});
