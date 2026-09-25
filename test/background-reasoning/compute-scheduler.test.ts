// Y2 compute scheduler · local-only happy path + cloud fallback + queue drain
// + user-activity pause/resume.

import { describe, expect, test } from 'bun:test';
import {
  BudgetAwareRouter,
  type BudgetUsageProbe,
} from '../../src/background-reasoning/budget-aware-router';
import {
  DEFAULT_BACKGROUND_REASONING_CONFIG,
  type BackgroundReasoningConfig,
} from '../../src/background-reasoning/config';
import {
  ComputeScheduler,
  type BackgroundTask,
} from '../../src/background-reasoning/compute-scheduler';
import {
  LocalLLMPool,
  type LocalSlotAssignment,
  type SlotRole,
} from '../../src/background-reasoning/local-llm-process';
import {
  UserActivityMonitor,
  type CpuSampler,
} from '../../src/background-reasoning/user-activity-monitor';

function assignment(role: SlotRole): LocalSlotAssignment {
  return {
    nodeId: 'self',
    modelId: role === 'patcher' ? 'qwen-7b' : 'qwen-32b',
    baseUrl: 'http://127.0.0.1:1234/v1',
    role,
  };
}

function buildScheduler(over: {
  config?: Partial<BackgroundReasoningConfig>;
  cloudUsd?: number;
  poolSize?: number;
  monitor?: UserActivityMonitor;
} = {}): { sched: ComputeScheduler; pool: LocalLLMPool } {
  const config = { ...DEFAULT_BACKGROUND_REASONING_CONFIG, ...over.config };
  const probe: BudgetUsageProbe = { monthlyCloudUsd: () => over.cloudUsd ?? 0 };
  const pool = new LocalLLMPool({ size: over.poolSize ?? 2 });
  const router = new BudgetAwareRouter({ config, probe });
  const sched = new ComputeScheduler({
    config,
    pool,
    router,
    defaultAssignment: assignment,
    ...(over.monitor ? { monitor: over.monitor } : {}),
  });
  return { sched, pool };
}

function task<TOut>(role: SlotRole, runLocal: () => Promise<TOut>, runCloud?: () => Promise<TOut>): BackgroundTask<undefined, TOut> {
  const t: BackgroundTask<undefined, TOut> = {
    id: `${role}-task`,
    role,
    input: undefined,
    runLocal: async () => runLocal(),
  };
  if (runCloud) t.runCloud = async () => runCloud();
  return t;
}

describe('ComputeScheduler', () => {
  test('local route on free slot', async () => {
    const { sched } = buildScheduler();
    const out = await sched.schedule(task('patcher', async () => 'ok'));
    expect(out.status).toBe('local');
    if (out.status === 'local') {
      expect(out.result).toBe('ok');
      expect(out.route.decision).toBe('local');
    }
  });

  test('cloud route when pool saturated and role allows cloud', async () => {
    const { sched, pool } = buildScheduler({ poolSize: 1 });
    pool.all()[0]!.assign(assignment('patcher'));
    pool.all()[0]!.pause(); // simulate busy / paused
    const out = await sched.schedule(task('thinker', async () => 'local', async () => 'cloud'));
    expect(out.status).toBe('cloud');
    if (out.status === 'cloud') {
      expect(out.result).toBe('cloud');
    }
  });

  test('queue when local saturated and cloud disabled for role', async () => {
    const { sched, pool } = buildScheduler({ poolSize: 1 });
    pool.all()[0]!.assign(assignment('patcher'));
    pool.all()[0]!.pause();
    // patcher cloud disabled by default → must queue (promise pending until drain)
    let resolved = false;
    const p = sched.schedule(task('patcher', async () => 'late')).then((o) => { resolved = true; return o; });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    pool.all()[0]!.resume();
    pool.all()[0]!.release();
    // trigger drain via a second schedule call (drain runs after each local run)
    const driver = await sched.schedule(task('patcher', async () => 'driver'));
    expect(driver.status).toBe('local');
    const out = await p;
    expect(out.status).toBe('local');
    if (out.status === 'local') expect(out.result).toBe('late');
  });

  test('rejected when cloud route but no runCloud', async () => {
    const { sched, pool } = buildScheduler({ poolSize: 1 });
    pool.all()[0]!.assign(assignment('thinker'));
    pool.all()[0]!.pause();
    const out = await sched.schedule(task('thinker', async () => 'x'));
    expect(out.status).toBe('rejected');
    if (out.status === 'rejected') expect(out.reason).toMatch(/no-runCloud/);
  });

  test('user-active pauses pool; idle resumes + drains', async () => {
    let cpu = 0;
    const sampler: CpuSampler = { load: () => cpu };
    const monitor = new UserActivityMonitor({ threshold: 0.7, hysteresis: 0.2, sampler });
    const { sched } = buildScheduler({ poolSize: 1, monitor });

    cpu = 0.9;
    monitor.sample();
    expect(sched.isPaused()).toBe(true);

    const p = sched.schedule(task('patcher', async () => 'done'));
    await new Promise((r) => setTimeout(r, 5));
    expect(sched.pendingCount()).toBe(1);

    cpu = 0.1;
    monitor.sample();
    expect(sched.isPaused()).toBe(false);
    const out = await p;
    expect(out.status).toBe('local');
  });

  test('emergency bypasses exhausted budget', async () => {
    const { sched, pool } = buildScheduler({
      poolSize: 1,
      config: { monthlyCloudMaxUsd: 10, patcherCloudAllowed: false },
      cloudUsd: 20,
    });
    pool.all()[0]!.assign(assignment('patcher'));
    pool.all()[0]!.pause();
    const t = task('patcher', async () => 'local', async () => 'cloud');
    t.emergency = true;
    const out = await sched.schedule(t);
    expect(out.status).toBe('cloud');
  });
});
