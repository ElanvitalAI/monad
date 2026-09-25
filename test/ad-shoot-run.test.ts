import { expect, test } from 'bun:test';
import { buildShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import { runShootPlan, type ShootBackend, type ShootCommand, type ShootPlan } from '../src/ad-pipeline/shoot-run.js';
import { runAdPipeline } from '../src/ad-pipeline/run.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

// ⛔ `ShootCommand` 는 `shoot-plan.ts` 가 주인이다 — 여기서 «다른 모양»을 만들지 않는다.
const cmd = (beatIndex: number, prompt: string): ShootCommand => ({
  beatIndex, jobType: 'seedance_2_0', durationSeconds: 5, args: ['--prompt', prompt],
});
/** ⛔ `ShootCommand` 에 `prompt` 필드는 «없다» — 프롬프트는 `args` 안에 산다(shoot-plan.ts 가 주인). */
const promptOf = (c: ShootCommand): string => c.args[c.args.indexOf('--prompt') + 1] ?? '';

const commands: readonly ShootCommand[] = [
  cmd(0, 'beat one'), cmd(1, 'beat two'), cmd(2, 'beat three'), cmd(3, 'beat four'), cmd(4, 'beat five'),
];

const openPlan = (items = commands): ShootPlan => ({ commands: items, blocked: [], unpriced: [] });

test('preserves successful result URLs and submits commands sequentially', async () => {
  const calls: string[] = [];
  const backend: ShootBackend = {
    submit: async (command) => {
      calls.push(`submit:${promptOf(command)}`);
      return `job-${promptOf(command)}`;
    },
    poll: async (jobId) => {
      calls.push(`poll:${jobId}`);
      return { status: 'completed', resultUrl: `https://video.test/${jobId}.mp4` };
    },
  };

  const result = await runShootPlan(openPlan(commands.slice(0, 2)), backend, { submitStaggerMs: 0 });

  // ⛔⭐ 초판은 «제출→폴링→제출→폴링» 이었다. 지금은 «다 제출한 뒤 폴링»이다.
  //    📏 근거(플레이북): "--wait 는 블로킹이다. 샷 4개를 순차로 기다리면 20분이 그냥 간다."
  expect(calls).toEqual([
    'submit:beat one', 'submit:beat two',
    'poll:job-beat one', 'poll:job-beat two',
  ]);
  expect(result).toEqual({
    outcomes: [
      { beatIndex: 0, jobId: 'job-beat one', resultUrl: 'https://video.test/job-beat one.mp4' },
      { beatIndex: 1, jobId: 'job-beat two', resultUrl: 'https://video.test/job-beat two.mp4' },
    ],
    completed: 2,
    failed: 0,
    unknown: 0,
    timedOut: [],
    blocked: 0,
  });
});

test('runAdPipeline preserves successful result URLs without polling reasons', async () => {
  const scene: SceneSpec = {
    beats: [{ role: 'hook', startSec: 0, endSec: 2, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'successful shot', checks: [] }],
    axes: { hook: 'success', totalSeconds: 2, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
    aspectRatio: '9:16',
    forbidden: [],
    provenance: 'generated',
  };
  const result = await runAdPipeline({ kind: 'text', brief: 'successful shot' }, {
    approve: () => true,
    stage: () => {},
    onGrounding: () => {},
    production: {
      cut: { submit: async () => 'successful-job', poll: async () => ({ status: 'completed', resultUrl: 'https://video.test/successful.mp4' }) },
      durationRules: { model: { minimumSeconds: 2 } },
      creditsPerSecond: { model: 1 },
      referenceAssets: {},
      referenceDelivery: { model: { kind: 'repeated', flag: '--image-references' } },
      shootRunOptions: { submitStaggerMs: 0, submitRetries: 0, maxPollsPerJob: 1 },
      assembly: { scene, clips: [] },
    },
  });

  if (result.status !== 'gates-approved') throw new Error('Expected approved gates for successful shooting.');
  expect(result.shootAssets).toEqual([{ beatIndex: 0, jobId: 'successful-job', resultUrl: 'https://video.test/successful.mp4' }]);
  expect(result.shootAssets?.[0]).not.toHaveProperty('limitedBy');
  expect(result.shootAssets?.[0]).not.toHaveProperty('pollingLimits');
  expect(result.shootAssets?.[0]).not.toHaveProperty('unobservedPolling');
});

test('runAdPipeline keeps elapsed polling limits distinct from unknown vendor status', async () => {
  const scene: SceneSpec = {
    beats: [
      { role: 'hook', startSec: 0, endSec: 2, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'elapsed shot', checks: [] },
      { role: 'transition', startSec: 2, endSec: 4, emotion: { primary: 'calm', secondary: 'clear' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'unknown shot', checks: [] },
    ],
    axes: { hook: 'polling', totalSeconds: 4, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
    aspectRatio: '9:16',
    forbidden: [],
    provenance: 'generated',
  };
  const result = await runAdPipeline({ kind: 'text', brief: 'polling outcomes' }, {
    approve: () => true,
    stage: () => {},
    onGrounding: () => {},
    production: {
      cut: {
        submit: async (command) => `job-${command.beatIndex}`,
        poll: async (jobId) => jobId === 'job-0'
          ? new Promise(() => {})
          : { status: 'vendor-unknown' },
      },
      durationRules: { model: { minimumSeconds: 2 } },
      creditsPerSecond: { model: 1 },
      referenceAssets: {},
      referenceDelivery: { model: { kind: 'repeated', flag: '--image-references' } },
      shootRunOptions: { submitStaggerMs: 0, submitRetries: 0, maxPollsPerJob: 1, maxPollElapsedMs: 10 },
      assembly: { scene, clips: [] },
    },
  });

  if (result.status !== 'gates-approved') throw new Error('Expected approved gates for polling outcomes.');
  expect(result.shootAssets).toEqual([
    { beatIndex: 0, jobId: 'job-0', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 1, pollIntervalMs: 0, maxPollElapsedMs: 10 } },
    { beatIndex: 1, jobId: 'job-1', unknownStatus: 'vendor-unknown' },
  ]);
});

test('continues after submit and explicit poll failures, retaining each failure reason', async () => {
  const submitted: string[] = [];
  const backend: ShootBackend = {
    submit: async (command) => {
      submitted.push(promptOf(command));
      if (promptOf(command) === 'beat two') throw new Error('credit rejected');
      return `job-${promptOf(command)}`;
    },
    poll: async (jobId) => {
      if (jobId === 'job-beat three') return { status: 'failed' };
      return { status: 'completed', resultUrl: `https://video.test/${jobId}.mp4` };
    },
  };

  const result = await runShootPlan(openPlan(), backend, { submitStaggerMs: 0 });

  // ⛔⭐ `beat two` 가 «두 번» 뜬다 — 제출 실패를 «재시도»하기 때문이다(기본 1회).
  //    ✅ 실패는 크레딧을 «안 깎으므로» 재시도가 싸다(플레이북 실측 2회 확인).
  //    ⇒ 「한 번씩만 제출」을 기대하면 그 규율이 사라진다. 재시도를 «끄고» 그 축을 따로 묻는다.
  expect(submitted.filter((p, i) => submitted.indexOf(p) === i)).toEqual(commands.map(promptOf));
  expect(submitted.filter((p) => p === 'beat two')).toHaveLength(2);
  expect(result.completed).toBe(3);
  expect(result.failed).toBe(2);
  expect(result.timedOut).toEqual([]);
  expect(result.outcomes).toEqual([
    { beatIndex: 0, jobId: 'job-beat one', resultUrl: 'https://video.test/job-beat one.mp4' },
    { beatIndex: 1, failure: 'credit rejected' },
    { beatIndex: 2, jobId: 'job-beat three', failure: 'Job job-beat three reported failed.' },
    { beatIndex: 3, jobId: 'job-beat four', resultUrl: 'https://video.test/job-beat four.mp4' },
    { beatIndex: 4, jobId: 'job-beat five', resultUrl: 'https://video.test/job-beat five.mp4' },
  ]);
});

test('retries a transient polling error until the job completes', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'recovering-job',
    poll: async () => {
      polls += 1;
      if (polls === 1) throw new Error('poll transport unavailable');
      return { status: 'completed', resultUrl: 'https://video.test/recovering-job.mp4' };
    },
  }, { maxPollsPerJob: 3 });

  expect(polls).toBe(2);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'recovering-job', resultUrl: 'https://video.test/recovering-job.mp4' }],
    completed: 1,
    failed: 0,
    unknown: 0,
    timedOut: [],
    blocked: 0,
  });
});

test('reports attempt-limited polling errors without a known ongoing status as unobserved', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'unreachable-job',
    poll: async () => {
      polls += 1;
      throw new Error('poll transport unavailable');
    },
  }, { maxPollsPerJob: 3 });

  expect(polls).toBe(3);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'unreachable-job', unobservedPolling: true, limitedBy: 'attempts', pollingLimits: { maxPollsPerJob: 3, pollIntervalMs: 0 } }],
    completed: 0,
    failed: 0,
    unknown: 1,
    timedOut: [],
    blocked: 0,
  });
});

test('reports elapsed-limited polling timeouts separately from attempt limits', async () => {
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'slow-job',
    poll: async () => ({ status: 'queued' }),
  }, { maxPollsPerJob: 3, maxPollElapsedMs: 10, pollIntervalMs: 60_000, submitStaggerMs: 0 });

  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'slow-job', limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 3, pollIntervalMs: 60_000, maxPollElapsedMs: 10 } }],
    completed: 0,
    failed: 0,
    unknown: 0,
    timedOut: [0],
    blocked: 0,
  });
});

test('reports an unsettled poll without a known ongoing status as unobserved', async () => {
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'hung-job',
    poll: async () => new Promise(() => {}),
  }, { maxPollElapsedMs: 10, submitStaggerMs: 0 });

  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'hung-job', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 20, pollIntervalMs: 0, maxPollElapsedMs: 10 } }],
    completed: 0,
    failed: 0,
    unknown: 1,
    timedOut: [],
    blocked: 0,
  });
});

test('does not prematurely time out polling when the elapsed limit exceeds one timer delay', async () => {
  const realDateNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let now = 0;
  const delays: number[] = [];
  const timers: (() => void)[] = [];
  let pollCompleted!: () => void;
  const pollResult = new Promise<{ readonly status: string }>((resolve) => { pollCompleted = () => resolve({ status: 'completed' }); });
  Date.now = () => now;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    delays.push(delay ?? 0);
    timers.push(callback as () => void);
    return {} as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
  try {
    const resultPromise = runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'long-deadline-job',
      poll: async () => pollResult,
    }, { maxPollElapsedMs: 2_147_483_648, submitStaggerMs: 0 });

    await Promise.resolve();
    await Promise.resolve();
    expect(delays).toEqual([2_147_483_647]);
    now = 2_147_483_647;
    timers.shift()!();
    expect(delays).toEqual([2_147_483_647, 1]);
    pollCompleted();
    const result = await resultPromise;

    expect(result).toEqual({
      outcomes: [{ beatIndex: 0, jobId: 'long-deadline-job' }],
      completed: 1,
      failed: 0,
      unknown: 0,
      timedOut: [],
      blocked: 0,
    });
  } finally {
    Date.now = realDateNow;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('times out immediately when synchronous poll work reaches the elapsed deadline before returning an unsettled promise', async () => {
  const realDateNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'late-unsettled-job',
      poll: () => {
        now = 15;
        return new Promise(() => {});
      },
    }, { maxPollElapsedMs: 10, submitStaggerMs: 0 });

    expect(result).toEqual({
      outcomes: [{ beatIndex: 0, jobId: 'late-unsettled-job', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 20, pollIntervalMs: 0, maxPollElapsedMs: 10 } }],
      completed: 0,
      failed: 0,
      unknown: 1,
      timedOut: [],
      blocked: 0,
    });
  } finally {
    Date.now = realDateNow;
  }
});

test.each(['rejection', 'exception'] as const)('uses elapsed limit after a poll %s reaches the deadline', async (kind) => {
  const realDateNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'late-error-job',
      poll: () => {
        now = 15;
        if (kind === 'exception') throw new Error('late synchronous error');
        return Promise.reject(new Error('late rejection'));
      },
    }, { maxPollsPerJob: 1, maxPollElapsedMs: 10, submitStaggerMs: 0 });

    expect(result).toEqual({
      outcomes: [{ beatIndex: 0, jobId: 'late-error-job', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 1, pollIntervalMs: 0, maxPollElapsedMs: 10 } }],
      completed: 0,
      failed: 0,
      unknown: 1,
      timedOut: [],
      blocked: 0,
    });
  } finally {
    Date.now = realDateNow;
  }
});

test('does not start polling when the elapsed deadline expires between time checks', async () => {
  const realDateNow = Date.now;
  const clock = [0, 0, 10];
  let polls = 0;
  Date.now = () => clock.shift() ?? 10;
  try {
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'expired-before-poll-job',
      poll: async () => {
        polls += 1;
        throw new Error('must not be called after deadline');
      },
    }, { maxPollElapsedMs: 10, submitStaggerMs: 0 });

    expect(polls).toBe(0);
    expect(result).toEqual({
      outcomes: [{ beatIndex: 0, jobId: 'expired-before-poll-job', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 20, pollIntervalMs: 0, maxPollElapsedMs: 10 } }],
      completed: 0,
      failed: 0,
      unknown: 1,
      timedOut: [],
      blocked: 0,
    });
  } finally {
    Date.now = realDateNow;
  }
});

test('times out a completed poll response that arrives after the absolute elapsed deadline', async () => {
  const realDateNow = Date.now;
  const clock = [0, 0, 0, 15];
  Date.now = () => clock.shift() ?? 15;
  try {
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'late-completed-job',
      poll: () => Promise.resolve({ status: 'completed', resultUrl: 'https://video.test/late-completed-job.mp4' }),
    }, { maxPollElapsedMs: 10, submitStaggerMs: 0 });

    expect(result).toEqual({
      outcomes: [{ beatIndex: 0, jobId: 'late-completed-job', unobservedPolling: true, limitedBy: 'elapsed', pollingLimits: { maxPollsPerJob: 20, pollIntervalMs: 0, maxPollElapsedMs: 10 } }],
      completed: 0,
      failed: 0,
      unknown: 1,
      timedOut: [],
      blocked: 0,
    });
  } finally {
    Date.now = realDateNow;
  }
});

test('returns bounded queued jobs as timeouts rather than failures', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'queued-job',
    poll: async () => {
      polls += 1;
      return { status: 'queued' };
    },
  }, { maxPollsPerJob: 3 });

  expect(polls).toBe(3);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'queued-job', limitedBy: 'attempts', pollingLimits: { maxPollsPerJob: 3, pollIntervalMs: 0 } }],
    completed: 0,
    failed: 0,
    unknown: 0,
    timedOut: [0],
    blocked: 0,
  });
});

test.each([Infinity, NaN, -1, 1.5, 0])('rejects invalid maxPollsPerJob %p before submission', async (maxPollsPerJob) => {
  let submissions = 0;
  const backend: ShootBackend = {
    submit: async () => {
      submissions += 1;
      return 'should-not-submit';
    },
    poll: async () => ({ status: 'queued' }),
  };

  await expect(runShootPlan(openPlan(commands.slice(0, 1)), backend, { maxPollsPerJob })).rejects.toThrow(
    'maxPollsPerJob must be a finite positive integer.',
  );
  expect(submissions).toBe(0);
});

test('runs the retained commands from buildShootPlan and preserves its blocked beat', async () => {
  const scene: SceneSpec = {
    beats: [
      { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'calm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model-a', audio: false, promptCore: 'first', checks: [] },
      { role: 'buildup', startSec: 5, endSec: 10, emotion: { primary: 'hope', secondary: 'warmth' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'model-a', audio: false, promptCore: '', checks: [] },
      { role: 'climax', startSec: 10, endSec: 15, emotion: { primary: 'joy', secondary: 'energy' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'model-a', audio: false, promptCore: 'third', checks: [] },
    ],
    axes: { hook: 'Product', totalSeconds: 15, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
    aspectRatio: '9:16',
    forbidden: [],
    provenance: 'generated',
  };
  const plan = buildShootPlan(scene, { mode: 'quality', minGeneratableSeconds: 4 });
  const submitted: number[] = [];
  const result = await runShootPlan(plan, {
    submit: async (command) => {
      submitted.push(command.beatIndex);
      return `job-${command.beatIndex}`;
    },
    poll: async (jobId) => ({ status: 'completed', resultUrl: `https://video.test/${jobId}.mp4` }),
  }, { submitStaggerMs: 0 });

  expect(submitted).toEqual([0, 2]);
  expect(result.outcomes.map((outcome) => outcome.beatIndex)).toEqual([0, 1, 2]);
  expect(result.outcomes[1]).toEqual({ beatIndex: 1, failure: 'empty-prompt:beat-2' });
  expect(result.completed).toBe(2);
  expect(result.failed).toBe(0);
  expect(result.timedOut).toEqual([]);
  expect(result.blocked).toBe(1);
  expect(result.completed + result.failed + result.timedOut.length + result.blocked).toBe(scene.beats.length);
});

test('executes retained commands and reports a blocked beat at its original index', async () => {
  const submitted: number[] = [];
  const result = await runShootPlan({
    commands: [cmd(0, 'beat one'), cmd(2, 'beat three')],
    unpriced: [1],
    blocked: ['empty-prompt:beat-2'],
  }, {
    submit: async (command) => {
      submitted.push(command.beatIndex);
      return `job-${command.beatIndex}`;
    },
    poll: async (jobId) => ({ status: 'completed', resultUrl: `https://video.test/${jobId}.mp4` }),
  }, { submitStaggerMs: 0 });

  expect(submitted).toEqual([0, 2]);
  expect(result).toEqual({
    outcomes: [
      { beatIndex: 0, jobId: 'job-0', resultUrl: 'https://video.test/job-0.mp4' },
      { beatIndex: 1, failure: 'empty-prompt:beat-2' },
      { beatIndex: 2, jobId: 'job-2', resultUrl: 'https://video.test/job-2.mp4' },
    ],
    completed: 2,
    failed: 0,
    unknown: 0,
    timedOut: [],
    blocked: 1,
  });
});

test('reports the default zero-interval timeout as attempt-limited', async () => {
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'default-queued-job',
    poll: async () => ({ status: 'queued' }),
  });

  expect(result.outcomes).toEqual([{
    beatIndex: 0,
    jobId: 'default-queued-job',
    limitedBy: 'attempts',
    pollingLimits: { maxPollsPerJob: 20, pollIntervalMs: 0 },
  }]);
  expect(result.completed).toBe(0);
  expect(result.failed).toBe(0);
  expect(result.timedOut).toEqual([0]);
  expect(result.blocked).toBe(0);
});

test('does not submit a plan with no commands', async () => {
  let submissions = 0;
  const result = await runShootPlan({ commands: [], unpriced: [0], blocked: ['invalid-min-generatable-seconds'] }, {
    submit: async () => {
      submissions += 1;
      return 'should-not-submit';
    },
    poll: async () => ({ status: 'completed' }),
  });

  expect(submissions).toBe(0);
  expect(result).toEqual({ outcomes: [], completed: 0, failed: 0, unknown: 0, timedOut: [], blocked: 0 });
});

// 🔴 회귀 가드 — 초판은 «한 컷을 끝까지 기다린 뒤» 다음을 제출했고 스태거·재시도가 «없었다».
//    📏 플레이북 실측(2026-09-10): 동시 4건 → 4건 «전부» 실패 · 20~30초 스태거로 통과 ·
//       ✅ 실패는 크레딧을 «안» 깎는다(2회 확인) ⇒ 재시도가 싸다.
const three = (): ShootPlan => ({ commands: commands.slice(0, 3), blocked: [], unpriced: [] });

test('⛔ 제출을 «스태거»한다 — 인접 간격이 0 이 아니다', async () => {
  const at: number[] = [];
  await runShootPlan(three(), {
    submit: async () => { at.push(Date.now()); return `job-${at.length}`; },
    poll: async () => ({ status: 'completed', resultUrl: 'u' }),
  }, { submitStaggerMs: 40, maxPollsPerJob: 2 });
  expect(at).toHaveLength(3);
  for (let i = 1; i < at.length; i += 1) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(35);
});

test('⛔ 다 던진 «뒤»에 폴링한다 — 마지막 submit 이 첫 poll 보다 «앞»이다', async () => {
  const order: string[] = [];
  await runShootPlan(three(), {
    submit: async () => { order.push('submit'); return `job-${order.length}`; },
    poll: async () => { order.push('poll'); return { status: 'completed', resultUrl: 'u' }; },
  }, { submitStaggerMs: 0, maxPollsPerJob: 2 });
  expect(order.lastIndexOf('submit')).toBeLessThan(order.indexOf('poll'));
});

test('✅ 제출 실패를 «재시도»한다 — 실패는 크레딧을 안 깎으므로 한 번에 포기하지 않는다', async () => {
  let attempts = 0;
  const result = await runShootPlan({ commands: [commands[0]!], unpriced: [], blocked: [] }, {
    submit: async () => { attempts += 1; if (attempts === 1) throw new Error('no response received'); return 'job-1'; },
    poll: async () => ({ status: 'completed', resultUrl: 'u' }),
  }, { submitStaggerMs: 0, submitRetries: 1, maxPollsPerJob: 2 });
  expect(attempts).toBe(2);
  expect(result.completed).toBe(1);
  expect(result.failed).toBe(0);
});

test('allows an unknown waiting status to transition to completed', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'waiting-job',
    poll: async () => {
      polls += 1;
      return polls === 1 ? { status: 'waiting' } : { status: 'completed', resultUrl: 'https://video.test/waiting-job.mp4' };
    },
  }, { maxPollsPerJob: 75, submitStaggerMs: 0 });

  expect(polls).toBe(2);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'waiting-job', resultUrl: 'https://video.test/waiting-job.mp4' }],
    completed: 1,
    failed: 0,
    unknown: 0,
    timedOut: [],
    blocked: 0,
  });
});

test('settles nsfw as a terminal failure without reobservation', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'nsfw-job',
    poll: async () => {
      polls += 1;
      return { status: 'nsfw' };
    },
  }, { maxPollsPerJob: 75, submitStaggerMs: 0 });

  expect(polls).toBe(1);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'nsfw-job', failure: 'Job nsfw-job reported nsfw.' }],
    completed: 0,
    failed: 1,
    unknown: 0,
    timedOut: [],
    blocked: 0,
  });
});

test('uses its separate unknown reobservation budget after the final normal poll', async () => {
  const statuses = ['in_progress', 'waiting', 'completed'];
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'boundary-waiting-job',
    poll: async () => {
      polls += 1;
      const status = statuses.shift()!;
      return status === 'completed' ? { status, resultUrl: 'https://video.test/boundary-waiting-job.mp4' } : { status };
    },
  }, { maxPollsPerJob: 2, submitStaggerMs: 0 });

  expect(polls).toBe(3);
  expect(result.completed).toBe(1);
  expect(result.unknown).toBe(0);
});

test('does not recharge the separate unknown reobservation budget through ongoing statuses', async () => {
  const statuses = ['waiting', 'in_progress', 'waiting', 'in_progress', 'waiting'];
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'alternating-status-job',
    poll: async () => ({ status: statuses[polls++]! }),
  }, { maxPollsPerJob: 75, submitStaggerMs: 0 });

  expect(polls).toBe(5);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'alternating-status-job', unknownStatus: 'waiting' }],
    completed: 0,
    failed: 0,
    unknown: 1,
    timedOut: [],
    blocked: 0,
  });
});

test('keeps unknown recovery independent from small normal polling budgets', async () => {
  for (const maxPollsPerJob of [1, 2]) {
    let polls = 0;
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => `small-budget-${maxPollsPerJob}`,
      poll: async () => {
        polls += 1;
        return polls === 1 ? { status: 'waiting' } : { status: 'completed', resultUrl: 'https://video.test/recovered.mp4' };
      },
    }, { maxPollsPerJob, submitStaggerMs: 0 });

    expect(polls).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.unknown).toBe(0);
  }
});

test('returns to normal polling after waiting resolves to in_progress without recharging unknown recovery', async () => {
  const statuses = ['waiting', 'in_progress', 'in_progress', 'completed'];
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => 'recovered-ongoing-job',
    poll: async () => {
      const status = statuses[polls++]!;
      return status === 'completed' ? { status, resultUrl: 'https://video.test/recovered-ongoing-job.mp4' } : { status };
    },
  }, { maxPollsPerJob: 3, submitStaggerMs: 0 });

  expect(polls).toBe(4);
  expect(result).toEqual({
    outcomes: [{ beatIndex: 0, jobId: 'recovered-ongoing-job', resultUrl: 'https://video.test/recovered-ongoing-job.mp4' }],
    completed: 1,
    failed: 0,
    unknown: 0,
    timedOut: [],
    blocked: 0,
  });
});

test('retains the last unknown vendor status when reobservation expires before polling', async () => {
  let polls = 0;
  const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
    submit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'expired-unknown-wait-job';
    },
    poll: async () => {
      polls += 1;
      return { status: 'waiting' };
    },
  }, { maxPollElapsedMs: 10, pollIntervalMs: 20, submitStaggerMs: 0 });

  expect(polls).toBe(1);
  expect(result.outcomes).toEqual([{ beatIndex: 0, jobId: 'expired-unknown-wait-job', unknownStatus: 'waiting' }]);
  expect(result.unknown).toBe(1);
});

test('retains the last unknown vendor status when its reobservation request expires', async () => {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    let polls = 0;
    const result = await runShootPlan(openPlan(commands.slice(0, 1)), {
      submit: async () => 'expired-unknown-request-job',
      poll: async () => {
        polls += 1;
        if (polls === 1) return { status: 'waiting' };
        now = 10;
        return { status: 'in_progress' };
      },
    }, { maxPollElapsedMs: 10, submitStaggerMs: 0 });

    expect(polls).toBe(2);
    expect(result.outcomes).toEqual([{ beatIndex: 0, jobId: 'expired-unknown-request-job', unknownStatus: 'waiting' }]);
    expect(result.unknown).toBe(1);
  } finally {
    Date.now = originalNow;
  }
});

test('keeps failed and unknown statuses distinct while in_progress reaches its polling limit', async () => {
  const polls = new Map<string, number>();
  const result = await runShootPlan(openPlan(commands.slice(0, 3)), {
    submit: async (command) => `job-${command.beatIndex}`,
    poll: async (jobId) => {
      polls.set(jobId, (polls.get(jobId) ?? 0) + 1);
      if (jobId === 'job-0') return { status: 'failed' };
      if (jobId === 'job-1') return { status: 'nsfw' };
      return { status: 'in_progress' };
    },
  }, { maxPollsPerJob: 3, submitStaggerMs: 0 });

  expect(polls.get('job-0')).toBe(1);
  expect(polls.get('job-1')).toBe(1);
  expect(polls.get('job-2')).toBe(3);
  expect(result).toEqual({
    outcomes: [
      { beatIndex: 0, jobId: 'job-0', failure: 'Job job-0 reported failed.' },
      { beatIndex: 1, jobId: 'job-1', failure: 'Job job-1 reported nsfw.' },
      { beatIndex: 2, jobId: 'job-2', limitedBy: 'attempts', pollingLimits: { maxPollsPerJob: 3, pollIntervalMs: 0 } },
    ],
    completed: 0,
    failed: 2,
    unknown: 0,
    timedOut: [2],
    blocked: 0,
  });
});

test('accounts for completed, failed, timed-out, blocked, and unknown beats', async () => {
  const result = await runShootPlan({
    commands: [cmd(0, 'completed'), cmd(1, 'failed'), cmd(2, 'ongoing'), cmd(4, 'unknown')],
    blocked: ['empty-prompt:beat-4'],
    unpriced: [3],
  }, {
    submit: async (command) => `job-${command.beatIndex}`,
    poll: async (jobId) => {
      if (jobId === 'job-0') return { status: 'completed', resultUrl: 'https://video.test/completed.mp4' };
      if (jobId === 'job-1') return { status: 'failed' };
      if (jobId === 'job-2') return { status: 'queued' };
      return { status: 'weird-unknown' };
    },
  }, { maxPollsPerJob: 2, submitStaggerMs: 0 });

  expect(result.completed).toBe(1);
  expect(result.failed).toBe(1);
  expect(result.unknown).toBe(1);
  expect(result.timedOut).toEqual([2]);
  expect(result.blocked).toBe(1);
  expect(result.completed + result.failed + result.unknown + result.timedOut.length + result.blocked).toBe(5);
});
