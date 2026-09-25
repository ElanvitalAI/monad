import { randomUUID } from 'node:crypto';
import type { QcMeasurements } from './qc.js';
import type { SceneSpec } from './scene-spec.js';

export type QcMeasurementStep = 'probe' | 'volume' | 'loudness' | 'text-tempdir' | 'text-compile' | 'text-frame' | 'text-regions' | 'text-cleanup' | `cut-before-${number}` | `cut-after-${number}` | `within-before-${number}` | `within-after-${number}`;

export interface QcMeasurementCommand {
  readonly step: QcMeasurementStep;
  readonly argv: readonly string[];
}

export interface QcMeasurementPlan {
  /** Commands only: an external backend owns process execution. */
  readonly commands: readonly QcMeasurementCommand[];
  readonly cutBoundaries: readonly number[];
  readonly skippedWithinCutBeatNumbers: readonly number[];
  readonly textTempDirectory?: string;
  readonly textRegionUnavailableReason?: 'ocr-platform-unavailable';
}

export interface QcCommandOutput {
  readonly ok?: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly raw?: Uint8Array;
}

export type QcMeasurementOutputs = Readonly<Partial<Record<QcMeasurementStep, QcCommandOutput>>>;

const DARK_CHANNEL_MAXIMUM = 2;
const TEXT_REGION_SOURCE = 'scripts/ocr-text-regions.swift';
const TEXT_TEMP_DIRECTORY_PREFIX = '/tmp/ocr-text-regions-';

function textTempDirectory(): string {
  return `${TEXT_TEMP_DIRECTORY_PREFIX}${randomUUID()}`;
}

function textArtifacts(directory: string): { readonly binary: string; readonly frame: string } {
  return { binary: `${directory}/ocr-text-regions`, frame: `${directory}/frame.png` };
}

export function shouldRunQcMeasurementCommand(command: QcMeasurementCommand, outputs: QcMeasurementOutputs): boolean {
  if (command.step === 'text-compile') return successful(outputs['text-tempdir']);
  if (command.step === 'text-frame') return successful(outputs['text-compile']);
  if (command.step === 'text-regions') return successful(outputs['text-compile']) && successful(outputs['text-frame']);
  return true;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return finite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return finite(parsed) ? parsed : undefined;
}

function cutFrameFilter(boundary: number, side: 'before' | 'after'): string {
  const selection = side === 'before' ? `lt(t\\,${boundary})` : `gte(t\\,${boundary})`;
  return side === 'before'
    ? `select='${selection}',scale=1:1,reverse,trim=end_frame=1`
    : `select='${selection}',scale=1:1,trim=end_frame=1`;
}

const WITHIN_CUT_SAMPLE_MARGIN_SECONDS = 1;

function withinCutSampleTimes(startSec: number, endSec: number): readonly [number, number] | undefined {
  if (!finite(startSec) || !finite(endSec) || endSec - startSec <= WITHIN_CUT_SAMPLE_MARGIN_SECONDS * 2) return undefined;
  return [startSec + WITHIN_CUT_SAMPLE_MARGIN_SECONDS, endSec - WITHIN_CUT_SAMPLE_MARGIN_SECONDS];
}

export interface QcMeasurementPlanOptions {
  readonly textFrameAtSeconds?: number;
}

/** Creates executable descriptions without spawning ffprobe or ffmpeg. */
export function buildQcMeasurementPlan(
  scene: SceneSpec,
  filePath: string,
  platform = process.platform,
  options: QcMeasurementPlanOptions = {},
): QcMeasurementPlan {
  const cutBoundaries = scene.beats.slice(1).map((beat) => beat.startSec).filter(finite);
  const ocrAvailable = platform === 'darwin';
  const directory = ocrAvailable ? textTempDirectory() : undefined;
  const artifacts = directory === undefined ? undefined : textArtifacts(directory);
  const commands: QcMeasurementCommand[] = [
    { step: 'probe', argv: ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', '-of', 'json', filePath] },
    { step: 'volume', argv: ['ffmpeg', '-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '/dev/null'] },
    { step: 'loudness', argv: ['ffmpeg', '-hide_banner', '-i', filePath, '-af', 'loudnorm=print_format=json', '-f', 'null', '/dev/null'] },
    ...(directory === undefined || artifacts === undefined ? [] : [
      { step: 'text-tempdir' as const, argv: ['mkdir', '-p', directory] },
      { step: 'text-compile' as const, argv: ['swiftc', TEXT_REGION_SOURCE, '-o', artifacts.binary] },
      {
        step: 'text-frame' as const,
        argv: ['ffmpeg', '-y', '-v', 'error', ...(options.textFrameAtSeconds === undefined ? [] : ['-ss', String(options.textFrameAtSeconds)]), '-i', filePath, '-frames:v', '1', artifacts.frame],
      },
      { step: 'text-regions' as const, argv: [artifacts.binary, artifacts.frame] },
      { step: 'text-cleanup' as const, argv: ['rm', '-rf', directory] },
    ]),
  ];
  for (const [index, boundary] of cutBoundaries.entries()) {
    for (const side of ['before', 'after'] as const) {
      commands.push({
        step: `cut-${side}-${index}`,
        argv: ['ffmpeg', '-v', 'error', '-i', filePath, '-vf', cutFrameFilter(boundary, side), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
      });
    }
  }
  const skippedWithinCutBeatNumbers: number[] = [];
  for (const [index, beat] of scene.beats.entries()) {
    const sampleTimes = withinCutSampleTimes(beat.startSec, beat.endSec);
    if (!sampleTimes) {
      skippedWithinCutBeatNumbers.push(index + 1);
      continue;
    }
    for (const [side, sampleTime] of [['before', sampleTimes[0]], ['after', sampleTimes[1]]] as const) {
      commands.push({
        step: `within-${side}-${index}`,
        argv: ['ffmpeg', '-v', 'error', '-i', filePath, '-vf', cutFrameFilter(sampleTime, 'after'), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
      });
    }
  }
  return {
    commands,
    cutBoundaries,
    skippedWithinCutBeatNumbers,
    ...(directory === undefined ? { textRegionUnavailableReason: 'ocr-platform-unavailable' as const } : { textTempDirectory: directory }),
  };
}

function successful(output: QcCommandOutput | undefined): boolean {
  return output !== undefined && output.ok !== false;
}

function numberFrom(text: string | undefined, expression: RegExp): number | undefined {
  return numberValue(text?.match(expression)?.[1]);
}

function trailingJson(text: string | undefined): Record<string, unknown> | undefined {
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
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'input_i' in parsed) return parsed as Record<string, unknown>;
        } catch {
          break;
        }
        break;
      }
    }
    if (start === 0) break;
    start = text.lastIndexOf('{', start - 1);
  }
  return undefined;
}

function textRegions(text: string | undefined): number | undefined {
  const value = numberFrom(text, /(?:^|\s)regions=(\d+)(?:\s|$)/);
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export interface QcTextRegionBox {
  /** Vision-normalized coordinates with a lower-left origin. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function parseTextRegionBoxes(text: string | undefined): readonly QcTextRegionBox[] {
  if (text === undefined) return [];
  const boxes: QcTextRegionBox[] = [];
  for (const line of text.split(/\r?\n/)) {
    const token = /(?:^|\s)box=([^\s]+)\s*$/.exec(line)?.[1];
    const components = token?.split(',');
    if (components === undefined || components.length !== 4 || components.some((component) => component.trim() === '')) continue;
    const values = components.map((component) => Number(component));
    if (values.some((value) => !finite(value) || value < 0 || value > 1)) continue;
    const [x, y, width, height] = values;
    boxes.push({ x, y, width, height });
  }
  return boxes;
}

export function textRegionUnavailableReason(plan: QcMeasurementPlan, outputs: QcMeasurementOutputs): string | undefined {
  if (plan.textRegionUnavailableReason !== undefined) return plan.textRegionUnavailableReason;
  if (!successful(outputs['text-compile'])) return 'ocr-compile-failed';
  if (!successful(outputs['text-frame'])) return 'ocr-frame-extraction-failed';
  if (!successful(outputs['text-regions'])) return 'ocr-recognition-failed';
  if (textRegions(outputs['text-regions']?.stdout) === undefined) return 'ocr-invalid-output';
  return undefined;
}

function parseProbe(text: string | undefined): Pick<QcMeasurements, 'resolution' | 'durationSeconds' | 'durationScope'> {
  try {
    const parsed: unknown = text === undefined ? undefined : JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const value = parsed as { streams?: unknown; format?: { duration?: unknown } };
    const stream = Array.isArray(value.streams) ? value.streams[0] : undefined;
    const dimensions = typeof stream === 'object' && stream !== null ? stream as { width?: unknown; height?: unknown } : undefined;
    const width = numberValue(dimensions?.width);
    const height = numberValue(dimensions?.height);
    const duration = numberValue(value.format?.duration);
    return {
      ...(width !== undefined && height !== undefined && width > 0 && height > 0 ? { resolution: `${width}x${height}` } : {}),
      ...(duration !== undefined && duration >= 0 ? { durationSeconds: duration, durationScope: 'master' as const } : {}),
    };
  } catch {
    return {};
  }
}

function rgb(output: QcCommandOutput | undefined): readonly [number, number, number] | undefined {
  const bytes = successful(output) ? output?.raw : undefined;
  return bytes !== undefined && bytes.length === 3 ? [bytes[0], bytes[1], bytes[2]] : undefined;
}

function colorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export type QcMeasurementsWithTextRegions = QcMeasurements & {
  readonly textRegionBoxes?: readonly QcTextRegionBox[];
};

/** Parses isolated command output; a failed axis never erases independent measurements. */
export function parseQcMeasurements(plan: QcMeasurementPlan, outputs: QcMeasurementOutputs): QcMeasurementsWithTextRegions {
  const probe = successful(outputs.probe) ? parseProbe(outputs.probe?.stdout) : {};
  const audioPeakDb = successful(outputs.volume) ? numberFrom(outputs.volume?.stderr, /max_volume:\s*([-+]?\d+(?:\.\d+)?)\s*dB/i) : undefined;
  const loudnorm = successful(outputs.loudness) ? trailingJson(outputs.loudness?.stderr) : undefined;
  const dialogueLufs = numberValue(loudnorm?.input_i);
  const textOutputAvailable = successful(outputs['text-compile']) && successful(outputs['text-frame']) && successful(outputs['text-regions']);
  const detectedTextRegions = textOutputAvailable ? textRegions(outputs['text-regions']?.stdout) : undefined;
  const textRegionBoxes = textOutputAvailable ? parseTextRegionBoxes(outputs['text-regions']?.stdout) : undefined;
  const distances: number[] = [];
  const samples: (readonly [number, number, number])[] = [];
  let allBoundariesMeasured = plan.cutBoundaries.length > 0;

  for (const index of plan.cutBoundaries.keys()) {
    const before = rgb(outputs[`cut-before-${index}`]);
    const after = rgb(outputs[`cut-after-${index}`]);
    if (before) samples.push(before);
    if (after) samples.push(after);
    if (!before || !after) {
      allBoundariesMeasured = false;
      continue;
    }
    distances.push(colorDistance(before, after));
  }

  const withinCutDistances: number[] = [];
  for (const command of plan.commands) {
    const match = /^within-before-(\d+)$/.exec(command.step);
    if (!match) continue;
    const index = Number(match[1]);
    const before = rgb(outputs[`within-before-${index}`]);
    const after = rgb(outputs[`within-after-${index}`]);
    if (!before || !after) continue;
    withinCutDistances.push(colorDistance(before, after));
  }

  return {
    ...probe,
    ...(audioPeakDb === undefined ? {} : { audioPeakDb }),
    ...(dialogueLufs === undefined ? {} : { dialogueLufs }),
    ...(detectedTextRegions === undefined ? {} : { detectedTextRegions }),
    ...(textRegionBoxes === undefined ? {} : { textRegionBoxes }),
    ...(allBoundariesMeasured ? { colorDistanceBetweenCuts: distances } : {}),
    ...(withinCutDistances.length > 0 ? { colorDistanceWithinCuts: withinCutDistances } : {}),
    ...(samples.some((sample) => sample.some((channel) => channel > DARK_CHANNEL_MAXIMUM))
      ? { renderedContentPresent: true }
      : samples.length === plan.cutBoundaries.length * 2 && samples.length > 0
        ? { renderedContentPresent: false }
        : {}),
  };
}
