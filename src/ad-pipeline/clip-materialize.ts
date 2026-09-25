import type { ClipFile } from './assemble.js';
import type { RetainPlan } from './retain.js';

export interface ClipProbeCommand {
  readonly beatIndex: number;
  readonly argv: readonly string[];
}

export interface ClipProbePlan {
  /** Commands only: an external backend owns process execution. */
  readonly commands: readonly ClipProbeCommand[];
}

export interface ClipProbeOutput {
  readonly ok?: boolean;
  readonly stdout?: string;
}

export type ClipProbeOutputs = Readonly<Partial<Record<number, ClipProbeOutput>>>;

export interface MaterializedClipFiles {
  readonly clips: readonly ClipFile[];
  readonly unprobed: readonly number[];
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveFrameRate(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!match) return false;
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0;
}

function parseProbe(output: ClipProbeOutput | undefined): ClipFile['probe'] | undefined {
  if (output === undefined || output.ok === false || output.stdout === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(output.stdout);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const streams = (parsed as { streams?: unknown }).streams;
    if (!Array.isArray(streams)) return undefined;
    const video = streams.find((stream): stream is Record<string, unknown> => (
      typeof stream === 'object' && stream !== null && (stream as { codec_type?: unknown }).codec_type === 'video'
    ));
    if (!video) return undefined;
    const width = video.width;
    const height = video.height;
    const fps = video.avg_frame_rate;
    const codec = video.codec_name;
    if (!positiveInteger(width) || !positiveInteger(height) || !positiveFrameRate(fps) || !nonEmptyString(codec)) return undefined;
    return {
      width,
      height,
      fps,
      codec,
      hasAudio: streams.some((stream) => typeof stream === 'object' && stream !== null && (stream as { codec_type?: unknown }).codec_type === 'audio'),
    };
  } catch {
    return undefined;
  }
}

/** Creates one ffprobe JSON command for every retained local file without spawning a process. */
export function buildClipProbePlan(retainPlan: RetainPlan): ClipProbePlan {
  return {
    commands: retainPlan.commands.map(({ beatIndex, localPath }) => ({
      beatIndex,
      argv: ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,codec_name', '-of', 'json', localPath],
    })),
  };
}

/** Materializes retained local paths into canonical assembly clips from externally supplied ffprobe output. */
export function materializeClipFiles(retainPlan: RetainPlan, outputs: ClipProbeOutputs): MaterializedClipFiles {
  const clips: ClipFile[] = [];
  const unprobed: number[] = [];
  for (const { beatIndex, localPath } of retainPlan.commands) {
    const probe = parseProbe(outputs[beatIndex]);
    clips.push(probe === undefined ? { beatIndex, path: localPath } : { beatIndex, path: localPath, probe });
    if (probe === undefined) unprobed.push(beatIndex);
  }
  return { clips, unprobed };
}
