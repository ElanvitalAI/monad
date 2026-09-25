import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AD_GATES, type AdPipelineResult, type AdProductionDeps } from '../src/ad-pipeline/run.js';
import type { ClipFile } from '../src/ad-pipeline/assemble.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import { main, runAdDryChain, type AdDryChainDependencies } from '../scripts/ad-dry-chain.js';

const intake = { kind: 'text', brief: 'summer launch' } as const;
const temporaryDirectories: string[] = [];

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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function spawn(argv: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly exitCode: number } {
  const result = Bun.spawnSync({ cmd: [...argv], stdout: 'pipe', stderr: 'pipe' });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode,
  };
}

function temporaryMediaDependencies() {
  const workDir = mkdtempSync(join(tmpdir(), 'ad-dry-chain-'));
  temporaryDirectories.push(workDir);
  const clips: ClipFile[] = ['red', 'blue'].map((color, beatIndex) => {
    const path = join(workDir, `clip-${beatIndex}.mp4`);
    const generated = spawn(['ffmpeg', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x568:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
    expect(generated.exitCode, generated.stderr).toBe(0);
    return { beatIndex, path, probe: { width: 320, height: 568, fps: '30/1', codec: 'h264', hasAudio: false } };
  });
  const calls: string[][] = [];
  return {
    workDir,
    calls,
    production: {
      render: {
        run: async (argv: readonly string[]) => {
          calls.push([...argv]);
          return spawn(argv);
        },
      },
      assembly: { scene, clips, options: { workDir, outputName: 'master.mp4' } },
    },
  };
}

test('runAdDryChain supplies dry approval, stage, and grounding contracts to an injected pipeline seam', async () => {
  let receivedIntake: unknown;
  const result = await runAdDryChain(intake, {
    runPipeline: async (actualIntake, deps) => {
      receivedIntake = actualIntake;
      for (const gate of AD_GATES) {
        expect(await deps.approve(gate, {} as never)).toBe(true);
        await deps.stage(gate, {} as never);
      }
      await deps.onGrounding({ status: 'not-collected', reason: 'not applicable' });
      return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
    },
  });

  expect(receivedIntake).toEqual(intake);
  expect(result).toMatchObject({
    ok: true,
    diagnostic: { code: 'gates-approved', message: 'All requested gates were approved.' },
    measurement: { approvalCount: 4, approvedGates: AD_GATES, stageCount: 4, stagedGates: AD_GATES, groundingCount: 1 },
  });
  if (result.ok) expect(result.pipeline.status).toBe('gates-approved');
});

test('runAdDryChain exports production and clip source dependencies while observing vendor and shell calls', async () => {
  const calls: string[][] = [];
  const production: AdProductionDeps = {
    cut: {
      submit: async () => 'job-1',
      poll: async () => ({ status: 'completed' }),
    },
    clips: { workDir: '/original-clips', runner: { run: async (argv) => { calls.push([...argv]); return { stdout: '', stderr: '', exitCode: 0 }; } } },
  };
  const dependencies: AdDryChainDependencies = {
    production,
    clipSourceDir: '/source-clips',
    runPipeline: async (_actualIntake, deps) => {
      expect(deps.production?.clips?.workDir).toBe('/source-clips');
      await deps.production?.cut?.submit({} as never);
      await deps.production?.clips?.runner.run(['ffprobe']);
      return { status: 'gates-approved', plan: {} as never, unwiredProduction: [], productionReadiness: [] };
    },
  };

  const result = await runAdDryChain(intake, dependencies);

  expect(calls).toEqual([['ffprobe']]);
  // ⛔⭐ `vendorCreateCount` 는 «제출 횟수»가 아니라 `generate create` argv 를 «본» 횟수다(#17355).
  //   이 판의 submit 은 빈 명령이라 과금 argv 가 없다 ⇒ 제출 1 · 과금 0 으로 «갈린다».
  //   📏 종전 단언 `vendorCreateCount: 1` 은 두 칸이 «같은 칸»이던 시절의 값이었다.
  expect(result).toMatchObject({
    ok: true,
    measurement: { shellCommandCount: 1, vendorSubmitCount: 1, vendorCreateCount: 0 },
  });
});

test('runAdDryChain invokes canonical runAdPipeline by default and records all dry gates', async () => {
  const result = await runAdDryChain(intake);

  expect(result).toMatchObject({
    ok: true,
    pipeline: { status: 'gates-approved' },
    diagnostic: { code: 'gates-approved' },
    measurement: { approvalCount: 4, approvedGates: AD_GATES, stageCount: 4, stagedGates: AD_GATES, groundingCount: 0 },
  });
});

test('runAdDryChain preserves canonical rejection without recording rejected gates or running later stages', async () => {
  const result = await runAdDryChain(intake, { approve: () => false });

  expect(result).toMatchObject({
    ok: true,
    pipeline: { status: 'rejected', stoppedGate: 'BRIEF_OK' },
    diagnostic: { code: 'gate-rejected', stoppedGate: 'BRIEF_OK', message: 'Gate rejected: BRIEF_OK.' },
    measurement: { approvalCount: 0, approvedGates: [], stageCount: 0, stagedGates: [], groundingCount: 0 },
  });
});

test('runAdDryChain returns thrown pipeline failures through the diagnostic and error contracts', async () => {
  const result = await runAdDryChain(intake, {
    runPipeline: async () => { throw new TypeError('canonical failure'); },
  });

  expect(result).toEqual({
    ok: false,
    measurement: { approvalCount: 0, approvedGates: [], stageCount: 0, stagedGates: [], groundingCount: 0 },
    diagnostic: { code: 'pipeline-error', message: 'canonical failure' },
    error: { name: 'TypeError', message: 'canonical failure' },
  });
});

test('runAdDryChain excludes a failed canonical stage from completions and stops later stages', async () => {
  const attempted: string[] = [];
  const result = await runAdDryChain(intake, {
    stage: (gate) => {
      attempted.push(gate);
      if (gate === 'MASTER_PICK') throw new Error('stage failed');
    },
  });

  expect(attempted).toEqual(['BRIEF_OK', 'MASTER_PICK']);
  expect(result).toEqual({
    ok: false,
    measurement: {
      approvalCount: 2,
      approvedGates: ['BRIEF_OK', 'MASTER_PICK'],
      stageCount: 1,
      stagedGates: ['BRIEF_OK'],
      groundingCount: 0,
    },
    diagnostic: { code: 'pipeline-error', message: 'stage failed' },
    error: { name: 'Error', message: 'stage failed' },
  });
});

test('runAdDryChain reports blocked canonical results without changing their result contract', async () => {
  const blocked: AdPipelineResult = { status: 'blocked', plan: {} as never, grounding: { status: 'not-collected', reason: 'missing facts' }, reason: 'missing facts' };
  const result = await runAdDryChain(intake, { runPipeline: async () => blocked });

  expect(result).toMatchObject({ ok: true, pipeline: blocked, diagnostic: { code: 'pipeline-blocked', message: 'missing facts' } });
});

for (const [entrypoint, execute] of [
  ['runAdDryChain', (dependencies: ReturnType<typeof temporaryMediaDependencies>) => runAdDryChain(intake, dependencies)],
  ['main', (dependencies: ReturnType<typeof temporaryMediaDependencies>) => main(intake, dependencies)],
] as const) {
  test(`${entrypoint} reaches runAdPipeline and executes generated temporary media through ffmpeg and ffprobe`, async () => {
    const dependencies = temporaryMediaDependencies();
    const result = await execute(dependencies);

    expect(result).toMatchObject({
      ok: true,
      pipeline: { status: 'gates-approved', qc: { verdict: 'unmeasured' } },
      measurement: { approvalCount: 4, stageCount: 4 },
    });
    expect(existsSync(join(dependencies.workDir, 'master.mp4'))).toBe(true);
    expect(dependencies.calls.filter(([command]) => command === 'ffmpeg').length).toBeGreaterThanOrEqual(7);
    expect(dependencies.calls.filter(([command]) => command === 'ffprobe').length).toBe(1);
  }, 30_000);
}
