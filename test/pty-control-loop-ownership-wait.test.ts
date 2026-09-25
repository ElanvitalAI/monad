import { describe, expect, it, spyOn } from 'bun:test';
import { runPtyControlLoop, type ControlDecision, type PtyControlDeps } from '../src/autopilot/pty-control-loop.js';
import { debug } from '../src/debug/log.js';

type Stance = 'owned' | 'lost' | 'unknown';
const DONE: ControlDecision = { action: 'done', reason: 'complete' };

function stanceSequence(values: Stance[]): () => Stance {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function depsFor(controlStance: PtyControlDeps['controlStance'], extra: Partial<PtyControlDeps> = {}): PtyControlDeps {
  return {
    controlStance,
    observe: () => 'screen',
    inject: () => true,
    classify: () => 'working',
    sleep: async () => {},
    ...extra,
  };
}

function virtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => { time += ms; },
  };
}

function captureLogs(): { events: Array<{ category: string; event: string; data: Record<string, unknown> }>; restore: () => void } {
  const events: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
  const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, data: data ?? {} });
  }) as never);
  return { events, restore: () => log.mockRestore() };
}

async function resumeAt(site: 'step' | 'during-decide' | 'post-decide'): Promise<{ result: unknown; observed: string[]; classified: string[]; decisions: string[]; injected: string[] }> {
  const observed: string[] = [];
  const classified: string[] = [];
  const decisions: string[] = [];
  const injected: string[] = [];
  let control = true;
  let calls = 0;
  let time = 0;
  const controlStance = (): Stance => {
    calls += 1;
    if (site === 'step') return calls === 1 ? 'lost' : 'owned';
    if (site === 'post-decide') return calls === 2 ? 'lost' : 'owned';
    return control ? 'owned' : 'lost';
  };
  // ⚠️ No signal branch. The ownership watcher runs on a REAL timer and never
  // calls this seam, so a `signal`-aware branch here would be unreachable —
  // and the `releaseWatchSleep` handle it used to publish was never set at
  // runtime. `during-decide` therefore relies on the real watcher firing at
  // `watchIntervalMs: 1`, which is the path production actually takes.
  const sleep = (ms: number): Promise<void> => {
    time += ms;
    if (site === 'during-decide') control = true;
    return Promise.resolve();
  };
  const result = await runPtyControlLoop({
    decide: (_obs, signal) => {
      decisions.push(`decision-${decisions.length}`);
      if (site === 'during-decide' && decisions.length === 1) {
        control = false;
        return new Promise<ControlDecision>((resolve) => signal?.addEventListener('abort', () => resolve({ action: 'input', text: 'stale' }), { once: true }));
      }
      return decisions.length === 1 ? { action: 'input', text: 'stale' } : DONE;
    },
  }, depsFor(controlStance, {
    awaitOwnership: { maxWaitMs: 2 },
    watchIntervalMs: 1,
    now: () => time,
    sleep,
    observe: () => { const value = `screen-${observed.length}`; observed.push(value); return value; },
    classify: (screen) => { classified.push(screen); return 'working'; },
    inject: (text) => { injected.push(text); return true; },
  }));
  return { result, observed, classified, decisions, injected };
}

describe('runPtyControlLoop ownership loan wait', () => {
  it("resumes through the explicit 'owned → lost → lost → owned' loan sequence", async () => {
    const observed: string[] = [];
    const decisions: ControlDecision[] = [];
    const injected: string[] = [];
    const clock = virtualClock();
    const result = await runPtyControlLoop({
      decide: () => {
        const decision: ControlDecision = decisions.length === 0
          ? { action: 'input', text: 'stale-before-loan' }
          : DONE;
        decisions.push(decision);
        return decision;
      },
    }, depsFor(stanceSequence(['owned', 'lost', 'lost', 'owned']), {
      awaitOwnership: { maxWaitMs: 3 }, watchIntervalMs: 1,
      now: clock.now, sleep: clock.sleep,
      observe: () => { const screen = `screen-${observed.length}`; observed.push(screen); return screen; },
      inject: (text) => { injected.push(text); return true; },
    }));
    expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 0 });
    expect(observed).toEqual(['screen-0', 'screen-1']);
    expect(decisions).toEqual([{ action: 'input', text: 'stale-before-loan' }, DONE]);
    expect(injected).toEqual([]);
  });

  it.each(['step', 'during-decide', 'post-decide'] as const)('opt-in wait at %s resumes the same step from a fresh observation and discards stale decisions', async (site) => {
    const { result, observed, classified, decisions, injected } = await resumeAt(site);
    expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: site === 'step' ? 1 : 0 });
    expect(decisions).toEqual(['decision-0', 'decision-1']);   // 모든 site 에서 동일 — 재개 후 반드시 재결정한다
    expect(injected).toEqual(site === 'step' ? ['stale'] : []);
    expect(observed).toEqual(site === 'step' ? ['screen-0', 'screen-1'] : ['screen-0', 'screen-1']);
    expect(classified).toEqual(observed);
  });

  // ⚠️ A wait that ENTERED as `lost` and then hit an unverifiable probe ends for
  // a different reason than the deadline. Recording both as `expired` sends a
  // diagnosis after the wrong thing (someone lengthens the deadline). Nothing
  // pinned this, so reverting the split would have passed silently.
  it("a wait broken by an unverifiable probe records 'unverifiable', not 'expired'", async () => {
    const { events, restore } = captureLogs();
    try {
      // owned → (step gate sees) lost → wait probes → unknown
      const stances: Stance[] = ['lost', 'unknown'];
      let i = 0;
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(
        () => stances[Math.min(i++, stances.length - 1)]!,
        { awaitOwnership: { maxWaitMs: 50 }, watchIntervalMs: 1, sleep: async () => {} },
      ), { maxSteps: 2, pollMs: 0 });
      expect((result as { termination: { kind: string } }).termination).toEqual({ kind: 'cancelled' });
      const ends = events.filter(({ event }) => event === 'ownership-wait-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]!.data.ended).toBe('unverifiable');
      expect(ends[0]!.data.stance).toBe('unknown');
    } finally { restore(); }
  }, 5_000);

  it('unknown cancels immediately and never starts an ownership wait', async () => {
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'unknown', {
        awaitOwnership: { maxWaitMs: 10 }, watchIntervalMs: 1,
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(events.filter(({ event }) => event.startsWith('ownership-wait'))).toEqual([]);
    } finally { restore(); }
  });

  it('stops waiting immediately when a lost probe becomes unknown and yields using the current stance', async () => {
    const sleeps: number[] = [];
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(stanceSequence(['lost', 'unknown']), {
        awaitOwnership: { maxWaitMs: 10 }, watchIntervalMs: 2,
        sleep: async (ms) => { sleeps.push(ms); },
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(sleeps).toEqual([2]);
      expect(events.find(({ event }) => event === 'yield')).toEqual({
        category: 'autopilot.control', event: 'yield',
        data: {
          step: 0, stance: 'unknown',
          reason: 'control ownership unverifiable (step) — 조회 실패라 takeover 여부를 단정할 수 없다',
          supervisionVerdict: 'abandon',
        },
      });
    } finally { restore(); }
  });

  it('expires a bounded lost-ownership wait, emits one complete wait observation pair, and preserves cancelled shape', async () => {
    const sleeps: number[] = [];
    const clock = virtualClock();
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'lost', {
        awaitOwnership: { maxWaitMs: 3 }, watchIntervalMs: 2, now: clock.now,
        sleep: async (ms) => { sleeps.push(ms); await clock.sleep(ms); },
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(sleeps).toEqual([2, 1]);
      const waits = events.filter(({ event }) => event.startsWith('ownership-wait'));
      expect(waits).toEqual([
        { category: 'autopilot.control', event: 'ownership-wait-start', data: { step: 0, stance: 'lost', waitedMs: 0 } },
        { category: 'autopilot.control', event: 'ownership-wait-end', data: { step: 0, stance: 'lost', waitedMs: 3, ended: 'expired' } },
      ]);
    } finally { restore(); }
  });

  it('deadline keeps the last blocking stance when the next probe would return owned', async () => {
    const clock = virtualClock();
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(stanceSequence(['lost', 'lost', 'owned']), {
        awaitOwnership: { maxWaitMs: 1 }, watchIntervalMs: 1, now: clock.now, sleep: clock.sleep,
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(events.find(({ event }) => event === 'ownership-wait-end')).toEqual({
        category: 'autopilot.control', event: 'ownership-wait-end',
        data: { step: 0, stance: 'lost', waitedMs: 1, ended: 'expired' },
      });
      expect(events.find(({ event }) => event === 'yield')?.data.stance).toBe('lost');
    } finally { restore(); }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 2_147_483_648])(
    'invalid maxWaitMs %p fails closed without entering wait', async (maxWaitMs) => {
      let sleeps = 0;
      const { events, restore } = captureLogs();
      try {
        const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'lost', {
          awaitOwnership: { maxWaitMs }, watchIntervalMs: 1,
          sleep: async () => { sleeps += 1; },
        }));
        expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
        expect(sleeps).toBe(0);
        expect(events.filter(({ event }) => event.startsWith('ownership-wait'))).toEqual([]);
      } finally { restore(); }
    },
  );

  it('an invalid injected cadence disables waiting rather than arming a fallback cadence', async () => {
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'lost', {
        awaitOwnership: { maxWaitMs: 10 }, watchIntervalMs: Number.MIN_VALUE,
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(events.filter(({ event }) => event.startsWith('ownership-wait'))).toEqual([]);
    } finally { restore(); }
  });

  it('the internal hard deadline expires even when now is frozen and injected sleep never settles', async () => {
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'lost', {
        awaitOwnership: { maxWaitMs: 5 }, watchIntervalMs: 1,
        now: () => 0,
        sleep: () => new Promise<void>(() => {}),
      }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(events.find(({ event }) => event === 'ownership-wait-end')).toEqual({
        category: 'autopilot.control', event: 'ownership-wait-end',
        data: { step: 0, stance: 'lost', waitedMs: 5, ended: 'expired' },
      });
    } finally { restore(); }
  }, 5_000);   // ⚠️ 실 타이머 경로 — 부하 큰 CI 여유. 무한 회귀는 여전히 잡힌다(뮤테이션은 100초+ 소모)

  it('resumed wait emits exactly one autopilot.control start/end pair with required fields', async () => {
    const { events, restore } = captureLogs();
    try {
      await resumeAt('post-decide');
      const waits = events.filter(({ event }) => event.startsWith('ownership-wait'));
      expect(waits).toEqual([
        { category: 'autopilot.control', event: 'ownership-wait-start', data: { step: 0, stance: 'lost', waitedMs: 0 } },
        { category: 'autopilot.control', event: 'ownership-wait-end', data: { step: 0, stance: 'owned', waitedMs: 1, ended: 'resumed' } },
      ]);
    } finally { restore(); }
  });

  it('does not await a signal-unaware watcher sleep after a normal default-OFF decision', async () => {
    const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(() => 'owned', {
      watchIntervalMs: 1,
      sleep: (_ms: number) => new Promise<void>(() => {}),
    }));
    expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 0 });
  }, 5_000);   // ⚠️ 실 타이머 경로 — 부하 큰 CI 여유. 무한 회귀는 여전히 잡힌다(뮤테이션은 100초+ 소모)

  it('default-OFF preserves the legacy step when the ordinary poll sleep rejects', async () => {
    const result = await runPtyControlLoop({ decide: () => ({ action: 'input', text: 'go' }) }, depsFor(() => 'owned', {
      // 이제 주입 sleep 은 폴에만 쓰이므로 조건 없이 던진다 — signal 로 갈래를 나누던
      // 것은 watcher 가 이 seam 을 타던 시절의 잔재였다.
      sleep: async () => { throw new Error('poll failed'); },
    }));
    expect(result).toEqual({ termination: { kind: 'error', message: 'poll failed' }, steps: 0 });
  });

  it.each([
    ['step', stanceSequence(['lost'])],
    ['during-decide', stanceSequence(['owned', 'lost'])],
    ['post-decide', stanceSequence(['owned', 'lost'])],
  ] as const)('default OFF preserves the exact legacy yield at %s', async (site, controlStance) => {
    const { events, restore } = captureLogs();
    try {
      // ⚠️ Same rule as `resumeAt`: the watcher never calls this seam, so a
      // signal-aware branch would be dead. `during-decide` is driven by the
      // real watcher at `watchIntervalMs: 1`.
      const sleep = async (): Promise<void> => {};
      const brain = site === 'during-decide'
        ? { decide: (_obs: unknown, signal?: AbortSignal) => new Promise<ControlDecision>((resolve) => signal?.addEventListener('abort', () => resolve(DONE), { once: true })) }
        : { decide: () => DONE };
      const result = await runPtyControlLoop(brain, depsFor(controlStance, { watchIntervalMs: 1, sleep }));
      expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      const yieldEvent = events.find(({ event }) => event === 'yield');
      expect(yieldEvent).toEqual({
        category: 'autopilot.control', event: 'yield',
        data: {
          step: 0, stance: 'lost', reason: `lost write control (${site}) — 사람 takeover`,
          supervisionVerdict: 'abandon',
        },
      });
      expect(events.filter(({ event }) => event.startsWith('ownership-wait'))).toEqual([]);
    } finally { restore(); }
  });

  // ⚠️ The default-OFF path must not merely *look* unchanged — the ownership
  // watcher runs on a REAL timer, deliberately independent of the injected
  // sleep, and the other OFF tests inject a sleep that neither rejects nor
  // resolves eagerly, so neither shape is covered.
  //
  // ⚠️ Their protection is NOT equal, and the comment should not pretend it is:
  //   - the eager-resolve test is the load-bearing one — routing the watcher
  //     back through `deps.sleep` fails it, because the watcher then consumes
  //     the injected clock.
  //   - the rejecting-sleep test does NOT fail under that same mutation, since
  //     `watchTask.catch` absorbs the rejection. It pins the weaker property
  //     that a rejecting injected sleep never surfaces as an `error`
  //     termination — a guard against removing that catch, not against the
  //     watcher's timer source.
  // ⚠️ The gap this closes: resuming uses `continue`, which deliberately does
  // NOT consume the step budget (a resumed step redoes its own work). Under a
  // flapping owner — lost, owned, lost, owned … — that made the loop unbounded:
  // the wait itself was bounded, but the NUMBER of waits was not. Asserting
  // only a single resume, as the other tests do, silently licensed that.
  it('a flapping owner cannot loop forever — resumes carry their own budget', async () => {
    let calls = 0;
    // Never settles into a decision: every probe alternates, so without a
    // resume budget this loop has no exit at all.
    const flapping = (): Stance => { calls += 1; return calls % 2 === 1 ? 'lost' : 'owned'; };
    const { events, restore } = captureLogs();
    try {
      const result = await runPtyControlLoop({ decide: () => ({ action: 'wait' }) }, depsFor(flapping, {
        awaitOwnership: { maxWaitMs: 2 },
        watchIntervalMs: 1,
        sleep: async () => {},
      }), { maxSteps: 4, pollMs: 0 });
      // ⚠️ Pin the EXACT terminal, not "any terminal". An earlier draft accepted
      // budget | stuck | cancelled, which would have passed even if the resume
      // budget never fired and some unrelated guard happened to stop the loop —
      // i.e. it asserted termination without asserting the reason for it.
      expect(result).toEqual({
        termination: { kind: 'budget', budget: 'iterations', observed: 5, limit: 4 },
        steps: 0,
      });
      // And the reason must be observable, not merely returned.
      expect(events.filter(({ event }) => event === 'ownership-resume-budget')).toEqual([
        { category: 'autopilot.control', event: 'ownership-resume-budget', data: { step: 0, observed: 5, limit: 4 } },
      ]);
    } finally { restore(); }
  }, 5_000);

  it('default OFF: a rejecting injected sleep does not turn a completed step into an error', async () => {
    const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(
      () => 'owned',
      { sleep: () => Promise.reject(new Error('injected sleep rejects')) },
    ));
    expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 0 });
  });

  it('default OFF: an eagerly-resolving injected sleep does not make the watcher steal the decision', async () => {
    let sleeps = 0;
    const result = await runPtyControlLoop({ decide: () => DONE }, depsFor(
      () => 'owned',
      { sleep: async () => { sleeps += 1; } },
    ));
    expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 0 });
    // The watcher must not have consumed the injected clock at all.
    expect(sleeps).toBe(0);
  });
});
