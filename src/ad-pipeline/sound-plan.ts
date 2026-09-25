import type { SceneSpec } from './scene-spec.js';

export interface VoiceLine {
  readonly beatIndex: number;
  readonly text: string;
  readonly voiceId: string;
}

export interface SoundOutput {
  readonly name: 'audio' | 'wordAlignment';
  readonly path: string;
}

export interface SoundCommand {
  readonly step: 'tts' | 'trim-silence' | 'tempo' | 'vo-track' | 'loudnorm-measure' | 'duck-mix';
  readonly argv: readonly string[];
  readonly output: string;
  readonly outputs?: readonly SoundOutput[];
}

interface ElevenLabsWordAlignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

interface ElevenLabsTimestampResponse {
  readonly audio_base64: string;
  readonly alignment: ElevenLabsWordAlignment;
}

function wordAlignment(value: unknown): ElevenLabsWordAlignment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ElevenLabs timestamp response alignment must be an object.');
  const alignment = value as Record<string, unknown>;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) {
    throw new Error('ElevenLabs timestamp response alignment must include character and start/end time arrays.');
  }
  if (characters.length === 0 || characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error('ElevenLabs timestamp response alignment arrays must be non-empty and have matching lengths.');
  }
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const start = starts[index];
    const end = ends[index];
    if (typeof character !== 'string' || character.length === 0 || typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end) || start > end) {
      throw new Error(`ElevenLabs timestamp response alignment entry ${index} is invalid.`);
    }
  }
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

function timestampResponse(value: unknown): ElevenLabsTimestampResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ElevenLabs timestamp response must be an object.');
  const response = value as Record<string, unknown>;
  if (typeof response.audio_base64 !== 'string') throw new Error('ElevenLabs timestamp response is missing audio_base64.');
  return { audio_base64: response.audio_base64, alignment: wordAlignment(response.alignment) };
}

/** Decodes the audio and alignment returned by one ElevenLabs /with-timestamps response. */
export async function extractElevenLabsTimestampResponse(
  responsePath: string,
  audioPath: string,
  wordAlignmentPath: string,
): Promise<void> {
  const response = timestampResponse(JSON.parse(await Bun.file(responsePath).text()));
  await Bun.write(audioPath, Buffer.from(response.audio_base64, 'base64'));
  await Bun.write(wordAlignmentPath, JSON.stringify(response.alignment));
}

if (import.meta.main) {
  const [operation, responsePath, audioPath, wordAlignmentPath] = Bun.argv.slice(2);
  if (operation !== '--extract-elevenlabs-timestamps' || responsePath === undefined || audioPath === undefined || wordAlignmentPath === undefined) {
    throw new Error('Usage: sound-plan.ts --extract-elevenlabs-timestamps <response.json> <audio.mp3> <word-alignment.json>');
  }
  await extractElevenLabsTimestampResponse(responsePath, audioPath, wordAlignmentPath);
}

export interface SoundPlan {
  readonly commands: readonly SoundCommand[];
  /** Beats whose required speed exceeds the allowed natural-sounding tempo. */
  readonly overTempo: readonly { readonly beatIndex: number; readonly required: number }[];
  /** Lines without an unambiguous measured TTS duration, for which no tempo command was planned. */
  readonly unmeasured: readonly string[];
  readonly blocked: readonly string[];
}

export interface SoundPlanOptions {
  /** Directory where every generated sound artifact is written. */
  readonly workDir: string;
  readonly totalSeconds: number;
  /** Pre-measured synthesized durations in seconds, keyed by beat index. One measurement maps to one line. */
  readonly measuredLineSeconds?: Readonly<Record<number, number>>;
  readonly maxTempo?: number;
  readonly targetLufs?: number;
  /** Caller-declared music-bed input consumed by loudness measurement and mixing. */
  readonly musicBedPath?: string;
  /** Music-bed volume in dB; this does not identify the music-bed file. */
  readonly musicBedDb?: number;
  /** FFmpeg silenceremove threshold; callers calibrate this rather than treating a default as optimal. */
  readonly silenceThreshold?: string;
  /** ElevenLabs 모델. 기본은 마케팅 표준 `eleven_v3`. */
  readonly ttsModelId?: string;
  /** JSON captured by the backend from the execution-free loudnorm measurement command. */
  readonly loudnormMeasurement?: string;
}

function pathIn(workDir: string, name: string): string {
  return `${workDir.replace(/\/$/, '')}/${name}`;
}

const DEFAULT_MAX_TEMPO = 1.10;
const DEFAULT_TARGET_LUFS = -14;
const DEFAULT_MUSIC_BED_DB = -14;
const DEFAULT_SILENCE_THRESHOLD = '-45dB';
const DUCK_TARGET_DB = -8;
/** 마케팅 광고 VO 기본 모델. */
const DEFAULT_TTS_MODEL_ID = 'eleven_v3';

interface PlannedLine {
  readonly beatIndex: number;
  readonly input: string;
  readonly measuredSeconds?: number;
}

interface LoudnormMeasurement {
  readonly inputI: string;
  readonly inputTp: string;
  readonly inputLra: string;
  readonly inputThresh: string;
  readonly targetOffset: string;
}

function measuredNumber(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function loudnormMeasurement(text: string | undefined): LoudnormMeasurement | undefined {
  if (text === undefined) return undefined;
  let start = text.lastIndexOf('{');
  while (start >= 0) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const parsed: unknown = JSON.parse(text.slice(start, end + 1));
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) break;
          const value = parsed as Record<string, unknown>;
          if (
            !measuredNumber(value.input_i, -99, 0)
            || !measuredNumber(value.input_tp, -99, 99)
            || !measuredNumber(value.input_lra, 0, 99)
            || !measuredNumber(value.input_thresh, -99, 0)
            || !measuredNumber(value.target_offset, -99, 99)
          ) break;
          return {
            inputI: value.input_i,
            inputTp: value.input_tp,
            inputLra: value.input_lra,
            inputThresh: value.input_thresh,
            targetOffset: value.target_offset,
          };
        } catch {
          break;
        }
      }
    }
    if (start === 0) break;
    start = text.lastIndexOf('{', start - 1);
  }
  return undefined;
}

function lineStem(beatIndex: number, occurrence: number): string {
  return `vo-${beatIndex}-${occurrence}`;
}

function measuredSeconds(
  measurements: Readonly<Record<number, number>> | undefined,
  beatIndex: number,
  occurrence: number,
): number | undefined {
  if (occurrence > 0) return undefined;
  const value = measurements?.[beatIndex];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function duckingExpression(scene: SceneSpec, plannedLines: readonly PlannedLine[]): string {
  const windows = plannedLines.flatMap(({ beatIndex, measuredSeconds }) => {
    if (measuredSeconds === undefined) return [];
    const start = scene.beats[beatIndex]!.startSec;
    return [`between(t,${start},${start + measuredSeconds})`];
  });
  if (windows.length === 0) return '0dB';
  return `if(gt(${windows.join('+')},0),${DUCK_TARGET_DB}dB,0dB)`;
}

/**
 * Produces an execution-free TTS and ffmpeg command plan. A backend owns any API key,
 * network, filesystem, and child-process work needed to execute these argv values.
 */
export function buildSoundPlan(
  scene: SceneSpec,
  lines: readonly VoiceLine[],
  options: SoundPlanOptions,
): SoundPlan {
  const commands: SoundCommand[] = [];
  const overTempo: { beatIndex: number; required: number }[] = [];
  const unmeasured: string[] = [];
  const blocked: string[] = [];
  const maxTempo = options.maxTempo ?? DEFAULT_MAX_TEMPO;
  const targetLufs = options.targetLufs ?? DEFAULT_TARGET_LUFS;
  const musicBedDb = options.musicBedDb ?? DEFAULT_MUSIC_BED_DB;
  const silenceThreshold = options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
  const ttsModelId = options.ttsModelId ?? DEFAULT_TTS_MODEL_ID;
  const plannedLines: PlannedLine[] = [];
  const occurrences = new Map<number, number>();

  for (const line of [...lines].sort((left, right) => left.beatIndex - right.beatIndex)) {
    const beat = scene.beats[line.beatIndex];
    if (beat === undefined) {
      blocked.push(`Voice line references missing beat ${line.beatIndex}.`);
      continue;
    }

    const occurrence = occurrences.get(line.beatIndex) ?? 0;
    occurrences.set(line.beatIndex, occurrence + 1);
    const stem = lineStem(line.beatIndex, occurrence);
    const ttsOutput = pathIn(options.workDir, `${stem}.mp3`);
    const timestampResponseOutput = pathIn(options.workDir, `${stem}-timestamps.json`);
    const wordAlignmentOutput = pathIn(options.workDir, `${stem}-word-alignment.json`);
    const trimmedOutput = pathIn(options.workDir, `${stem}-trimmed.wav`);
    commands.push({
      step: 'tts',
      argv: [
        'curl', '--silent', '--show-error', '--fail-with-body',
        '--variable', '%ELEVENLABS_API_KEY',
        '--expand-header', 'xi-api-key: {{ELEVENLABS_API_KEY}}',
        '-X', 'POST',
        `https://api.elevenlabs.io/v1/text-to-speech/${line.voiceId}/with-timestamps?output_format=mp3_44100_128`,
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify({
          text: line.text,
          model_id: ttsModelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
        '-o', timestampResponseOutput,
      ],
      output: timestampResponseOutput,
    });
    commands.push({
      step: 'tts',
      argv: ['bun', import.meta.path, '--extract-elevenlabs-timestamps', timestampResponseOutput, ttsOutput, wordAlignmentOutput],
      output: ttsOutput,
      outputs: [
        { name: 'audio', path: ttsOutput },
        { name: 'wordAlignment', path: wordAlignmentOutput },
      ],
    });
    commands.push({
      step: 'trim-silence',
      argv: ['ffmpeg', '-y', '-i', ttsOutput, '-af', `silenceremove=start_periods=1:start_threshold=${silenceThreshold},areverse,silenceremove=start_periods=1:start_threshold=${silenceThreshold},areverse`, '-ar', '48000', '-ac', '1', trimmedOutput],
      output: trimmedOutput,
    });

    const measured = measuredSeconds(options.measuredLineSeconds, line.beatIndex, occurrence);
    let input = trimmedOutput;
    let outputSeconds = measured;
    if (measured === undefined) {
      unmeasured.push(stem);
    } else {
      const required = measured / (beat.endSec - beat.startSec);
      if (required > maxTempo) {
        overTempo.push({ beatIndex: line.beatIndex, required });
      } else if (required > 1) {
        const tempoOutput = pathIn(options.workDir, `${stem}-tempo.wav`);
        commands.push({
          step: 'tempo',
          argv: ['ffmpeg', '-y', '-i', trimmedOutput, '-filter:a', `atempo=${required}`, tempoOutput],
          output: tempoOutput,
        });
        input = tempoOutput;
        outputSeconds = measured / required;
      }
    }
    plannedLines.push({ beatIndex: line.beatIndex, input, measuredSeconds: outputSeconds });
  }

  if (options.musicBedPath === undefined) {
    blocked.push('Music bed path was not supplied; no loudnorm or ducking commands were planned.');
  }
  if (plannedLines.length === 0) {
    blocked.push('No valid voice lines were supplied; no VO or ducking commands were planned.');
    return { commands, overTempo, unmeasured, blocked };
  }
  if (options.musicBedPath === undefined) {
    return { commands, overTempo, unmeasured, blocked };
  }

  const voOutput = pathIn(options.workDir, 'voice-track.wav');
  const voInputs = plannedLines.flatMap(({ input }) => ['-i', input]);
  const placementFilters = plannedLines.map(({ beatIndex }, index) => {
    const delayMs = Math.round(scene.beats[beatIndex]!.startSec * 1000);
    return `[${index}:a]adelay=${delayMs}|${delayMs},apad[a${index}]`;
  });
  const mixInputs = plannedLines.map((_, index) => `[a${index}]`).join('');
  commands.push({
    step: 'vo-track',
    argv: ['ffmpeg', '-y', ...voInputs, '-filter_complex', `${placementFilters.join(';')};${mixInputs}amix=inputs=${plannedLines.length}:normalize=0,apad=whole_dur=${options.totalSeconds},atrim=0:${options.totalSeconds},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[out]`, '-map', '[out]', voOutput],
    output: voOutput,
  });
  const ducking = duckingExpression(scene, plannedLines);
  const mixPrefix = `[0:a]volume=${musicBedDb}dB,apad=whole_dur=${options.totalSeconds},atrim=0:${options.totalSeconds}[bed];[1:a]asplit=2[sc][vo];[bed][sc]sidechaincompress=threshold=0.05:ratio=1:attack=15:release=350[sidechained];[sidechained]volume='${ducking}':eval=frame[ducked];[ducked][vo]amix=inputs=2:normalize=0,apad=whole_dur=${options.totalSeconds},atrim=0:${options.totalSeconds}`;
  const soundtrack = pathIn(options.workDir, 'soundtrack.wav');
  commands.push({
    step: 'loudnorm-measure',
    argv: ['ffmpeg', '-y', '-i', options.musicBedPath, '-i', voOutput, '-filter_complex', `${mixPrefix},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '/dev/null'],
    output: '/dev/null',
  });
  const measurement = loudnormMeasurement(options.loudnormMeasurement);
  const normalization = measurement === undefined
    ? `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`
    : `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:measured_I=${measurement.inputI}:measured_TP=${measurement.inputTp}:measured_LRA=${measurement.inputLra}:measured_thresh=${measurement.inputThresh}:offset=${measurement.targetOffset}:linear=true`;
  commands.push({
    step: 'duck-mix',
    argv: ['ffmpeg', '-y', '-i', options.musicBedPath, '-i', voOutput, '-filter_complex', `${mixPrefix},${normalization},alimiter=limit=0.891:level=false[mix]`, '-map', '[mix]', soundtrack],
    output: soundtrack,
  });

  return { commands, overTempo, unmeasured, blocked };
}
