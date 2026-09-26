import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildAdRunSetup } from '../src/ad-pipeline/ad-run-setup.js';
import type { CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import type { AdProductionDeps } from '../src/ad-pipeline/run.js';
import { parseMeasuredModelContracts } from '../src/ad-pipeline/model-contracts.js';
import { adProjectDir } from '../src/ad-pipeline/output-path.js';
import { buildShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import type { ShootCommand } from '../src/ad-pipeline/shoot-run.js';
import { createDashboardAdRunSetupBindings, createDashboardAdRunSetupFactory, dashboardAdCommandRunner } from '../src/dashboard/index.js';
import { createDashboardAdSlashRuntime } from '../src/dashboard/ad-slash-runtime.js';

const measuredJson = readFileSync(new URL('../docs/ad-presets/higgsfield-measured-contracts.json', import.meta.url), 'utf8');
const input = {
  home: '/Users/example',
  slug: 'umbrella',
  date: '2026-09-11',
  version: 4,
  aspect: '9x16',
  contractsJson: measuredJson,
};

function setupFromInput() {
  const result = buildAdRunSetup(input);
  if ('error' in result) throw new Error(result.error);
  return result;
}

test('assembles documented paths, names, and measured contracts without filling unknown axes', () => {
  const setup = setupFromInput();

  expect(setup.workDir).toBe('/Users/example/Movies/elanous-ad/2026-09-11-umbrella');
  expect(setup.outputName).toBe('umbrella_v4_9x16.mp4');
  expect(setup.durationRules.seedance_2_0).toEqual({ minimumSeconds: 4 });
  expect(setup.creditsPerSecond.seedance_2_0).toBe(4.5);
  expect(setup.referenceDelivery.seedance_2_0).toEqual({ kind: 'repeated', flag: '--image-references' });
  expect(setup.unknownModels).toEqual(['kling3_0_turbo']);
  expect(setup.referenceDelivery.kling3_0_turbo).toBeUndefined();
});

test('preserves output-path errors without replacing their objects or messages', () => {
  const expected = adProjectDir({ ...input, slug: '../umbrella' });
  const actual = buildAdRunSetup({ ...input, slug: '../umbrella' });
  if (typeof expected === 'string' || !('error' in actual)) throw new Error('expected output-path errors');

  expect(actual.error).toBe(expected.error);
});

test('preserves measured-contract parser errors without replacing their objects or messages', () => {
  const expected = parseMeasuredModelContracts('{not JSON');
  const actual = buildAdRunSetup({ ...input, contractsJson: '{not JSON' });
  if (!('error' in expected) || !('error' in actual)) throw new Error('expected measured-contract errors');

  expect(actual.error).toBe(expected.error);
});

test('feeds assembled contracts directly into buildShootPlan', () => {
  const setup = setupFromInput();
  const scene: SceneSpec = {
    beats: [{ role: 'hook', startSec: 0, endSec: 3, emotion: { primary: 'calm', secondary: 'bright' }, camera: { move: 'static', shotSize: 'wide' }, model: 'seedance_2_0', audio: false, promptCore: 'Product shot', checks: [] }],
    axes: { hook: 'Product', totalSeconds: 3, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
    aspectRatio: '9:16',
    forbidden: [],
    provenance: 'generated',
  };

  const plan = buildShootPlan(scene, { mode: 'quality', ...setup });

  expect(plan.commands).toMatchObject([{ jobType: 'seedance_2_0', durationSeconds: 4, trimToSeconds: 3, estimatedCredits: 18 }]);
  expect(plan.unpriced).toEqual([]);
});

test('assembles production dependencies with one injected runner while preserving the five legacy fields', async () => {
  const calls: (readonly string[])[] = [];
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv);
      return { stdout: '32dc92c9-3d64-4b55-92c4-c9551f8f5844', stderr: '', exitCode: 0 };
    },
  };
  const setup = buildAdRunSetup({
    ...input,
    runner,
    allowSpend: true,
    higgsfieldCliPath: 'hf',
    now: () => new Date('2026-10-15T12:34:56.789Z'),
  });
  if ('error' in setup || !setup.production) throw new Error('expected assembled production dependencies');

  const contracts = parseMeasuredModelContracts(measuredJson);
  if ('error' in contracts) throw new Error(contracts.error);
  const command: ShootCommand = { beatIndex: 0, jobType: 'seedance_2_0', args: ['--prompt', 'product shot'], durationSeconds: 4 };

  expect({
    workDir: setup.workDir,
    outputName: setup.outputName,
    durationRules: setup.durationRules,
    creditsPerSecond: setup.creditsPerSecond,
    referenceDelivery: setup.referenceDelivery,
  }).toEqual({
    workDir: '/Users/example/Movies/elanous-ad/2026-09-11-umbrella',
    outputName: 'umbrella_v4_9x16.mp4',
    durationRules: contracts.durationRules,
    creditsPerSecond: contracts.creditsPerSecond,
    referenceDelivery: contracts.referenceDelivery,
  });
  expect(setup.production).toMatchObject({
    durationRules: setup.durationRules,
    creditsPerSecond: setup.creditsPerSecond,
    referenceDelivery: setup.referenceDelivery,
    clips: { runner, workDir: setup.workDir },
    render: runner,
    shootClipRetention: { runner, options: { workDir: setup.workDir, s3Available: false, now: '2026-10-15T12:34:56.789Z' } },
  });

  await expect(setup.production.cut!.submit(command)).resolves.toBe('32dc92c9-3d64-4b55-92c4-c9551f8f5844');
  expect(calls).toEqual([['hf', 'generate', 'create', 'seedance_2_0', '--prompt', 'product shot', '--duration', '4']]);
});

test('defaults production spending to closed when allowSpend is omitted', async () => {
  const runner: CommandRunner = { async run() { throw new Error('runner must not be called'); } };
  const setup = buildAdRunSetup({ ...input, runner });
  if ('error' in setup || !setup.production) throw new Error('expected assembled production dependencies');
  const command: ShootCommand = { beatIndex: 0, jobType: 'seedance_2_0', args: ['--prompt', 'product shot'], durationSeconds: 4 };

  await expect(setup.production.cut!.submit(command)).rejects.toThrow('Higgsfield spending is disabled');
});

test('reports missing optional production inputs without changing the legacy production keys', () => {
  const runner: CommandRunner = { async run() { throw new Error('runner must not be called'); } };
  const setup = buildAdRunSetup({ ...input, runner });
  if ('error' in setup || !setup.production) throw new Error('expected assembled production dependencies');

  expect(Object.keys(setup.production).sort()).toEqual([
    'clips',
    'creditsPerSecond',
    'cut',
    'durationRules',
    'referenceDelivery',
    'render',
    'shootClipRetention',
  ]);
  expect(setup.missingProductionInputs).toEqual([
    'assembly',
    'assemblyMaterials',
    'captionFontPath',
    'musicBedPath',
    'qcThresholds',
    'voiceover',
    'soundtrack',
    'referenceAssets',
    'shootRunOptions',
    'ground',
    'invariants',
  ]);
});

test('passes supplied production inputs through by reference and excludes their names from missing inputs', () => {
  const runner: CommandRunner = { async run() { throw new Error('runner must not be called'); } };
  const assembly = { clips: [] } satisfies NonNullable<AdProductionDeps['assembly']>;
  const qcThresholds = { maxLoudnessLufs: -16 } as NonNullable<AdProductionDeps['qcThresholds']>;
  const captionFontPath = '/caller-selected-font.ttf';
  const setup = buildAdRunSetup({ ...input, runner, assembly, captionFontPath, qcThresholds });
  if ('error' in setup || !setup.production) throw new Error('expected assembled production dependencies');

  expect(setup.production.assembly).toBe(assembly);
  expect(setup.production.captionFontPath).toBe(captionFontPath);
  expect(setup.production.qcThresholds).toBe(qcThresholds);
  expect(setup.missingProductionInputs).toEqual([
    'assemblyMaterials',
    'musicBedPath',
    'voiceover',
    'soundtrack',
    'referenceAssets',
    'shootRunOptions',
    'ground',
    'invariants',
  ]);
});

test('routes dashboard /ad invocations through closed, explicit-spend, then closed production bindings', async () => {
  const calls: (readonly string[])[] = [];
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv);
      return { stdout: '32dc92c9-3d64-4b55-92c4-c9551f8f5844', stderr: '', exitCode: 0 };
    },
  };
  const factory = createDashboardAdRunSetupFactory({
    home: input.home,
    date: input.date,
    contractsJson: input.contractsJson,
    runner,
  });
  const spendIntents: boolean[] = [];
  const bindings = createDashboardAdRunSetupBindings((allowSpend) => {
    spendIntents.push(allowSpend);
    return factory(allowSpend);
  });
  const reports: string[] = [];
  const runtime = createDashboardAdSlashRuntime({
    ...bindings,
    approve: async () => true,
    report: (line) => { reports.push(line); },
    muted: (line) => line,
    warning: (line) => line,
  });

  await runtime.run(['Summer launch campaign']);
  await runtime.run(['Summer launch campaign', '--spend']);
  await runtime.run(['Summer launch campaign']);

  const command: ShootCommand = { beatIndex: 0, jobType: 'seedance_2_0', args: ['--prompt', 'product shot'], durationSeconds: 4 };
  const closedBeforeSpend = bindings.productionForSpend?.(false);
  const openForSpend = bindings.productionForSpend?.(true);
  const closedAfterSpend = bindings.productionForSpend?.(false);
  if (!closedBeforeSpend?.cut || !openForSpend?.cut || !closedAfterSpend?.cut) {
    throw new Error('expected dashboard production bindings');
  }

  await expect(closedBeforeSpend.cut.submit(command)).rejects.toThrow('Higgsfield spending is disabled');
  await expect(openForSpend.cut.submit(command)).resolves.toBe('32dc92c9-3d64-4b55-92c4-c9551f8f5844');
  await expect(closedAfterSpend.cut.submit(command)).rejects.toThrow('Higgsfield spending is disabled');

  expect(spendIntents).toEqual([false, false, true, false, false, true, false]);
  expect(calls).toEqual([['higgsfield', 'generate', 'create', 'seedance_2_0', '--prompt', 'product shot', '--duration', '4']]);
  expect(reports.filter((line) => line.includes('spending is closed for this run'))).toHaveLength(2);
  expect(bindings.production?.assemblyMaterials).toEqual({ options: {
    workDir: expect.stringMatching(/^\/Users\/example\/Movies\/elanous-ad\/2026-09-11-dashboard-ad-\d{6}-\d+$/),
    outputName: expect.stringMatching(/^dashboard-ad-\d{6}-\d+_v1_9x16\.mp4$/),
  } });
});

test('keeps dashboard boot fail-closed and exposes factory errors through outputSetupError', () => {
  const bindings = createDashboardAdRunSetupBindings(createDashboardAdRunSetupFactory({
    home: input.home,
    date: input.date,
    contractsJson: '{not JSON',
    runner: dashboardAdCommandRunner,
  }));

  expect(bindings.production).toBeUndefined();
  expect(bindings.outputSetupError).toContain('invalid measured model contracts JSON');
  expect(bindings.productionForSpend(false)).toBeUndefined();
  expect(bindings.outputSetupError).toContain('invalid measured model contracts JSON');
});

test('records per-run factory return errors and thrown errors for the dashboard runtime getter', () => {
  let invocation = 0;
  const bindings = createDashboardAdRunSetupBindings(() => {
    invocation += 1;
    if (invocation === 1) return buildAdRunSetup({ ...input, runner: dashboardAdCommandRunner });
    if (invocation === 2) return buildAdRunSetup({ ...input, contractsJson: '{not JSON', runner: dashboardAdCommandRunner });
    throw new Error('per-run setup exploded');
  });

  expect(bindings.production).toBeDefined();
  expect(bindings.outputSetupError).toBeUndefined();
  expect(bindings.productionForSpend(false)).toBeUndefined();
  expect(bindings.outputSetupError).toContain('invalid measured model contracts JSON');
  expect(bindings.productionForSpend(true)).toBeUndefined();
  expect(bindings.outputSetupError).toBe('per-run setup exploded');
});

test('drains a large stderr pipe concurrently with stdout and process exit', async () => {
  const result = await dashboardAdCommandRunner.run([
    process.execPath,
    '-e',
    "process.stderr.write('x'.repeat(16 * 1024 * 1024)); process.stdout.write('stdout-complete')",
  ], { timeoutMs: 5_000 });

  expect(result).toMatchObject({ exitCode: 0, stdout: 'stdout-complete' });
  expect(result.stderr).toHaveLength(16 * 1024 * 1024);
});

test('keeps the version-three master-name rule', () => {
  const result = buildAdRunSetup({ ...input, version: 3 });

  expect(result).toMatchObject({
    workDir: '/Users/example/Movies/elanous-ad/2026-09-11-umbrella',
    outputName: 'umbrella_v3_9x16.mp4',
  });
});
