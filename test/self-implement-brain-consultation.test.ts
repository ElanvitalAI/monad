import { describe, expect, it, spyOn } from 'bun:test';
import type { RunSupervisor } from '../src/autopilot/pty-control-loop.js';
import { shouldConsultBrain, brainTrigger } from '../src/self-implement/brain-consultation.js';
import { runHeadlessGoalLoopPty } from '../src/self-implement/headless-monad-driver.js';
import { debug } from '../src/debug/log.js';

function makeBrainHandle(canWrite = true) {
  let polls = 0;
  let writes = 0;
  let kills = 0;
  const handle = {
    id: 'pty_brain_test', cmd: 'bun', workdir: '/w', startedAt: 0, lastActivityAt: 0, detach: false,
    exitCode: null as number | null, exitSignal: undefined,
    isAlive: () => handle.exitCode === null,
    appendOutput() {},
    drainDelta() { polls += 1; if (polls >= 3) handle.exitCode = 0; return ''; },
    snapshot: () => '',
    write() { writes += 1; },
    canWrite: () => canWrite,
    kill() { kills += 1; }, resize() {},
    renderScreen: async () => 'Do you want to proceed?\n  1. yes\n  2. no',
    renderScreenPng: async () => null,
  };
  return { handle, spawn: (() => handle) as never, polls: () => polls, writes: () => writes, kills: () => kills };
}

async function runWithBrain(brain?: RunSupervisor, canWrite = true, signal?: AbortSignal, autoAssist?: { enabled: boolean; minRung: number }) {
  const fake = makeBrainHandle(canWrite);
  const result = await runHeadlessGoalLoopPty({
    binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 10,
    spawn: fake.spawn, ptyAvailable: () => true, ...(brain ? { brain } : {}), ...(signal ? { signal } : {}), ...(autoAssist ? { autoAssist } : {}),
  });
  return { ...fake, result };
}

describe('shouldConsultBrain — S4 P2b 1층 호출 억제(엣지 트리거만)', () => {
  it('전이에서 상담한다', () => {
    expect(shouldConsultBrain({ transition: true, stall: false })).toBe(true);
  });

  it('stall 문턱 통과에서 상담한다', () => {
    expect(shouldConsultBrain({ transition: false, stall: true })).toBe(true);
  });

  it('정상 진행(전이 X·stall X)은 억제한다', () => {
    expect(shouldConsultBrain({ transition: false, stall: false })).toBe(false);
  });

  it('전이+stall 동시도 한 번만 참(중복 상담 없음)', () => {
    expect(shouldConsultBrain({ transition: true, stall: true })).toBe(true);
  });

  // ⭐⭐ 핵심 회귀 가드(리뷰 must-fix · 2026-07-26 직접 개입 수리)
  //
  // 초안 게이트는 `transition || stall || state === 'blocked'` 였다. `blocked` 는 **상태(레벨)** 라
  // 자식이 승인 프롬프트에 멈춰 있으면 그 상태가 유지되는 **매 폴 tick(~1s)** 마다 brain 을 불렀다
  // — 10분 잠금 = LLM 수백 회 = 호출 억제 게이트의 존재 이유를 정면으로 파괴.
  //
  // 커버리지 손실도 없다: **진입**(→blocked)은 `transition` 이, **지속**은 `stall` 사다리(15s·60s·5min)가
  // 문턱당 1회로 잡는다. 두 엣지로 충분하다.
  it('⭐ blocked 지속은 상담하지 않는다 — 시그니처에 state 가 없어 구조적으로 불가능하다', () => {
    // 타입 수준에서 state 를 받지 않으므로 레벨 트리거가 되살아나면 컴파일이 깨진다(가장 강한 가드).
    const gate: (i: { transition: boolean; stall: boolean }) => boolean = shouldConsultBrain;
    expect(gate({ transition: false, stall: false })).toBe(false);
  });
});

describe('brainTrigger — 관측 라벨', () => {
  it('transition 우선, 그다음 stall, 억제된 tick 은 undefined', () => {
    expect(brainTrigger({ transition: true, stall: true })).toBe('transition');
    expect(brainTrigger({ transition: false, stall: true })).toBe('stall');
    expect(brainTrigger({ transition: false, stall: false })).toBeUndefined();
  });
});

describe('runHeadlessGoalLoopPty — S4 P2b suggestion-only brain', () => {
  it('gate 통과 tick에서만 brain을 상담하고 input은 절대 write하지 않는다', async () => {
    let calls = 0;
    let suggestion: Record<string, unknown> | undefined;
    let verdict: Record<string, unknown> | undefined;
    const events: string[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category !== 'self-implement') return;
      events.push(event);
      if (event === 'brain.suggestion') suggestion = data;
      if (event === 'run-supervision.verdict') verdict = data;
    }) as never);
    try {
      const brain: RunSupervisor = { decide: () => { calls += 1; return { action: 'input', text: 'X' }; } };
      const r = await runWithBrain(brain);
      expect(calls).toBe(1);
      expect(r.writes()).toBe(0);
      expect(r.result.reachedCompletion).toBe(true);
      expect(suggestion).toMatchObject({ action: 'input', applied: false });
      expect(verdict).toBe(suggestion);
      expect(events.filter((event) => event === 'brain.suggestion' || event === 'run-supervision.verdict'))
        .toEqual(['brain.suggestion', 'run-supervision.verdict']);
    } finally {
      spy.mockRestore();
    }
  });

  it('argv child input outcome은 consumer 부재를 명시하고 어떤 flag에서도 write하지 않는다', async () => {
    const outcomes: Record<string, unknown>[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.input-outcome') outcomes.push(data ?? {});
    }) as never);
    try {
      const brain: RunSupervisor = { decide: () => ({ action: 'input', text: 'X' }) };
      const r = await runWithBrain(brain, true, undefined, { enabled: true, minRung: 0 });
      expect(r.writes()).toBe(0);
      expect(outcomes).toContainEqual(expect.objectContaining({ applied: false, why: 'child-cannot-receive-input', canReceiveInput: false }));
    } finally {
      spy.mockRestore();
    }
  });

  it('assist flag absent preserves existing suggestion and control flow', async () => {
    const events: string[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string) => {
      if (_category === 'self-implement') events.push(event);
    }) as never);
    try {
      const brain: RunSupervisor = { decide: () => ({ action: 'input', text: 'X' }) };
      const r = await runWithBrain(brain);
      expect(r.writes()).toBe(0);
      expect(r.polls()).toBe(3);
      expect(events).toContain('brain.suggestion');
      expect(events).toContain('run-supervision.verdict');
      expect(events).not.toContain('brain.applied');
      expect(events).toContain('brain.input-outcome');
    } finally {
      spy.mockRestore();
    }
  });

  it('brain done은 기존 exit/GOAL-COMPLETE 완료 조건을 바꾸지 않아 조기 종료하지 않는다', async () => {
    const brain: RunSupervisor = { decide: () => ({ action: 'done', reason: 'suggestion only' }) };
    const r = await runWithBrain(brain);
    expect(r.polls()).toBe(3);
    expect(r.result.reachedCompletion).toBe(true);
    expect(r.writes()).toBe(0);
  });

  it('brain throw는 fail-soft로 계속 실행하고 brain.fail을 관측한다', async () => {
    const logs: { event: string; data?: Record<string, unknown> }[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      logs.push({ event, ...(data ? { data } : {}) });
    }) as never);
    try {
      const brain: RunSupervisor = { decide: () => { throw new Error('brain boom'); } };
      const r = await runWithBrain(brain);
      expect(r.result.reachedCompletion).toBe(true);
      expect(logs.find((log) => log.event === 'brain.fail')?.data).toMatchObject({ roundContextPresent: false });
    } finally {
      spy.mockRestore();
    }
    expect(logs.map((log) => log.event)).toContain('brain.fail');
  });

  it('pending brain이 abort를 무시해도 부모 cancel은 상담 timeout 전에 즉시 kill·정리한다', async () => {
    const ac = new AbortController();
    let decideStarted = false;
    let brainSignal: AbortSignal | undefined;
    const brain: RunSupervisor = {
      decide: (_obs, signal) => {
        decideStarted = true;
        brainSignal = signal;
        setTimeout(() => ac.abort(), 10);
        return new Promise(() => {});
      },
    };
    const startedAt = Date.now();
    const r = await runWithBrain(brain, true, ac.signal);
    expect(decideStarted).toBe(true);
    expect(brainSignal?.aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(r.kills()).toBeGreaterThan(0);
    expect(r.result.timedOut).toBe(false);
    expect(r.result.reachedCompletion).toBe(false);
  });

  it("사람 takeover로 canWrite('agent')가 false면 brain 상담을 생략한다", async () => {
    let calls = 0;
    const brain: RunSupervisor = { decide: () => { calls += 1; return { action: 'wait' }; } };
    const r = await runWithBrain(brain, false);
    expect(calls).toBe(0);
    expect(r.result.reachedCompletion).toBe(true);
  });

  it('brain 미주입이면 종전 완료 동작을 보존한다', async () => {
    const r = await runWithBrain();
    expect(r.polls()).toBe(3);
    expect(r.result.reachedCompletion).toBe(true);
    expect(r.writes()).toBe(0);
  });
});

// ── timeout fail-soft (리뷰 must-fix · 수용기준 4·6) ─────────────────────────────────
//
// 종전 테스트는 **부모 cancel** 경로만 검증했다. 일반적인 brain 지연/timeout 후 폴 루프가 계속되는
// fail-soft 경로가 미검증이었다 — 그게 수용기준 4의 본문이다. `brainTimeoutMs` 주입으로 15초를
// 기다리지 않고 고정한다.
describe('runHeadlessGoalLoopPty — brain timeout fail-soft', () => {
  it('⭐ brain 이 응답하지 않아도 timeout 후 폴 루프가 계속되고 brain.fail 을 관측한다', async () => {
    const fake = makeBrainHandle();
    const logs: { event: string; data?: Record<string, unknown> }[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: Record<string, unknown>) => {
      logs.push({ event, ...(data ? { data } : {}) });
    }) as never);
    try {
      // 영원히 pending 인 brain — AbortSignal 도 무시한다(계약 위반 구현 방어).
      const brain = { decide: () => new Promise<never>(() => { /* never settles */ }) };
      const res = await runHeadlessGoalLoopPty({
        binRoot: '/repo', cwd: '/wt', featurePrompt: 'x', maxWaitSec: 3, pollMs: 1,
        brain: brain as never, brainTimeoutMs: 5,
        spawn: fake.spawn, ptyAvailable: () => true,
      } as never);
      // ⭐ 루프가 timeout 에 갇히지 않고 완주한다(부모 abort 없이).
      expect(res.ok).toBe(true);
      const fails = logs.filter((l) => l.event === 'brain.fail');
      expect(fails.length).toBeGreaterThan(0);
      expect(String(fails[0]?.data?.error ?? '')).toContain('timeout');
      expect(fails[0]?.data).toMatchObject({ roundContextPresent: false });
      // 상담이 응답하지 않으면 어느 이행 이름도 기록되지 않는다.
      expect(logs.filter((l) => l.event === 'brain.suggestion').length).toBe(0);
      expect(logs.filter((l) => l.event === 'run-supervision.verdict').length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── wall-clock 상한 (리뷰 must-fix + should-fix · 2026-07-26) ────────────────────────
//
// 폴 루프 회계는 `i`(≈초·pollMs≈1000ms 가정) 기반이다. brain 상담이 tick 당 최대 brainTimeoutMs 를
// **직렬 await** 하므로 전이가 **반복**되면 1 tick 이 크게 늘어 maxWaitSec 계약을 수십 배 초과한다.
// 단발 timeout 테스트로는 이 누적을 잡지 못한다(should-fix) — **반복** 상황을 직접 만든다.
describe('runHeadlessGoalLoopPty — 반복 상담의 wall-clock 상한', () => {
  /** 매 render 마다 화면-상태가 바뀌어 **매 tick 전이**가 발생하는 핸들(상담이 계속 트리거된다). */
  function makeFlappingHandle() {
    let renders = 0;
    let kills = 0;
    const handle = {
      id: 'pty_flap', cmd: 'bun', workdir: '/w', startedAt: 0, lastActivityAt: 0, detach: false,
      exitCode: null as number | null, exitSignal: undefined,
      isAlive: () => handle.exitCode === null,
      appendOutput() {},
      drainDelta() { return 'x'; },          // 항상 활동 → soft grace 로는 안 끊긴다
      snapshot: () => '',
      write() {},
      canWrite: () => true,
      kill() { kills += 1; }, resize() {},
      // working ⇄ blocked 를 번갈아 → 매 관측마다 전이
      renderScreen: async () => (renders++ % 2 === 0
        ? '  ⏺ Bash({"cmd":"x"})'
        : 'Do you want to proceed?\n  1. yes\n  2. no'),
      renderScreenPng: async () => null,
    };
    return { handle, spawn: (() => handle) as never, kills: () => kills };
  }

  it('⭐ 매 tick 상담이 timeout 해도 절대 경과시간 상한에서 끊긴다(maxWaitSec 수십 배 초과 금지)', async () => {
    const fake = makeFlappingHandle();
    const startedMs = Date.now();
    const res = await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x',
      pollMs: 1,
      maxWaitSec: 1, maxHardWaitSec: 1,          // 절대 상한 1초
      activityGraceSec: 10_000,                  // 활동-grace 로는 절대 안 끊기게 → wall-clock 만이 유일한 브레이크
      // ⭐ **deadline(1초)보다 훨씬 긴** 상담 예산 — clamp 가 없으면 이 값만큼 상한을 초과한다(리뷰 must-fix 2R).
      brainTimeoutMs: 20_000,
      brain: { decide: () => new Promise<never>(() => { /* never settles · AbortSignal 도 무시 */ }) } as never,
      spawn: fake.spawn, ptyAvailable: () => true,
    } as never);
    const elapsedMs = Date.now() - startedMs;
    // ⭐ 핵심: clamp 가 없으면 첫 상담 하나로 **20초** 매달린다(brainTimeoutMs). clamp 가 있으면 남은 절대
    //    예산(≤1초)으로 묶여 ~1초대에서 끊긴다. 3초면 clamp 부재를 확실히 잡고 CI 흔들림도 견딘다.
    // ⚠️ 실시간 경계 의존(리뷰 should-fix) — deadline 1초 대비 3초 여유는 느린 CI 를 견디되 clamp 부재
    //    (20초)는 확실히 잡는 폭이다. 이 테스트가 CI 에서 흔들리면 **여유를 늘리지 말고** deadline·
    //    brainTimeoutMs 의 비(1:20)를 유지한 채 두 값을 함께 키워라(비를 줄이면 검출력이 사라진다).
    expect(elapsedMs).toBeLessThan(3_000);
    expect(res.timedOut).toBe(true);
    expect(fake.kills()).toBeGreaterThan(0);     // finally 정리
  }, 30_000);
});

describe('runHeadlessGoalLoopPty — in-round judge context', () => {
  it('round context reaches the judge, bounds an oversized failure, and records its presence without gaining authority', async () => {
    let seen: Record<string, unknown> | undefined;
    let suggestion: Record<string, unknown> | undefined;
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.suggestion') suggestion = data;
    }) as never);
    try {
      const fake = makeBrainHandle();
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 10,
        spawn: fake.spawn, ptyAvailable: () => true,
        roundContext: { round: 4, effectiveMax: 5, previousRoundFailure: 'F'.repeat(900) },
        brain: { decide: (obs) => { seen = obs as unknown as Record<string, unknown>; return { action: 'input', text: 'never write' }; } },
      });
      const context = seen?.roundContext as Record<string, unknown>;
      expect(context).toMatchObject({ round: 4, effectiveMax: 5 });
      expect(String(context.previousRoundFailure)).toContain('[truncated: 300 chars omitted]');
      expect(String(context.previousRoundFailure).length).toBeLessThan(700);
      expect(suggestion).toMatchObject({ roundContextPresent: true, round: 4, effectiveMax: 5, previousRoundFailureTruncated: true, applied: false });
      expect(fake.writes()).toBe(0);
      expect(result.reachedCompletion).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('context-present brain failures record that context before continuing fail-soft', async () => {
    const fake = makeBrainHandle();
    const logs: { event: string; data?: Record<string, unknown> }[] = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      logs.push({ event, ...(data ? { data } : {}) });
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 10,
        spawn: fake.spawn, ptyAvailable: () => true,
        roundContext: { round: 2, effectiveMax: 4, previousRoundFailure: 'gate failed' },
        brain: { decide: () => { throw new Error('brain boom'); } },
      });
      expect(result.reachedCompletion).toBe(true);
      expect(logs.find((log) => log.event === 'brain.fail')?.data).toMatchObject({ roundContextPresent: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('absent round context preserves the prior judge input, observation, and completion behavior', async () => {
    let seen: Record<string, unknown> | undefined;
    let suggestion: Record<string, unknown> | undefined;
    const spy = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.suggestion') suggestion = data;
    }) as never);
    try {
      const fake = makeBrainHandle();
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 10,
        spawn: fake.spawn, ptyAvailable: () => true,
        brain: { decide: (obs) => { seen = obs as unknown as Record<string, unknown>; return { action: 'done', reason: 'suggestion only' }; } },
      });
      expect(seen?.roundContext).toBeUndefined();
      expect(suggestion).toMatchObject({ roundContextPresent: false, applied: false });
      expect(suggestion?.round).toBeUndefined();
      expect(fake.writes()).toBe(0);
      expect(result.reachedCompletion).toBe(true);
      expect(fake.polls()).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });
});
