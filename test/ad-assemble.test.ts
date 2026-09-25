import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAssemblyPlan, type ClipFile } from '../src/ad-pipeline/assemble.js';
import { createAdPipelineDeps, runAdPipeline } from '../src/ad-pipeline/run.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

const scene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'first', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 10, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'second', checks: [], transitionIn: { kind: 'hard-cut', intent: 'cut' } },
    { role: 'transition', startSec: 10, endSec: 15, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'third', checks: [] },
  ],
  axes: { hook: 'hook', totalSeconds: 15, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

const clips = (): ClipFile[] => scene.beats.map((_, beatIndex) => ({
  beatIndex,
  path: `/source/${beatIndex}.mp4`,
  probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: true },
}));

const options = { workDir: '/work', outputName: 'master.mp4' };

function steps(plan: ReturnType<typeof buildAssemblyPlan>): string[] {
  return plan.commands.map((command) => command.step);
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function run(argv: readonly string[]): void {
  const result = Bun.spawnSync({ cmd: [...argv], stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}

function streamTypes(path: string): string[] {
  const result = Bun.spawnSync({ cmd: ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path], stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return new TextDecoder().decode(result.stdout).trim().split('\n').filter(Boolean);
}

function duration(path: string): number {
  const result = Bun.spawnSync({ cmd: ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  return Number(new TextDecoder().decode(result.stdout).trim());
}

function expectDurationNear(path: string, expected: number): void {
  expect(duration(path)).toBeGreaterThanOrEqual(expected - 0.05);
  expect(duration(path)).toBeLessThanOrEqual(expected + 0.05);
}

function executionScene(withDissolve: boolean): SceneSpec {
  return {
    ...scene,
    beats: [
      { ...scene.beats[0], endSec: 1 },
      { ...scene.beats[1], startSec: 1, endSec: 2, transitionIn: { kind: withDissolve ? 'dissolve' : 'hard-cut', intent: 'cut' } },
    ],
    axes: { ...scene.axes, totalSeconds: 2 },
  };
}

function audioClip(workDir: string, beatIndex: number): ClipFile {
  const path = join(workDir, `source-${beatIndex}.mp4`);
  run(['ffmpeg', '-y', '-f', 'lavfi', '-i', `color=c=${beatIndex === 0 ? 'red' : 'blue'}:s=320x180:r=30:d=1`, '-f', 'lavfi', '-i', `sine=frequency=${440 + beatIndex * 110}:sample_rate=48000:duration=1`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path]);
  return { beatIndex, path, probe: { width: 320, height: 180, fps: '30/1', codec: 'h264', hasAudio: true } };
}

function executePlan(plan: ReturnType<typeof buildAssemblyPlan>): void {
  expect(plan.blocked).toEqual([]);
  for (const command of plan.commands) run(command.argv);
}

test('plans re-encoded trims, sequential concat, safezone, and an aspect-aware master without execution', () => {
  const plan = buildAssemblyPlan(scene, clips(), options);
  const trims = plan.commands.filter((command) => command.step === 'trim');
  const concat = plan.commands.filter((command) => command.step === 'concat');

  expect(trims).toHaveLength(3);
  expect(trims[0].argv).toEqual(expect.arrayContaining(['-ss', '0', '-t', '5', '-c:v', 'libx264']));
  expect(trims.flatMap((command) => command.argv)).not.toContain('copy');
  expect(steps(plan)).toEqual(['workdir', 'trim', 'trim', 'trim', 'concat', 'concat', 'safezone', 'master']);
  expect(plan.commands[0]).toEqual({ step: 'workdir', argv: ['mkdir', '-p', '/work'], output: '/work' });
  expect(concat[0].argv).toEqual(expect.arrayContaining(['/work/trim-0.mp4', '/work/trim-1.mp4', '[0:v][1:v]concat=n=2:v=1:a=0']));
  expect(concat[1].argv).toEqual(expect.arrayContaining(['/work/joined-1.mp4', '/work/trim-2.mp4']));
  const safezone = plan.commands.find((command) => command.step === 'safezone')!;
  const master = plan.commands.find((command) => command.step === 'master')!;
  expect(safezone.argv).toContain('scale=1080:1920:flags=lanczos,drawbox=y=0:h=192,drawbox=y=1536:h=384,drawbox=x=972:w=108');
  expect(master.argv).toContain('scale=1080:1920:flags=lanczos,fps=30/1');
  expect(plan.safezonePath).toBe(safezone.output);
  expect(plan.masterPath).toBe(master.output);
  expect(plan).toMatchObject({ mismatched: [], unprobed: [], blocked: [] });
});

test('uses the common probed source FPS unless an explicit output FPS overrides it', () => {
  const sourceDerived = buildAssemblyPlan(scene, clips().map((clip) => ({ ...clip, probe: { ...clip.probe!, fps: '24/1' } })), options);
  const sourceDerivedMaster = sourceDerived.commands.find((command) => command.step === 'master')!;
  expect(sourceDerivedMaster.argv).toContain('scale=1080:1920:flags=lanczos,fps=24/1');

  const explicit = buildAssemblyPlan(scene, clips().map((clip) => ({ ...clip, probe: { ...clip.probe!, fps: '24/1' } })), { ...options, outputFps: '30' });
  const explicitMaster = explicit.commands.find((command) => command.step === 'master')!;
  expect(explicitMaster.argv).toContain('scale=1080:1920:flags=lanczos,fps=30');
});

test('prefers valid shoot trim instructions, records informational disagreements, and falls back for invalid values', () => {
  const trim = (plan: ReturnType<typeof buildAssemblyPlan>, beatIndex: number): string => {
    const argv = plan.commands.find((command) => command.step === 'trim' && command.output === `/work/trim-${beatIndex}.mp4`)!.argv;
    return argv[argv.indexOf('-t') + 1]!;
  };

  const matching = buildAssemblyPlan(scene, [{ ...clips()[0], trimToSeconds: 5 }, ...clips().slice(1)], options);
  expect(trim(matching, 0)).toBe('5');
  expect(matching.trimDisagreement).toEqual([]);

  const disagreement = buildAssemblyPlan(scene, [{ ...clips()[0], trimToSeconds: 3 }, ...clips().slice(1)], options);
  expect(trim(disagreement, 0)).toBe('3');
  expect(disagreement.trimDisagreement).toEqual([{ beatIndex: 0, clip: 3, scene: 5 }]);
  expect(disagreement.blocked).toEqual([]);

  const fallback = buildAssemblyPlan(scene, clips(), options);
  expect(trim(fallback, 0)).toBe('5');
  expect(fallback.trimDisagreement).toEqual([]);

  for (const trimToSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = buildAssemblyPlan(scene, [{ ...clips()[0], trimToSeconds }, ...clips().slice(1)], options);
    expect(trim(invalid, 0)).toBe('5');
    expect(invalid.trimDisagreement).toEqual([]);
    expect(invalid.blocked).toEqual([]);
  }
});

test('uses a selected trim duration for dissolve timing and final master length', () => {
  const dissolveScene: SceneSpec = {
    ...scene,
    beats: [
      { ...scene.beats[0], endSec: 5 },
      { ...scene.beats[1], startSec: 5, endSec: 10, transitionIn: { kind: 'dissolve', intent: 'cut' } },
    ],
  };
  const plan = buildAssemblyPlan(dissolveScene, [{ ...clips()[0], trimToSeconds: 3 }, ...clips().slice(1, 2)], { ...options, dissolveDurationSec: 1 });
  const trim = plan.commands.find((command) => command.step === 'trim' && command.output === '/work/trim-0.mp4')!;
  const dissolve = plan.commands.find((command) => command.step === 'xfade')!;
  const master = plan.commands.find((command) => command.step === 'master')!;

  expect(trim.argv).toEqual(expect.arrayContaining(['-t', '3']));
  expect(plan.trimDisagreement).toEqual([{ beatIndex: 0, clip: 3, scene: 5 }]);
  expect(plan.blocked).toEqual([]);
  expect(dissolve.argv).toContain('[0][1]xfade=transition=fade:duration=1:offset=2');
  expect(master.argv).toEqual(expect.arrayContaining(['-t', '7']));
});

test('selects explicit master-audio modes and emits only their corresponding audio commands', () => {
  const silent = buildAssemblyPlan(scene, clips(), options);
  const silentMaster = silent.commands.find((command) => command.step === 'master')!;
  expect(silent.masterAudio).toEqual({ kind: 'silent' });
  expect(silentMaster.argv).toContain('-an');
  expect(silentMaster.argv).not.toContain('-c:a');
  expect(silent.commands.filter((command) => command.step === 'trim').flatMap((command) => command.argv)).toContain('-an');
  expect(silent.commands.find((command) => command.step === 'concat')!.argv).toContain('[0:v][1:v]concat=n=2:v=1:a=0');

  const original = buildAssemblyPlan(scene, clips(), { ...options, masterAudio: { kind: 'original' } });
  const originalMaster = original.commands.find((command) => command.step === 'master')!;
  expect(original.masterAudio).toEqual({ kind: 'original' });
  expect(originalMaster.argv).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac']));
  expect(original.commands.filter((command) => command.step === 'trim').flatMap((command) => command.argv)).not.toContain('-an');
  expect(original.commands.find((command) => command.step === 'concat')!.argv).toContain('[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]');

  const soundtrack = buildAssemblyPlan(scene, clips(), { ...options, masterAudio: { kind: 'soundtrack', path: '/audio/soundtrack.wav' } });
  const soundtrackMaster = soundtrack.commands.find((command) => command.step === 'master')!;
  expect(soundtrack.masterAudio).toEqual({ kind: 'soundtrack', path: '/audio/soundtrack.wav' });
  expect(soundtrackMaster.argv).toEqual(expect.arrayContaining(['-i', '/audio/soundtrack.wav', '-map', '0:v:0', '-map', '1:a', '-c:a', 'aac', '-t', '15']));
  expect(soundtrackMaster.argv.indexOf('/audio/soundtrack.wav')).toBeLessThan(soundtrackMaster.argv.indexOf('-vf'));
  expect(soundtrackMaster.argv).not.toContain('-an');
});

test('createAdPipelineDeps forwards silent, original, and soundtrack selections to the assembly command runner', async () => {
  const calls: string[][] = [];
  const runner = { run: async (argv: readonly string[]) => { calls.push([...argv]); return { stdout: '', stderr: '', exitCode: 0 }; } };
  const selections = [
    { expected: 'silent', options, masterAudio: undefined },
    { expected: 'original', options: { ...options, masterAudio: { kind: 'original' } as const }, masterAudio: undefined },
    { expected: 'soundtrack', options, masterAudio: { kind: 'soundtrack', path: '/audio/soundtrack.wav' } as const },
  ] as const;
  for (const selection of selections) {
    calls.splice(0);
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, createAdPipelineDeps({
      ask: () => true,
      report: () => {},
      production: {
        render: runner,
        assembly: { scene, clips: clips(), options: selection.options, ...(selection.masterAudio ? { masterAudio: selection.masterAudio } : {}) },
      },
    }));
    expect(result.status).toBe('gates-approved');
    if (result.status !== 'gates-approved') throw new Error(`Expected gates-approved result, received ${result.status}.`);
    expect(result.masterPath).toBe('/work/master.mp4');
    const master = calls.find((argv) => argv.includes('-movflags'))!;
    if (selection.expected === 'silent') expect(master).toEqual(expect.arrayContaining(['-an']));
    if (selection.expected === 'original') expect(master).toEqual(expect.arrayContaining(['-map', '0:a:0', '-c:a', 'aac']));
    if (selection.expected === 'soundtrack') expect(master).toEqual(expect.arrayContaining(['-i', '/audio/soundtrack.wav', '-map', '1:a', '-c:a', 'aac']));
  }
});

test('runAdPipeline returns blocked reasons and supplied clips without rendering a master', async () => {
  const calls: string[][] = [];
  const suppliedClips = clips().filter((clip) => clip.beatIndex !== 1);
  const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, createAdPipelineDeps({
    ask: () => true,
    report: () => {},
    production: {
      render: { run: async (argv: readonly string[]) => { calls.push([...argv]); return { stdout: '', stderr: '', exitCode: 0 }; } },
      assembly: { scene, clips: suppliedClips, options },
    },
  }));

  expect(result.status).toBe('gates-approved');
  if (result.status !== 'gates-approved') throw new Error(`Expected gates-approved result, received ${result.status}.`);
  expect(result.blocked).toEqual(['Beat 1 has no supplied clip.']);
  expect(result.clips).toEqual(suppliedClips);
  expect(result.masterPath).toBeUndefined();
  expect(calls).toEqual([]);
});

test('runAdPipeline exposes named trim disagreements from an assembled master', async () => {
  const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, createAdPipelineDeps({
    ask: () => true,
    report: () => {},
    production: {
      render: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
      assembly: {
        scene,
        clips: [{ ...clips()[0], trimToSeconds: 3 }, ...clips().slice(1)],
        options,
      },
    },
  }));

  if (result.status !== 'gates-approved') throw new Error(`Expected gates-approved result, received ${result.status}.`);
  expect(result.trimDisagreement).toEqual([{ beatIndex: 0, clip: 3, scene: 5 }]);
  expect(result.masterPath).toBe('/work/master.mp4');
});

test('runAdPipeline executes an injected soundtrack through the production assembly path', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'ad-assembly-production-'));
  temporaryDirectories.push(workDir);
  const clipsForExecution = [audioClip(workDir, 0), audioClip(workDir, 1)];
  const soundtrack = join(workDir, 'soundtrack.wav');
  run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=4', soundtrack]);
  const runner = {
    run: async (argv: readonly string[]) => {
      const result = Bun.spawnSync({ cmd: [...argv], stdout: 'pipe', stderr: 'pipe' });
      return {
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
        exitCode: result.exitCode,
      };
    },
  };

  const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, createAdPipelineDeps({
    ask: () => true,
    report: () => {},
    production: {
      render: runner,
      assembly: {
        scene: executionScene(true),
        clips: clipsForExecution,
        options: { workDir, outputName: 'production-soundtrack.mp4', dissolveDurationSec: 0.2 },
        masterAudio: { kind: 'soundtrack', path: soundtrack },
      },
    },
  }));

  expect(result.status).toBe('gates-approved');
  const output = join(workDir, 'production-soundtrack.mp4');
  expect(streamTypes(output).sort()).toEqual(['audio', 'video']);
  expectDurationNear(output, 1.8);
}, 30_000);

test('blocks original-audio assembly when a probed clip has no audio stream', () => {
  const plan = buildAssemblyPlan(scene, [{ ...clips()[0], probe: { ...clips()[0].probe!, hasAudio: false } }, ...clips().slice(1)], { ...options, masterAudio: { kind: 'original' } });
  expect(plan.blocked).toEqual(['Cannot preserve original audio: beat 0 has no audio stream.']);
  expect(steps(plan)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(plan.commands[0]).toEqual({ step: 'workdir', argv: ['mkdir', '-p', '/work'], output: '/work' });
});

test('executes original and soundtrack masters plus an original dissolve with video and audio streams', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'ad-assemble-'));
  temporaryDirectories.push(workDir);
  const clipsForExecution = [audioClip(workDir, 0), audioClip(workDir, 1)];

  const original = buildAssemblyPlan(executionScene(false), clipsForExecution, { workDir, outputName: 'original.mp4', masterAudio: { kind: 'original' } });
  executePlan(original);
  expect(streamTypes(join(workDir, 'original.mp4')).sort()).toEqual(['audio', 'video']);

  const soundtrack = join(workDir, 'soundtrack.wav');
  run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=4', soundtrack]);
  const soundtrackPlan = buildAssemblyPlan(executionScene(false), clipsForExecution, { workDir, outputName: 'soundtrack.mp4', masterAudio: { kind: 'soundtrack', path: soundtrack } });
  executePlan(soundtrackPlan);
  const soundtrackOutput = join(workDir, 'soundtrack.mp4');
  expect(streamTypes(soundtrackOutput).sort()).toEqual(['audio', 'video']);
  expectDurationNear(soundtrackOutput, 2);

  const soundtrackDissolvePlan = buildAssemblyPlan(executionScene(true), clipsForExecution, { workDir, outputName: 'soundtrack-dissolve.mp4', masterAudio: { kind: 'soundtrack', path: soundtrack }, dissolveDurationSec: 0.2 });
  executePlan(soundtrackDissolvePlan);
  const soundtrackDissolveOutput = join(workDir, 'soundtrack-dissolve.mp4');
  expect(streamTypes(soundtrackDissolveOutput).sort()).toEqual(['audio', 'video']);
  expectDurationNear(soundtrackDissolveOutput, 1.8);

  const dissolve = buildAssemblyPlan(executionScene(true), clipsForExecution, { workDir, outputName: 'dissolve.mp4', masterAudio: { kind: 'original' }, dissolveDurationSec: 0.2 });
  executePlan(dissolve);
  expect(streamTypes(join(workDir, 'dissolve.mp4')).sort()).toEqual(['audio', 'video']);
}, 30_000);

test('does not treat unprobed or incompatible clips as joinable', () => {
  const unprobed = clips().map(({ probe: _probe, ...clip }) => clip);
  const unprobedPlan = buildAssemblyPlan(scene, unprobed, options);
  expect(unprobedPlan.unprobed).toEqual([0, 1, 2]);
  expect(steps(unprobedPlan)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(unprobedPlan.blocked.join(' ')).toContain('probe');

  expect(unprobedPlan.commands.find((command) => command.step === 'master')).toBeUndefined();

  const incompatible = clips();
  incompatible[2] = { ...incompatible[2], probe: { ...incompatible[2].probe!, fps: '24/1' } };
  const mismatchPlan = buildAssemblyPlan(scene, incompatible, options);
  expect(mismatchPlan.mismatched).toEqual([2]);
  expect(steps(mismatchPlan)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(mismatchPlan.commands.find((command) => command.step === 'master')).toBeUndefined();
  expect(mismatchPlan.blocked.join(' ')).toContain('incompatible');
});

test('accumulates dissolve, hard-cut, and consecutive dissolve outputs without losing a trimmed beat', () => {
  const dissolveScene: SceneSpec = {
    ...scene,
    beats: [
      scene.beats[0],
      { ...scene.beats[1], transitionIn: { kind: 'dissolve', intent: 'fade' } },
      { ...scene.beats[2], transitionIn: { kind: 'hard-cut', intent: 'cut' } },
      { ...scene.beats[2], startSec: 15, endSec: 20, transitionIn: { kind: 'dissolve', intent: 'fade' } },
      { ...scene.beats[2], startSec: 20, endSec: 25, transitionIn: { kind: 'dissolve', intent: 'fade' } },
    ],
    axes: { ...scene.axes, totalSeconds: 25 },
  };
  const plan = buildAssemblyPlan(dissolveScene, clips().concat([
    { beatIndex: 3, path: '/source/3.mp4', probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: true } },
    { beatIndex: 4, path: '/source/4.mp4', probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: true } },
  ]), options);
  const joins = plan.commands.filter((command) => command.step === 'concat' || command.step === 'xfade');

  expect(steps(plan)).toEqual(['workdir', 'trim', 'trim', 'trim', 'trim', 'trim', 'xfade', 'concat', 'xfade', 'xfade', 'safezone', 'master']);
  expect(joins[0].argv).toContain('[0][1]xfade=transition=fade:duration=0.3:offset=4.7');
  expect(joins[1].argv).toEqual(expect.arrayContaining(['/work/joined-1.mp4', '/work/trim-2.mp4']));
  expect(joins[2].argv).toContain('[0][1]xfade=transition=fade:duration=0.3:offset=14.4');
  expect(joins[3].argv).toContain('[0][1]xfade=transition=fade:duration=0.3:offset=19.1');
  expect(plan.commands.find((command) => command.step === 'master')!.argv).toContain('/work/joined-4.mp4');
});

test('blocks invalid or too-long dissolve durations and omits dependent commands', () => {
  for (const dissolveDurationSec of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 5]) {
    const dissolveScene: SceneSpec = {
      ...scene,
      beats: [scene.beats[0], { ...scene.beats[1], transitionIn: { kind: 'dissolve', intent: 'fade' } }, scene.beats[2]],
    };
    const plan = buildAssemblyPlan(dissolveScene, clips(), { ...options, dissolveDurationSec });
    expect(steps(plan)).toEqual(['workdir', 'trim', 'trim', 'trim']);
    expect(plan.blocked).not.toHaveLength(0);
  }

  const valid = buildAssemblyPlan({ ...scene, beats: [scene.beats[0], { ...scene.beats[1], transitionIn: { kind: 'dissolve', intent: 'fade' } }, scene.beats[2]] }, clips(), { ...options, dissolveDurationSec: 1 });
  expect(valid.commands.find((command) => command.step === 'xfade')!.argv).toContain('[0][1]xfade=transition=fade:duration=1:offset=4');
});

test('validates dissolves at their emitted millisecond precision', () => {
  const dissolveScene: SceneSpec = {
    ...scene,
    beats: [scene.beats[0], { ...scene.beats[1], transitionIn: { kind: 'dissolve', intent: 'fade' } }, scene.beats[2]],
  };

  for (const dissolveDurationSec of [0.0001, 4.9999]) {
    const plan = buildAssemblyPlan(dissolveScene, clips(), { ...options, dissolveDurationSec });
    expect(steps(plan)).toEqual(['workdir', 'trim', 'trim', 'trim']);
    expect(plan.blocked.join(' ')).toContain('Dissolve');
  }

  const valid = buildAssemblyPlan(dissolveScene, clips(), { ...options, dissolveDurationSec: 4.999 });
  expect(valid.commands.find((command) => command.step === 'xfade')!.argv).toContain('[0][1]xfade=transition=fade:duration=4.999:offset=0.001');
});

test('blocks output collisions with intermediate outputs and supplied source clips', () => {
  const intermediateCollision = buildAssemblyPlan(scene, clips(), { ...options, outputName: 'joined-2.mp4' });
  expect(steps(intermediateCollision)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(intermediateCollision.commands[0]).toEqual({ step: 'workdir', argv: ['mkdir', '-p', '/work'], output: '/work' });
  expect(intermediateCollision.masterPath).toBe('/work/joined-2.mp4');
  expect(intermediateCollision.masterPath).not.toBe('');
  expect(intermediateCollision.blocked.join(' ')).toContain('/work/joined-2.mp4');

  const sourceCollision = buildAssemblyPlan(scene, [{ ...clips()[0], path: '/work/trim-0.mp4' }, ...clips().slice(1)], options);
  expect(steps(sourceCollision)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(sourceCollision.blocked.join(' ')).toContain('/work/trim-0.mp4');

  const relativeWorkDirSoundtrackCollision = buildAssemblyPlan(scene, clips(), { workDir: 'work', outputName: 'master.mp4', masterAudio: { kind: 'soundtrack', path: join(process.cwd(), 'work', 'trim-0.mp4') } });
  expect(steps(relativeWorkDirSoundtrackCollision)).toEqual(['workdir', 'trim', 'trim', 'trim']);
  expect(relativeWorkDirSoundtrackCollision.blocked.join(' ')).toContain('work/trim-0.mp4');

  expect(buildAssemblyPlan(scene, clips(), options).blocked).toEqual([]);
});

test('normalizes safezone input to 1080x1920 and blocks it outside the vertical target while retaining master planning', () => {
  const vertical = buildAssemblyPlan(scene, clips().map((clip) => ({ ...clip, probe: { ...clip.probe!, width: 720, height: 1280 } })), options);
  expect(vertical.commands.find((command) => command.step === 'safezone')!.argv).toContain('scale=1080:1920:flags=lanczos,drawbox=y=0:h=192,drawbox=y=1536:h=384,drawbox=x=972:w=108');

  const plan = buildAssemblyPlan({ ...scene, aspectRatio: '16:9' }, clips(), options);
  expect(steps(plan)).not.toContain('safezone');
  expect(plan.safezonePath).toBeUndefined();
  expect(plan.blocked.join(' ')).toContain('Safezone overlay');
  expect(plan.commands.find((command) => command.step === 'master')!.argv).toContain('scale=1920:1080:flags=lanczos,fps=30/1');
});

// 🔴 회귀 가드 — 초판은 `-ss` 에 «타임라인 시작 초»(beat.startSec)를 넣었다.
//    클립 하나가 «한 비트»이므로, 비트4(타임라인 28~30s)는 «4초짜리 파일의 28초 지점» → ***빈 영상***.
//    ⇒ `-ss` 는 «클립 «안»의 오프셋»이고 기본은 0 이다.
test('⛔ 트림의 -ss 는 «클립 안의 위치»다 — 타임라인 위치가 «아니다»', () => {
  const plan = buildAssemblyPlan(scene, clips(), { workDir: '/w', outputName: 'OUT' });
  const trims = plan.commands.filter((c) => c.step === 'trim');
  expect(trims).toHaveLength(scene.beats.length);
  for (const t of trims) {
    const ss = t.argv[t.argv.indexOf('-ss') + 1];
    expect(ss).toBe('0');           // ⛔ 28 이 나오면 그 컷은 «빈 영상»이 된다
  }
  // ⊕ -t 는 «비트 길이»다 — 각 비트의 endSec−startSec 와 «같다»
  for (const [i, t] of trims.entries()) {
    const beat = scene.beats[i]!;
    expect(t.argv[t.argv.indexOf('-t') + 1]).toBe(String(beat.endSec - beat.startSec));
  }
});

test('⭐ 앞머리를 버리고 싶으면 «명시»한다 — 그때만 0 이 아니다', () => {
  const plan = buildAssemblyPlan(scene, clips(), { workDir: '/w', outputName: 'OUT', clipHeadTrimSec: 0.2 });
  const first = plan.commands.find((c) => c.step === 'trim')!;
  expect(first.argv[first.argv.indexOf('-ss') + 1]).toBe('0.2');
});

// 🔴 회귀 가드 — 실물 ffmpeg 으로 돌려서 잡았다:
//    `Unable to choose an output format for '/tmp/…/OUT'` — 확장자가 없으면 컨테이너를 «못 정한다».
test('⛔ 최종 산출은 «확장자»를 가진다 — 없으면 ffmpeg 이 포맷을 못 정한다', () => {
  const withoutExt = buildAssemblyPlan(scene, clips(), { workDir: '/w', outputName: 'OUT' });
  const master = withoutExt.commands.find((c) => c.step === 'master')!;
  expect(master.output).toBe('/w/OUT.mp4');
  expect(withoutExt.masterPath).toBe(master.output);
  expect(master.argv[master.argv.length - 1]).toBe('/w/OUT.mp4');

  // ⊕ 이미 확장자가 있으면 «그대로» 둔다 (스킬 규칙: [프로젝트]_[버전]_[비율].mp4)
  const withExt = buildAssemblyPlan(scene, clips(), { workDir: '/w', outputName: 'GLOWFIT_v1_9x16.mp4' });
  const existingMaster = withExt.commands.find((c) => c.step === 'master')!;
  expect(existingMaster.output).toBe('/w/GLOWFIT_v1_9x16.mp4');
  expect(withExt.masterPath).toBe(existingMaster.output);
});
