import { expect, test } from 'bun:test';
import { buildAssemblyPlan } from '../src/ad-pipeline/assemble.js';
import { buildClipProbePlan, materializeClipFiles, type ClipProbeOutputs } from '../src/ad-pipeline/clip-materialize.js';
import type { RetainPlan } from '../src/ad-pipeline/retain.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

const retainPlan: RetainPlan = {
  commands: [0, 1, 2].map((beatIndex) => ({
    beatIndex,
    download: ['curl', `https://vendor.example/beat-${beatIndex}.mp4`],
    localPath: `/retained/beat-${beatIndex}.mp4`,
    s3Key: `elanous/ad-assets/beat-${beatIndex}.mp4`,
  })),
  estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: [], s3Skipped: false,
};

const scene: SceneSpec = {
  beats: [0, 1, 2].map((index) => ({
    role: index === 0 ? 'hook' : 'transition', startSec: index * 5, endSec: (index + 1) * 5,
    emotion: { primary: 'calm', secondary: 'focused' }, camera: { move: 'static', shotSize: 'medium' },
    model: 'model', audio: true, promptCore: 'frame', checks: [],
  })),
  axes: { hook: 'hook', totalSeconds: 15, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'film' } },
  aspectRatio: '9:16', forbidden: [], provenance: 'generated',
};

function probe(hasAudio = true, fps = '30/1'): string {
  return JSON.stringify({ streams: [
    { codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: fps, codec_name: 'h264' },
    ...(hasAudio ? [{ codec_type: 'audio', codec_name: 'aac' }] : []),
  ] });
}

function outputs(overrides: ClipProbeOutputs = {}): ClipProbeOutputs {
  return { 0: { stdout: probe() }, 1: { stdout: probe() }, 2: { stdout: probe() }, ...overrides };
}

test('plans one JSON ffprobe command per retained local file without execution', () => {
  const plan = buildClipProbePlan(retainPlan);

  expect(plan.commands).toHaveLength(3);
  expect(plan.commands.map(({ beatIndex }) => beatIndex)).toEqual([0, 1, 2]);
  for (const [index, command] of plan.commands.entries()) {
    expect(command.argv).toEqual(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,codec_name', '-of', 'json', retainPlan.commands[index]!.localPath]);
  }
});

test('materializes complete probes into canonical clip files', () => {
  const result = materializeClipFiles(retainPlan, outputs());

  expect(result.unprobed).toEqual([]);
  expect(result.clips).toEqual([0, 1, 2].map((beatIndex) => ({
    beatIndex, path: `/retained/beat-${beatIndex}.mp4`,
    probe: { width: 1080, height: 1920, fps: '30/1', codec: 'h264', hasAudio: true },
  })));
});

test('preserves a missing probe as an explicitly unprobed clip without fabricated zero values', () => {
  const result = materializeClipFiles(retainPlan, outputs({ 1: undefined }));

  expect(result.unprobed).toEqual([1]);
  expect(result.clips[1]).toEqual({ beatIndex: 1, path: '/retained/beat-1.mp4' });
  expect(result.clips[1]?.probe).toBeUndefined();
});

test('folds malformed probe output into an unprobed clip without losing other measurements', () => {
  const result = materializeClipFiles(retainPlan, outputs({ 1: { stdout: 'not json' } }));

  expect(result.unprobed).toEqual([1]);
  expect(result.clips[0]?.probe).toBeDefined();
  expect(result.clips[1]?.probe).toBeUndefined();
  expect(result.clips[2]?.probe).toBeDefined();
});

test('treats a successfully measured audio-free clip as probed with hasAudio false', () => {
  const result = materializeClipFiles(retainPlan, outputs({ 1: { stdout: probe(false) } }));

  expect(result.unprobed).toEqual([]);
  expect(result.clips[1]?.probe).toMatchObject({ hasAudio: false, width: 1080, height: 1920, fps: '30/1', codec: 'h264' });
});

test.each(['0/0', 'garbage', '0', '-30/1', '30/-1', 'Infinity'])('folds an invalid frame rate %s into an unprobed clip', (fps) => {
  const result = materializeClipFiles(retainPlan, outputs({ 1: { stdout: probe(true, fps) } }));

  expect(result.unprobed).toEqual([1]);
  expect(result.clips[1]).toEqual({ beatIndex: 1, path: '/retained/beat-1.mp4' });
  expect(result.clips[0]?.probe).toBeDefined();
  expect(result.clips[2]?.probe).toBeDefined();
});

test('feeds materialized canonical ClipFiles into the assembly plan', () => {
  const { clips, unprobed } = materializeClipFiles(retainPlan, outputs());
  const assembly = buildAssemblyPlan(scene, clips, { workDir: '/assembly', outputName: 'master.mp4' });

  expect(unprobed).toEqual([]);
  expect(assembly.unprobed).toEqual([]);
  expect(assembly.blocked).toEqual([]);
  expect(assembly.commands.map(({ step }) => step)).toContain('master');
});
