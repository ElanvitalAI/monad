import { expect, test } from 'bun:test';
import { buildShootPlan, type ShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import type { CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import { createHiggsfieldCostRunner, main, preflightShootPlan, renderPreflight } from '../scripts/ad-preflight.js';

const scene: SceneSpec = {
  aspectRatio: '9:16',
  provenance: 'generated',
  forbidden: [],
  axes: { hook: 'product', totalSeconds: 10, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'calm', secondary: 'focus' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model-a', audio: false, promptCore: 'First product shot', checks: [] },
    { role: 'climax', startSec: 5, endSec: 10, emotion: { primary: 'joy', secondary: 'energy' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'model-b', audio: false, promptCore: 'Second product shot', checks: [] },
  ],
};

function plan(): ShootPlan {
  return buildShootPlan(scene, {
    mode: 'quality',
    minGeneratableSeconds: 1,
    creditsPerSecond: { 'model-a': 2, 'model-b': 3 },
  });
}

function fakeRunner(responses: readonly { readonly stdout: string; readonly stderr: string; readonly exitCode: number }[]) {
  const calls: (readonly string[])[] = [];
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv);
      return responses[calls.length - 1] ?? { stdout: '', stderr: 'unexpected call', exitCode: 1 };
    },
  };
  return { runner, calls };
}

test('preflights buildShootPlan output with original args, exact totals, and no create command', async () => {
  const shootPlan = plan();
  const { runner, calls } = fakeRunner([
    { stdout: 'Cost preflight: 10 credits', stderr: '', exitCode: 0 },
    { stdout: 'Cost preflight: 15 credits', stderr: '', exitCode: 0 },
  ]);

  const result = await preflightShootPlan(shootPlan, runner);

  expect(calls).toEqual([
    ['higgsfield', 'generate', 'cost', 'model-a', ...shootPlan.commands[0].args, '--duration', '5'],
    ['higgsfield', 'generate', 'cost', 'model-b', ...shootPlan.commands[1].args, '--duration', '5'],
  ]);
  expect(calls.flat().includes('create')).toBe(false);
  expect(result).toMatchObject({ measuredCredits: 25, plannedCredits: 25, totalsMatch: true, approved: true, invalidCommands: [], unmeasuredCommands: [] });
  expect(renderPreflight(result)).not.toContain('submission');
});

test('records cost errors as invalid commands and does not approve them', async () => {
  const { runner } = fakeRunner([
    { stdout: '', stderr: 'duration must be at least 4', exitCode: 1 },
    { stdout: '15 credits', stderr: '', exitCode: 0 },
  ]);

  const result = await preflightShootPlan(plan(), runner);

  expect(result.invalidCommands).toEqual([{ beatIndex: 0, error: 'duration must be at least 4' }]);
  expect(result.approved).toBe(false);
  expect(renderPreflight(result)).toContain('duration must be at least 4');
});

test('records a rejected cost query and continues measuring later commands', async () => {
  const calls: (readonly string[])[] = [];
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv);
      if (calls.length === 1) throw new Error('higgsfield executable not found');
      return { stdout: '15 credits', stderr: '', exitCode: 0 };
    },
  };

  const result = await preflightShootPlan(plan(), runner);

  expect(calls).toHaveLength(2);
  expect(result.invalidCommands).toEqual([{ beatIndex: 0, error: 'higgsfield executable not found' }]);
  expect(result.measuredCredits).toBeUndefined();
  expect(result.partialMeasuredCredits).toBe(15);
  expect(result.totalsMatch).toBeUndefined();
  expect(renderPreflight(result)).toContain('측정 합계: 측정 불가');
  expect(renderPreflight(result)).toContain('부분 측정 합계: 15 cr');
});

test.each(['1,000 credits', '1e3 credits'])('rejects unsupported credit notation rather than parsing a partial value: %s', async (stdout) => {
  const { runner } = fakeRunner([
    { stdout, stderr: '', exitCode: 0 },
    { stdout: '15 credits', stderr: '', exitCode: 0 },
  ]);

  const result = await preflightShootPlan(plan(), runner);

  expect(result.invalidCommands).toEqual([{ beatIndex: 0, error: 'generate cost returned no readable credit amount.' }]);
  expect(result.partialMeasuredCredits).toBe(15);
  expect(result.measuredCredits).toBeUndefined();
  expect(result.totalsMatch).toBeUndefined();
  expect(result.approved).toBe(false);
});

test('reports a mismatched total without throwing', async () => {
  const { runner } = fakeRunner([
    { stdout: '9.5 credits', stderr: '', exitCode: 0 },
    { stdout: '15 credits', stderr: '', exitCode: 0 },
  ]);

  const result = await preflightShootPlan(plan(), runner);

  expect(result).toMatchObject({ measuredCredits: 24.5, plannedCredits: 25, totalsMatch: false, approved: false });
});

test('marks RUN workflow commands unmeasured rather than free or approved', async () => {
  const workflowPlan: ShootPlan = {
    commands: [{ beatIndex: 0, jobType: 'RUN', durationSeconds: 5, args: ['workflow', 'cinematic'] }],
    totalEstimatedCredits: 0,
    unpriced: [],
    blocked: [],
  };
  const { runner, calls } = fakeRunner([]);

  const result = await preflightShootPlan(workflowPlan, runner);

  expect(calls).toEqual([]);
  expect(result).toMatchObject({ approved: false });
  expect(result.measuredCredits).toBeUndefined();
  expect(result.totalsMatch).toBeUndefined();
  expect(result.unmeasuredCommands).toEqual(workflowPlan.commands);
  expect(renderPreflight(result)).toContain('측정 합계: 측정 불가');
  expect(renderPreflight(result)).toContain('합계 일치: 측정 불가');
  expect(renderPreflight(result)).toContain('못 잰 beat 1: RUN');
});

test('keeps a partial measurement distinct from a complete total', async () => {
  const partialPlan: ShootPlan = {
    commands: [
      { beatIndex: 0, jobType: 'model-a', durationSeconds: 5, args: ['--prompt', 'measured'] },
      { beatIndex: 1, jobType: 'RUN', durationSeconds: 5, args: ['workflow', 'cinematic'] },
    ],
    totalEstimatedCredits: 10,
    unpriced: [],
    blocked: [],
  };
  const { runner } = fakeRunner([{ stdout: '10 credits', stderr: '', exitCode: 0 }]);

  const result = await preflightShootPlan(partialPlan, runner);

  expect(result.measuredCredits).toBeUndefined();
  expect(result.totalsMatch).toBeUndefined();
  expect(result.unmeasuredCommands).toEqual([partialPlan.commands[1]]);
  expect(renderPreflight(result)).toContain('합계 일치: 측정 불가');
});

test('allows a fully measured zero-credit total without confusing it with unmeasured work', async () => {
  const zeroPlan: ShootPlan = {
    commands: [{ beatIndex: 0, jobType: 'model-a', durationSeconds: 5, args: ['--prompt', 'free'] }],
    totalEstimatedCredits: 0,
    unpriced: [],
    blocked: [],
  };
  const { runner } = fakeRunner([{ stdout: '0 credits', stderr: '', exitCode: 0 }]);

  const result = await preflightShootPlan(zeroPlan, runner);

  expect(result).toMatchObject({ measuredCredits: 0, plannedCredits: 0, totalsMatch: true, approved: true });
  expect(result.unmeasuredCommands).toEqual([]);
});

test('cost runner rejects non-cost commands before spawn and preserves allowed argv', async () => {
  const originalSpawn = Bun.spawn;
  const spawned: unknown[] = [];
  Bun.spawn = ((options: unknown) => {
    spawned.push(options);
    return {
      stdout: new Blob(['7.5 credits']).stream(),
      stderr: new Blob(['']).stream(),
      exited: Promise.resolve(0),
    };
  }) as typeof Bun.spawn;

  try {
    const runner = createHiggsfieldCostRunner();
    await expect(runner.run(['higgsfield', 'generate', 'create', 'model-a'])).rejects.toThrow('permits only higgsfield generate cost');
    expect(spawned).toEqual([]);

    const argv = ['higgsfield', 'generate', 'cost', 'model-a', '--prompt', 'exact original args', '--duration', '5'] as const;
    await expect(runner.run(argv)).resolves.toMatchObject({ stdout: '7.5 credits', stderr: '', exitCode: 0 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ cmd: [...argv] });
  } finally {
    Bun.spawn = originalSpawn;
  }
});

test('main is the CLI wiring boundary and uses its injected runner without generate create', async () => {
  const { runner, calls } = fakeRunner([
    { stdout: '7.5 credits', stderr: '', exitCode: 0 },
    { stdout: '31.5 credits', stderr: '', exitCode: 0 },
    { stdout: '12 credits', stderr: '', exitCode: 0 },
    { stdout: '36 credits', stderr: '', exitCode: 0 },
    { stdout: '4.5 credits', stderr: '', exitCode: 0 },
  ]);
  const output: string[] = [];

  const result = await main(runner, (line) => output.push(line));

  expect(result).toMatchObject({ measuredCredits: 91.5, plannedCredits: 91.5, totalsMatch: true, approved: true });
  expect(calls).toHaveLength(5);
  expect(calls.every((argv) => argv.slice(0, 3).join(' ') === 'higgsfield generate cost')).toBe(true);
  expect(calls.flat().includes('create')).toBe(false);
  expect(output.join('\n')).toContain('검사 승인: 예');
  expect(output.join('\n')).not.toContain('submission');
});
