import { expect, test } from 'bun:test';
import { AD_GATES, type AdProductionDeps } from '../src/ad-pipeline/run.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import { runAdDryChain } from './ad-dry-chain.js';

const intake = { kind: 'text', brief: 'summer launch' } as const;

const scene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 1, emotion: { primary: 'warm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'red', checks: [] },
    { role: 'buildup', startSec: 1, endSec: 2, emotion: { primary: 'cool', secondary: 'calm' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'blue', checks: [], transitionIn: { kind: 'hard-cut', intent: 'cut' } },
  ],
  axes: { hook: 'hook', totalSeconds: 2, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

test('runAdDryChain preserves gate-only behavior when production is omitted', async () => {
  const result = await runAdDryChain(intake);

  expect(result).toMatchObject({
    ok: true,
    pipeline: { status: 'gates-approved' },
    diagnostic: { code: 'gates-approved', message: 'All requested gates were approved.' },
    measurement: { approvalCount: 4, approvedGates: AD_GATES, stageCount: 4, stagedGates: AD_GATES, groundingCount: 0 },
  });
  expect(result.measurement).not.toHaveProperty('shellCommandCount');
  expect(result.measurement).not.toHaveProperty('vendorSubmitCount');
  expect(result.measurement).not.toHaveProperty('vendorCreateCount');
});

test('runAdDryChain passes local clips into production and counts shell work without vendor submission', async () => {
  const renderedCommands: string[][] = [];
  const clipRunnerCommands: string[][] = [];
  const production: AdProductionDeps = {
    clips: {
      workDir: '/vendor-clips',
      runner: { run: async (argv) => { clipRunnerCommands.push([...argv]); return { stdout: '', stderr: '', exitCode: 0 }; } },
    },
    assembly: {
      scene,
      clips: [
        { beatIndex: 0, path: '/local-clips/clip-0.mp4', probe: { width: 320, height: 568, fps: '30/1', codec: 'h264', hasAudio: false } },
        { beatIndex: 1, path: '/local-clips/clip-1.mp4', probe: { width: 320, height: 568, fps: '30/1', codec: 'h264', hasAudio: false } },
      ],
      options: { workDir: '/render-output', outputName: 'master.mp4' },
    },
    render: { run: async (argv) => { renderedCommands.push([...argv]); return { stdout: '', stderr: '', exitCode: 0 }; } },
  };
  let passedClipWorkDir: string | undefined;

  const result = await runAdDryChain(intake, {
    production,
    clipSourceDir: '/local-clips',
    runPipeline: async (actualIntake, deps) => {
      passedClipWorkDir = deps.production?.clips?.workDir;
      return (await import('../src/ad-pipeline/run.js')).runAdPipeline(actualIntake, deps);
    },
  });

  expect(passedClipWorkDir).toBe('/local-clips');
  expect(clipRunnerCommands).toEqual([]);
  expect(renderedCommands.length).toBeGreaterThan(0);
  expect(result).toMatchObject({
    ok: true,
    pipeline: { status: 'gates-approved' },
    measurement: {
      approvalCount: 4,
      approvedGates: AD_GATES,
      stageCount: 4,
      stagedGates: AD_GATES,
      groundingCount: 0,
      vendorSubmitCount: 0,
      vendorCreateCount: 0,
    },
  });
  expect(result.measurement.shellCommandCount).toBeGreaterThan(0);
});

test('runAdDryChain counts submissions separately from non-spending runner argv', async () => {
  const production: AdProductionDeps = {
    cut: { submit: async () => 'job-1', poll: async () => ({ status: 'completed' }) },
    clips: { workDir: '/clips', runner: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
  };

  const result = await runAdDryChain(intake, {
    production,
    runPipeline: async (_actualIntake, deps) => {
      await deps.production!.cut!.submit({} as never);
      await deps.production!.cut!.submit({} as never);
      await deps.production!.cut!.submit({} as never);
      await deps.production!.clips!.runner.run(['ffprobe', '/clips/clip.mp4']);
      return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
    },
  });

  expect(result).toMatchObject({
    ok: true,
    measurement: { vendorSubmitCount: 3, vendorCreateCount: 0 },
    diagnostic: { code: 'gates-approved' },
  });
});

test('runAdDryChain rejects observed generate create argv with diagnostic text', async () => {
  const production: AdProductionDeps = {
    clips: { workDir: '/clips', runner: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
  };

  const result = await runAdDryChain(intake, {
    production,
    runPipeline: async (_actualIntake, deps) => {
      await deps.production!.clips!.runner.run(['higgsfield', 'generate', 'create', 'video', '--prompt', 'summer']);
      return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
    },
  });

  expect(result).toMatchObject({
    ok: false,
    measurement: { vendorSubmitCount: 0, vendorCreateCount: 1 },
    diagnostic: { code: 'vendor-spend-observed', message: 'Vendor spending observed; would run: higgsfield generate create video --prompt summer' },
  });
});

test('runAdDryChain rejects generate create observed through the render runner', async () => {
  const production: AdProductionDeps = {
    render: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
  };

  const result = await runAdDryChain(intake, {
    production,
    runPipeline: async (_actualIntake, deps) => {
      await deps.production!.render!.run(['higgsfield', 'generate', 'create', 'video', '--prompt', 'render']);
      return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
    },
  });

  expect(result).toMatchObject({
    ok: false,
    measurement: { vendorSubmitCount: 0, vendorCreateCount: 1 },
    diagnostic: { code: 'vendor-spend-observed', message: 'Vendor spending observed; would run: higgsfield generate create video --prompt render' },
  });
});

test('runAdDryChain preserves spend diagnostics when the observed runner or pipeline throws', async () => {
  for (const throwAfterSpend of [false, true]) {
    const production: AdProductionDeps = {
      clips: {
        workDir: '/clips',
        runner: {
          run: async () => {
            if (!throwAfterSpend) throw new Error('runner failure');
            return { stdout: '', stderr: '', exitCode: 0 };
          },
        },
      },
    };

    const result = await runAdDryChain(intake, {
      production,
      runPipeline: async (_actualIntake, deps) => {
        await deps.production!.clips!.runner.run(['higgsfield', 'generate', 'create', 'video']);
        if (throwAfterSpend) throw new Error('pipeline failure');
        return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      measurement: { vendorCreateCount: 1 },
      diagnostic: { code: 'vendor-spend-observed', message: 'Vendor spending observed; would run: higgsfield generate create video' },
    });
  }
});
