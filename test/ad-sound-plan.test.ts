import { expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';
import { buildSoundPlan, extractElevenLabsTimestampResponse, type VoiceLine } from '../src/ad-pipeline/sound-plan.js';

const scene: SceneSpec = {
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'one', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 12, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'two', checks: [] },
    { role: 'buildup', startSec: 12, endSec: 20, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'three', checks: [] },
    { role: 'climax', startSec: 20, endSec: 28, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'four', checks: [] },
    { role: 'transition', startSec: 28, endSec: 30, emotion: { primary: 'a', secondary: 'b' }, camera: { move: 'static', shotSize: 'wide' }, model: 'model', audio: false, promptCore: 'five', checks: [] },
  ],
  axes: { hook: 'hook', totalSeconds: 30, lock: { lens: '50mm', lighting: 'day', grade: 'neutral', texture: 'clean' } },
  aspectRatio: '9:16',
  forbidden: [],
  provenance: 'generated',
};

const lines: readonly VoiceLine[] = [0, 1, 2, 3, 4].map((beatIndex) => ({ beatIndex, text: `line ${beatIndex}`, voiceId: 'voice-a' }));
const workDir = '/tmp/ad-sound-plan';
const musicBedPath = '/tmp/assets/declared-bed.wav';
const soundOptions = { workDir, musicBedPath, totalSeconds: 30 };

type SoundStep = 'tts' | 'trim-silence' | 'tempo' | 'vo-track' | 'loudnorm-measure' | 'duck-mix';
function command(plan: ReturnType<typeof buildSoundPlan>, step: SoundStep) {
  return plan.commands.filter((item) => item.step === step);
}

test('requires a declared music bed and uses it for loudnorm measurement and duck mixing', () => {
  const missing = buildSoundPlan(scene, lines, { workDir, totalSeconds: 30 });
  const provided = buildSoundPlan(scene, lines, soundOptions);

  expect(missing.blocked).toEqual(['Music bed path was not supplied; no loudnorm or ducking commands were planned.']);
  expect(command(missing, 'loudnorm-measure')).toHaveLength(0);
  expect(command(missing, 'duck-mix')).toHaveLength(0);
  expect(provided.blocked).toEqual([]);
  expect(command(provided, 'loudnorm-measure')[0]!.argv).toContain(musicBedPath);
  expect(command(provided, 'duck-mix')[0]!.argv).toContain(musicBedPath);
});

test('preserves missing-beat and no-valid-lines blocked reasons with a declared music bed', () => {
  const plan = buildSoundPlan(scene, [{ beatIndex: 9, text: 'missing', voiceId: 'voice-b' }], soundOptions);

  expect(plan.blocked).toEqual([
    'Voice line references missing beat 9.',
    'No valid voice lines were supplied; no VO or ducking commands were planned.',
  ]);
});

test('reports a missing music bed alongside each no-valid-lines reason', () => {
  const noLines = buildSoundPlan(scene, [], { workDir, totalSeconds: 30 });
  const missingBeat = buildSoundPlan(scene, [{ beatIndex: 9, text: 'missing', voiceId: 'voice-b' }], { workDir, totalSeconds: 30 });

  expect(noLines.blocked).toEqual([
    'Music bed path was not supplied; no loudnorm or ducking commands were planned.',
    'No valid voice lines were supplied; no VO or ducking commands were planned.',
  ]);
  expect(missingBeat.blocked).toEqual([
    'Voice line references missing beat 9.',
    'Music bed path was not supplied; no loudnorm or ducking commands were planned.',
    'No valid voice lines were supplied; no VO or ducking commands were planned.',
  ]);
});

test('plans ordered TTS, two-sided silence trimming, natural tempo, and beat-start placements without execution', () => {
  const plan = buildSoundPlan(scene, [...lines].reverse(), {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    measuredLineSeconds: { 0: 5, 1: 7, 2: 8.5, 3: 8, 4: 2 },
  });

  expect(command(plan, 'tts')).toHaveLength(10);
  expect(command(plan, 'trim-silence')).toHaveLength(5);
  for (const trim of command(plan, 'trim-silence')) {
    expect(trim.argv.join(' ')).toContain('areverse,silenceremove');
    expect(trim.argv.join(' ')).toContain(',areverse');
  }
  expect(command(plan, 'tempo')).toHaveLength(1);
  for (const step of ['trim-silence', 'tempo', 'vo-track', 'duck-mix'] as const) {
    for (const ffmpeg of command(plan, step)) {
      expect(ffmpeg.argv.slice(0, 2)).toEqual(['ffmpeg', '-y']);
    }
  }
  const track = command(plan, 'vo-track')[0];
  expect(track.argv.join(' ')).toContain('adelay=0|0');
  expect(track.argv.join(' ')).toContain('adelay=5000|5000');
  expect(track.argv.join(' ')).toContain('adelay=12000|12000');
  expect(track.argv.join(' ')).toContain('adelay=20000|20000');
  expect(track.argv.join(' ')).toContain('adelay=28000|28000');
  expect(track.argv.join(' ')).toContain('atrim=0:30');
  expect(track.argv.join(' ')).not.toContain('atrim=0:5');
  expect(track.argv.join(' ')).toContain('loudnorm=I=-14');
  const duckMix = command(plan, 'duck-mix')[0].argv.join(' ');
  expect(duckMix).toContain('volume=-14dB');
  expect(duckMix).toContain('sidechaincompress=threshold=0.05:ratio=1');
  expect(duckMix).toContain("volume='if(gt(");
  expect(duckMix).toContain(",-8dB,0dB)':eval=frame");
  expect(duckMix).toContain('amix=inputs=2:normalize=0');
  expect(duckMix).toContain('loudnorm=I=-14:TP=-1.5:LRA=11');
  expect(duckMix.indexOf('loudnorm=I=-14:TP=-1.5:LRA=11')).toBeLessThan(duckMix.indexOf('alimiter=limit=0.891:level=false'));
  expect(duckMix).toContain('alimiter=limit=0.891:level=false');
  expect(duckMix).toContain('atrim=0:30');
  const customTargetPlan = buildSoundPlan(scene, lines, {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    measuredLineSeconds: { 0: 5, 1: 7, 2: 8.5, 3: 8, 4: 2 },
    targetLufs: -16,
  });
  const customDuckMix = command(customTargetPlan, 'duck-mix')[0].argv.join(' ');
  expect(customDuckMix).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
  expect(customDuckMix.indexOf('loudnorm=I=-16:TP=-1.5:LRA=11')).toBeLessThan(customDuckMix.indexOf('alimiter=limit=0.891:level=false'));
  expect(plan).toMatchObject({ unmeasured: [], overTempo: [], blocked: [] });
});

test('uses finite scene-duration padding while preserving sound graph filters', () => {
  const totalSeconds = 31.5;
  const plan = buildSoundPlan(scene, lines, {
    workDir,
    musicBedPath,
    totalSeconds,
    measuredLineSeconds: { 0: 5, 1: 7, 2: 8.5, 3: 8, 4: 2 },
  });
  const expectedPad = `apad=whole_dur=${totalSeconds},atrim=0:${totalSeconds}`;
  const track = command(plan, 'vo-track')[0]!.argv.join(' ');
  const measurement = command(plan, 'loudnorm-measure')[0]!.argv.join(' ');
  const duckMix = command(plan, 'duck-mix')[0]!.argv.join(' ');

  expect(track).toContain(expectedPad);
  expect(track).toContain('amix=inputs=5:normalize=0');
  expect(track).toContain('loudnorm=I=-14:TP=-1.5:LRA=11');
  for (const graph of [measurement, duckMix]) {
    expect(graph).toContain(expectedPad);
    expect(graph).toContain('sidechaincompress=threshold=0.05:ratio=1:attack=15:release=350');
    expect(graph).toContain("volume='if(gt(");
    expect(graph).toContain(",-8dB,0dB)':eval=frame");
    expect(graph).toContain('amix=inputs=2:normalize=0');
  }
  expect(measurement).toContain('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json');
  expect(duckMix).toContain('loudnorm=I=-14:TP=-1.5:LRA=11');
  expect(duckMix).toContain('alimiter=limit=0.891:level=false');
});

test('plans an execution-free loudnorm measurement and only applies complete measurements linearly', () => {
  const spawn = spyOn(Bun, 'spawn');
  const onePass = buildSoundPlan(scene, lines, { workDir, musicBedPath, totalSeconds: 30 });
  const measurement = command(onePass, 'loudnorm-measure')[0]!;
  expect(measurement.argv).toEqual(expect.arrayContaining(['-f', 'null', '/dev/null']));
  expect(measurement.argv.join(' ')).toContain('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json');
  expect(measurement.argv).not.toContain(`${workDir}/soundtrack.wav`);

  const measured = buildSoundPlan(scene, lines, {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    loudnormMeasurement: `ffmpeg log\n${JSON.stringify({ input_i: '-16.19', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71', target_offset: '1.41' })}\ntrailing log`,
  });
  const linearMix = command(measured, 'duck-mix')[0]!.argv.join(' ');
  for (const field of ['measured_I=-16.19', 'measured_TP=-1.50', 'measured_LRA=17.20', 'measured_thresh=-27.71', 'offset=1.41', 'linear=true']) {
    expect(linearMix).toContain(field);
  }
  expect(linearMix.indexOf('linear=true')).toBeLessThan(linearMix.indexOf('alimiter=limit=0.891:level=false'));

  const positivePeak = buildSoundPlan(scene, lines, {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    loudnormMeasurement: JSON.stringify({ input_i: '-16.19', input_tp: '1', input_lra: '17.20', input_thresh: '-27.71', target_offset: '1.41' }),
  });
  expect(command(positivePeak, 'duck-mix')[0]!.argv.join(' ')).toContain('measured_TP=1');
  expect(command(positivePeak, 'duck-mix')[0]!.argv.join(' ')).toContain('linear=true');

  for (const loudnormMeasurement of [
    JSON.stringify({ input_i: '-16.19', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71' }),
    '{not-json',
    JSON.stringify({ input_i: 'garbage', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71', target_offset: '1.41' }),
    JSON.stringify({ input_i: '', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71', target_offset: '1.41' }),
    JSON.stringify({ input_i: '-inf', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71', target_offset: '1.41' }),
    JSON.stringify({ input_i: '-16.19', input_tp: '-1.50', input_lra: '-1', input_thresh: '-27.71', target_offset: '1.41' }),
    JSON.stringify({ input_i: '-16.19', input_tp: '-1.50', input_lra: '17.20', input_thresh: '1', target_offset: '1.41' }),
    JSON.stringify({ input_i: '-16.19', input_tp: '-1.50', input_lra: '17.20', input_thresh: '-27.71', target_offset: '100' }),
  ]) {
    const fallback = buildSoundPlan(scene, lines, { workDir, musicBedPath, totalSeconds: 30, loudnormMeasurement });
    expect(command(fallback, 'duck-mix')[0]!.argv.join(' ')).toContain('loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.891:level=false');
    expect(command(fallback, 'duck-mix')[0]!.argv.join(' ')).not.toContain('linear=true');
  }
  expect(spawn).not.toHaveBeenCalled();
  spawn.mockRestore();
});

test('plans one ElevenLabs timestamp response and extracts its named audio and word-alignment outputs without execution', async () => {
  const spawn = spyOn(Bun, 'spawn');
  const plan = buildSoundPlan(scene, [lines[0]], soundOptions);
  const tts = command(plan, 'tts');

  expect(tts).toHaveLength(2);
  expect(tts[0]!.argv.join(' ')).toContain('/text-to-speech/voice-a/with-timestamps?output_format=mp3_44100_128');
  expect(tts[0]!.output).toBe(`${workDir}/vo-0-0-timestamps.json`);
  expect(tts[1]!.argv).toEqual(expect.arrayContaining(['bun', '--extract-elevenlabs-timestamps', `${workDir}/vo-0-0-timestamps.json`, `${workDir}/vo-0-0.mp3`, `${workDir}/vo-0-0-word-alignment.json`]));
  expect(tts[1]!.outputs).toEqual([
    { name: 'audio', path: `${workDir}/vo-0-0.mp3` },
    { name: 'wordAlignment', path: `${workDir}/vo-0-0-word-alignment.json` },
  ]);
  expect(command(plan, 'trim-silence')[0]!.argv).toContain(`${workDir}/vo-0-0.mp3`);
  expect(spawn).not.toHaveBeenCalled();
  spawn.mockRestore();

  const directory = await mkdtemp(join(tmpdir(), 'ad-sound-plan-'));
  const responsePath = join(directory, 'timestamps.json');
  const audioPath = join(directory, 'voice.mp3');
  const alignmentPath = join(directory, 'alignment.json');
  const response = {
    audio_base64: Buffer.from([0, 1, 2, 255]).toString('base64'),
    alignment: {
      characters: ['안', '녕'],
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.1, 0.2],
    },
  };
  try {
    await writeFile(responsePath, JSON.stringify(response));
    const extractor = tts[1]!.argv;
    const result = Bun.spawnSync([extractor[0]!, extractor[1]!, ...extractor.slice(2, 3), responsePath, audioPath, alignmentPath]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(audioPath)).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(JSON.parse(await readFile(alignmentPath, 'utf8'))).toEqual(response.alignment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unusable ElevenLabs alignments before writing either named output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ad-sound-plan-invalid-alignment-'));
  const responsePath = join(directory, 'timestamps.json');
  const audioPath = join(directory, 'voice.mp3');
  const alignmentPath = join(directory, 'alignment.json');
  const audio_base64 = Buffer.from([0, 1, 2, 255]).toString('base64');
  const invalidAlignments = [
    null,
    { characters: ['안'], character_start_times_seconds: [0] },
    { characters: ['안'], character_start_times_seconds: [0], character_end_times_seconds: [] },
    { characters: ['안'], character_start_times_seconds: [0.2], character_end_times_seconds: [0.1] },
    { characters: ['안'], character_start_times_seconds: [Number.NaN], character_end_times_seconds: [0.1] },
  ];
  try {
    for (const alignment of invalidAlignments) {
      await writeFile(responsePath, JSON.stringify({ audio_base64, alignment }));
      await expect(extractElevenLabsTimestampResponse(responsePath, audioPath, alignmentPath)).rejects.toThrow('ElevenLabs timestamp response alignment');
      expect(await Bun.file(audioPath).exists()).toBe(false);
      expect(await Bun.file(alignmentPath).exists()).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps generated sound artifacts under the required work directory without embedding TTS secrets', () => {
  const plan = buildSoundPlan(scene, [{ ...lines[0], voiceId: 'ksaI0TCD9BstzEzlxj4q' }], { workDir: `${workDir}/`, musicBedPath, totalSeconds: 30, measuredLineSeconds: { 0: 5.25 } });
  const tts = command(plan, 'tts')[0]!;

  expect(plan.commands.map((item) => item.output)).toEqual([
    `${workDir}/vo-0-0-timestamps.json`,
    `${workDir}/vo-0-0.mp3`,
    `${workDir}/vo-0-0-trimmed.wav`,
    `${workDir}/vo-0-0-tempo.wav`,
    `${workDir}/voice-track.wav`,
    '/dev/null',
    `${workDir}/soundtrack.wav`,
  ]);
  expect(plan.commands.flatMap((item) => item.argv).filter((value) => value.includes('$'))).toEqual([]);
  expect(tts.argv).toEqual(expect.arrayContaining([
    '--fail-with-body',
    '--variable', '%ELEVENLABS_API_KEY',
    '--expand-header', 'xi-api-key: {{ELEVENLABS_API_KEY}}',
  ]));
  expect(tts.argv).not.toContain('xi-api-key: $ELEVENLABS_API_KEY');
});

test('keeps missing TTS durations explicit and emits no tempo commands', () => {
  const plan = buildSoundPlan(scene, lines, { workDir, musicBedPath, totalSeconds: 30 });

  expect(command(plan, 'tempo')).toHaveLength(0);
  expect(plan.unmeasured).toEqual(['vo-0-0', 'vo-1-0', 'vo-2-0', 'vo-3-0', 'vo-4-0']);
  expect(command(plan, 'vo-track')[0].argv.join(' ')).toContain('vo-0-0-trimmed.wav');
  const graphs = ['loudnorm-measure', 'duck-mix'].map((step) => command(plan, step as SoundStep)[0]!.argv.join(' '));
  for (const graph of graphs) expect(graph).toContain("volume='0dB':eval=frame");
});

test('applies frame-evaluated ducking to the synthetic music-bed path (SKIP: ffmpeg unavailable)', () => {
  if (!existsSync('/usr/bin/ffmpeg') && Bun.spawnSync({ cmd: ['which', 'ffmpeg'], stdout: 'ignore', stderr: 'ignore' }).exitCode !== 0) {
    console.warn('SKIP: ffmpeg unavailable; synthetic music-bed ducking execution regression not run');
    return;
  }

  const plan = buildSoundPlan(scene, [lines[0]], {
    workDir,
    musicBedPath,
    totalSeconds: 2,
    measuredLineSeconds: { 0: 1 },
  });
  const graph = command(plan, 'duck-mix')[0]!.argv[command(plan, 'duck-mix')[0]!.argv.indexOf('-filter_complex') + 1]!;
  const bedGraph = `${graph.slice(0, graph.indexOf(';[ducked][vo]amix')).replace('[ducked]', '[bed-only]')};[vo]anullsink`;
  const execution = Bun.spawnSync({
    cmd: ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,1)\\,0.1*sin(2*PI*880*t)\\,0):s=48000:d=2', '-filter_complex', bedGraph, '-map', '[bed-only]', '-f', 'f32le', '-'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(execution.exitCode, new TextDecoder().decode(execution.stderr)).toBe(0);

  const samples = new Float32Array(execution.stdout.buffer, execution.stdout.byteOffset, execution.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const meanSquare = (start: number, end: number) => {
    let total = 0;
    for (let index = start; index < end; index += 1) total += samples[index]! ** 2;
    return total / (end - start);
  };
  const sampleRate = 48_000;
  const insideDb = 10 * Math.log10(meanSquare(Math.floor(sampleRate * 0.25), Math.floor(sampleRate * 0.75)));
  const outsideDb = 10 * Math.log10(meanSquare(Math.floor(sampleRate * 1.25), Math.floor(sampleRate * 1.75)));
  expect(outsideDb - insideDb).toBeGreaterThanOrEqual(5);
});

test('allows narration to cross a cut without truncating it, while preserving later input and total duration', () => {
  const plan = buildSoundPlan(scene, [lines[0], lines[1]], { workDir, musicBedPath, totalSeconds: 30, measuredLineSeconds: { 0: 6, 1: 7 } });

  expect(command(plan, 'tempo')).toHaveLength(0);
  const track = command(plan, 'vo-track')[0].argv.join(' ');
  expect(track).toContain('vo-0-0-trimmed.wav');
  expect(track).toContain('vo-1-0-trimmed.wav');
  expect(track).toContain('adelay=0|0');
  expect(track).toContain('adelay=5000|5000');
  expect(track).not.toContain('atrim=0:5');
  expect(track).toContain('atrim=0:30');
  expect(command(plan, 'duck-mix')[0].argv.join(' ')).toContain('between(t,0,6)');
  expect(plan.overTempo).toEqual([{ beatIndex: 0, required: 6 / 5 }]);
});

test('reports an over-tempo script instead of silently clamping it to the maximum', () => {
  const threeSecondScene: SceneSpec = { ...scene, beats: [{ ...scene.beats[0], startSec: 0, endSec: 3 }, ...scene.beats.slice(1)], axes: { ...scene.axes, totalSeconds: 28 } };
  const plan = buildSoundPlan(threeSecondScene, [lines[0]], { workDir, musicBedPath, totalSeconds: 28, measuredLineSeconds: { 0: 4 }, maxTempo: 1.10 });

  expect(plan.overTempo).toEqual([{ beatIndex: 0, required: 4 / 3 }]);
  expect(command(plan, 'tempo')).toHaveLength(0);
  expect(plan.commands.flatMap((item) => item.argv)).not.toContain('atempo=1.1');
});

test('treats duplicate beat lines as unmeasured rather than reusing one ambiguous measurement', () => {
  const duplicated = buildSoundPlan(scene, [lines[0], { ...lines[0], text: 'second line' }], {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    measuredLineSeconds: { 0: 5 },
  });

  expect(command(duplicated, 'tts').map((item) => item.output)).toEqual([
    `${workDir}/vo-0-0-timestamps.json`, `${workDir}/vo-0-0.mp3`,
    `${workDir}/vo-0-1-timestamps.json`, `${workDir}/vo-0-1.mp3`,
  ]);
  expect(command(duplicated, 'tempo')).toHaveLength(0);
  expect(duplicated.unmeasured).toEqual(['vo-0-1']);
  expect(command(duplicated, 'vo-track')[0].argv.join(' ')).toContain('vo-0-1-trimmed.wav');
});

test('skips invalid empty VO graphs and opens silence calibration without selecting voices', () => {
  const empty = buildSoundPlan(scene, [{ beatIndex: 9, text: 'missing', voiceId: 'voice-b' }], { workDir, musicBedPath, totalSeconds: 30 });
  const plan = buildSoundPlan(scene, [{ beatIndex: 0, text: 'known', voiceId: 'voice-a' }], {
    workDir,
    musicBedPath,
    totalSeconds: 30,
    silenceThreshold: '-35dB',
  });

  expect(command(empty, 'vo-track')).toHaveLength(0);
  expect(command(empty, 'duck-mix')).toHaveLength(0);
  expect(empty.blocked).toEqual([
    'Voice line references missing beat 9.',
    'No valid voice lines were supplied; no VO or ducking commands were planned.',
  ]);
  expect(command(plan, 'trim-silence')[0].argv.join(' ')).toContain('start_threshold=-35dB');
  // ⛔ `elevenlabs-tts` 라는 명령은 «없다» — 스킬이 쓰는 것은 `curl` 이다(references/audio.md).
  //    ⇒ voiceId 는 «URL 안»에 산다. 낱개 원소로 찾으면 계약을 잘못 무는 것이다.
  const tts = command(plan, 'tts')[0]!.argv;
  expect(tts[0]).toBe('curl');
  expect(tts.join(' ')).toContain('api.elevenlabs.io/v1/text-to-speech/voice-a');
  expect(tts.join(' ')).toContain('eleven_v3');
  expect(tts).toContain('--fail-with-body');
  expect(tts).toEqual(expect.arrayContaining([
    '--variable', '%ELEVENLABS_API_KEY',
    '--expand-header', 'xi-api-key: {{ELEVENLABS_API_KEY}}',
  ]));
  expect(tts.join(' ')).not.toContain('$ELEVENLABS_API_KEY');
});

// 🔴 회귀 가드 — 초판은 `elevenlabs-tts` 라는 «없는 명령»을 지어냈다.
//    🩸 이 저장소가 적은 병: 「없는 길을 주면 자식이 그것을 «만든다»」.
test('⛔ TTS 명령은 «실재하는» 것이어야 한다 — 없는 CLI 를 지어내지 않는다', () => {
  const plan = buildSoundPlan(scene, lines, { workDir, musicBedPath, totalSeconds: 30 });
  for (const c of plan.commands) {
    // 이 파이프라인이 아는 실행 파일은 «둘»뿐이다
    expect(['bun', 'curl', 'ffmpeg']).toContain(c.argv[0]);
  }
  // ⊕ 스킬이 못 박은 광고 VO 세팅이 명령에 «있다»
  const tts = plan.commands.find((c) => c.step === 'tts')!.argv.join(' ');
  expect(tts).toContain('"stability":0.45');
  expect(tts).toContain('"similarity_boost":0.8');
});
