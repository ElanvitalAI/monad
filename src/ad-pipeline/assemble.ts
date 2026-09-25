import { resolve } from 'node:path';
import type { SceneSpec } from './scene-spec.js';

export interface ClipFile {
  readonly beatIndex: number;
  readonly path: string;
  /** ffprobe로 이미 측정한 값이며, 이 계획기는 측정하지 않는다. */
  readonly probe?: { readonly width: number; readonly height: number; readonly fps: string; readonly codec: string; readonly hasAudio: boolean };
  /** The shoot plan's requested duration; valid values override the scene-duration fallback. */
  readonly trimToSeconds?: number;
}

export interface AssemblyCommand {
  readonly step: 'workdir' | 'trim' | 'concat' | 'xfade' | 'safezone' | 'master';
  readonly argv: readonly string[];
  readonly output: string;
}

export type MasterAudioSource =
  | { readonly kind: 'silent' }
  | { readonly kind: 'original' }
  | { readonly kind: 'soundtrack'; readonly path: string };

export interface AssemblyPlan {
  readonly commands: readonly AssemblyCommand[];
  /** The master file this plan will produce; consumers must not re-derive it from workDir and outputName. */
  readonly masterPath: string;
  /** The safezone frame produced by the vertical safezone step, when that step is included. */
  readonly safezonePath?: string;
  /** The resolved master-audio source; omitted options resolve to silent. */
  readonly masterAudio: MasterAudioSource;
  readonly mismatched: readonly number[];
  readonly unprobed: readonly number[];
  /** Beats where a valid clip trim differs from the scene-duration fallback. */
  readonly trimDisagreement: readonly { readonly beatIndex: number; readonly clip: number; readonly scene: number }[];
  readonly blocked: readonly string[];
}

export interface AssemblyOptions {
  readonly workDir: string;
  /** 최종 파일 이름. ⛔ 확장자가 «없으면» `.mp4` 를 붙인다 — 없으면 ffmpeg 이 포맷을 «못 정한다».
   *  🩸 실물로 돌려서 잡았다: `Unable to choose an output format for '…/OUT'`.
   *     ⇒ 스킬의 파일명 규칙도 확장자를 요구한다 — `[프로젝트]_[버전]_[비율].mp4`. */
  readonly outputName: string;
  readonly dissolveDurationSec?: number;
  /** Explicit delivery cadence; otherwise use the common probed source FPS. */
  readonly outputFps?: string;
  /** 각 클립의 «앞머리»를 몇 초 버릴지. ⛔ 타임라인 위치가 «아니다» — 클립 «안»의 오프셋이다.
   *  📏 스킬 예시 `-ss 0.2 -t 3.5` 가 그 뜻이다("앞 0.2s 버리고 3.5s 사용"). 기본 0. */
  readonly clipHeadTrimSec?: number;
  /** Master audio is silent unless original clip audio or a soundtrack is explicitly selected. */
  readonly masterAudio?: MasterAudioSource;
}

const DEFAULT_DISSOLVE_DURATION_SEC = 0.3;
const SILENT_MASTER_AUDIO: MasterAudioSource = { kind: 'silent' };

/** ⛔ ffmpeg 은 «확장자»로 컨테이너를 정한다. 없으면 `Unable to choose an output format` 로 죽는다. */
function withVideoExtension(name: string): string {
  return /\.[A-Za-z0-9]{2,4}$/.test(name) ? name : `${name}.mp4`;
}

const SCALE_BY_ASPECT_RATIO: Readonly<Record<SceneSpec['aspectRatio'], readonly [number, number]>> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
};

function pathIn(workDir: string, name: string): string {
  return `${workDir.replace(/\/$/, '')}/${name}`;
}

function milliseconds(value: number): number {
  return Math.round(value * 1000);
}

function seconds(millisecondsValue: number): string {
  return (millisecondsValue / 1000).toString();
}

function sameProbe(left: NonNullable<ClipFile['probe']>, right: NonNullable<ClipFile['probe']>): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.fps === right.fps
    && left.codec === right.codec;
}

function durationOf(scene: SceneSpec, beatIndex: number): number {
  const beat = scene.beats[beatIndex];
  return beat.endSec - beat.startSec;
}

function hasValidTrimDuration(clip: ClipFile): clip is ClipFile & { readonly trimToSeconds: number } {
  return Number.isFinite(clip.trimToSeconds) && clip.trimToSeconds !== undefined && clip.trimToSeconds > 0;
}

export function buildAssemblyPlan(
  scene: SceneSpec,
  clips: readonly ClipFile[],
  options: AssemblyOptions,
): AssemblyPlan {
  const commands: AssemblyCommand[] = [{
    step: 'workdir',
    argv: ['mkdir', '-p', options.workDir],
    output: options.workDir,
  }];
  const mismatched: number[] = [];
  const unprobed: number[] = [];
  const trimDisagreement: { beatIndex: number; clip: number; scene: number }[] = [];
  const blocked: string[] = [];
  const master = pathIn(options.workDir, withVideoExtension(options.outputName));
  const masterAudio = options.masterAudio ?? SILENT_MASTER_AUDIO;
  const clipsByBeat = new Map(clips.map((clip) => [clip.beatIndex, clip]));
  const selected = scene.beats.map((_, beatIndex) => clipsByBeat.get(beatIndex));

  for (const [beatIndex, clip] of selected.entries()) {
    if (!clip) blocked.push(`Beat ${beatIndex} has no supplied clip.`);
    else if (!clip.probe) unprobed.push(beatIndex);
  }

  const reference = selected.find((clip): clip is ClipFile & { readonly probe: NonNullable<ClipFile['probe']> } => Boolean(clip?.probe));
  if (reference) {
    for (const [beatIndex, clip] of selected.entries()) {
      if (clip?.probe && !sameProbe(reference.probe, clip.probe)) mismatched.push(beatIndex);
    }
  }

  const clipHeadTrimSec = options.clipHeadTrimSec ?? 0;
  const trimDurationOf = (clip: ClipFile, beatIndex: number): number => {
    const sceneDuration = durationOf(scene, beatIndex);
    if (!hasValidTrimDuration(clip)) return sceneDuration;
    if (clip.trimToSeconds !== sceneDuration) trimDisagreement.push({ beatIndex, clip: clip.trimToSeconds, scene: sceneDuration });
    return clip.trimToSeconds;
  };
  const trimDurationByBeat = selected.map((clip, beatIndex) => clip
    ? trimDurationOf(clip, beatIndex)
    : durationOf(scene, beatIndex));
  const preserveOriginalAudio = masterAudio.kind === 'original';
  if (preserveOriginalAudio) {
    for (const [beatIndex, clip] of selected.entries()) {
      if (clip?.probe && !clip.probe.hasAudio) blocked.push(`Cannot preserve original audio: beat ${beatIndex} has no audio stream.`);
    }
  }
  for (const [beatIndex] of scene.beats.entries()) {
    const clip = selected[beatIndex];
    if (!clip) continue;
    const output = pathIn(options.workDir, `trim-${beatIndex}.mp4`);
    commands.push({
      step: 'trim',
      // ⛔⭐⭐ `-ss` 는 «클립 «안»의 위치»다 — «타임라인 위치»가 «아니다».
      //   🩸 초판은 `beat.startSec`(타임라인 초)을 넣었다. 클립 하나가 «한 비트»이므로
      //      비트4(타임라인 28~30s)는 «4초짜리 파일의 28초 지점» → ***빈 영상***이 된다.
      //   🔑 각 클립은 이미 그 비트«만» 담고 있다. 자를 것은 «앞머리»뿐이고 기본은 0 이다.
      //   ⊕ `-t` 와 후속 타임라인은 같은 결정된 trim 길이를 쓴다.
      argv: ['ffmpeg', '-y', '-ss', seconds(milliseconds(clipHeadTrimSec)), '-i', clip.path, '-t', seconds(milliseconds(trimDurationByBeat[beatIndex])), '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', ...(preserveOriginalAudio ? ['-c:a', 'aac'] : ['-an']), output],
      output,
    });
  }

  if (unprobed.length > 0) blocked.push(`Cannot join clips until probe values are supplied for beats: ${unprobed.join(', ')}.`);
  if (mismatched.length > 0) blocked.push(`Cannot join clips with incompatible probe values at beats: ${mismatched.join(', ')}.`);
  if (selected.some((clip) => !clip) || unprobed.length > 0 || mismatched.length > 0 || blocked.length > 0) return { commands, masterPath: master, masterAudio, mismatched, unprobed, trimDisagreement, blocked };

  const dissolveDurationSec = options.dissolveDurationSec ?? DEFAULT_DISSOLVE_DURATION_SEC;
  const dissolveDurationMs = milliseconds(dissolveDurationSec);
  const hasDissolve = scene.beats.some((beat, beatIndex) => beatIndex > 0 && beat.transitionIn?.kind === 'dissolve');
  if (hasDissolve && (!Number.isFinite(dissolveDurationSec) || dissolveDurationMs <= 0)) {
    blocked.push(`Dissolve duration must be a positive finite millisecond value; received ${String(dissolveDurationSec)}.`);
    return { commands, masterPath: master, masterAudio, mismatched, unprobed, trimDisagreement, blocked };
  }

  const trimmed = scene.beats.map((_, beatIndex) => pathIn(options.workDir, `trim-${beatIndex}.mp4`));
  const generatedOutputs = [...trimmed, ...scene.beats.slice(1).map((_, beatIndex) => pathIn(options.workDir, `joined-${beatIndex + 1}.mp4`)), pathIn(options.workDir, 'safezone.png'), pathIn(options.workDir, withVideoExtension(options.outputName))];
  const normalizedPath = (path: string) => resolve(path);
  const inputPaths = new Set([
    ...selected.map((clip) => clip?.path).filter((path): path is string => path !== undefined),
    ...(masterAudio.kind === 'soundtrack' ? [masterAudio.path] : []),
  ].map(normalizedPath));
  const duplicateOutput = generatedOutputs.find((output, index) => generatedOutputs.findIndex((candidate) => normalizedPath(candidate) === normalizedPath(output)) !== index);
  const inputCollision = generatedOutputs.find((output) => inputPaths.has(normalizedPath(output)));
  if (duplicateOutput || inputCollision) {
    blocked.push(`Assembly output path collision: ${duplicateOutput ?? inputCollision}.`);
    return { commands, masterPath: master, masterAudio, mismatched, unprobed, trimDisagreement, blocked };
  }

  let assembled = trimmed[0];
  let assembledDurationMs = milliseconds(trimDurationByBeat[0]);

  for (let beatIndex = 1; beatIndex < scene.beats.length; beatIndex += 1) {
    const output = pathIn(options.workDir, `joined-${beatIndex}.mp4`);
    const beatDurationMs = milliseconds(trimDurationByBeat[beatIndex]);
    if (scene.beats[beatIndex].transitionIn?.kind === 'dissolve') {
      if (dissolveDurationMs >= assembledDurationMs || dissolveDurationMs >= beatDurationMs) {
        blocked.push(`Dissolve into beat ${beatIndex} requires duration shorter than both inputs (${seconds(assembledDurationMs)}s and ${seconds(beatDurationMs)}s).`);
        return { commands, masterPath: master, masterAudio, mismatched, unprobed, trimDisagreement, blocked };
      }
      const offsetMs = assembledDurationMs - dissolveDurationMs;
      commands.push({
        step: 'xfade',
        argv: ['ffmpeg', '-y', '-i', assembled, '-i', trimmed[beatIndex], '-filter_complex', preserveOriginalAudio
          ? `[0:v][1:v]xfade=transition=fade:duration=${seconds(dissolveDurationMs)}:offset=${seconds(offsetMs)}[v];[0:a][1:a]acrossfade=d=${seconds(dissolveDurationMs)}[a]`
          : `[0][1]xfade=transition=fade:duration=${seconds(dissolveDurationMs)}:offset=${seconds(offsetMs)}`, ...(preserveOriginalAudio ? ['-map', '[v]', '-map', '[a]', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-crf', '18', output],
        output,
      });
      assembledDurationMs += beatDurationMs - dissolveDurationMs;
    } else {
      commands.push({
        step: 'concat',
        argv: ['ffmpeg', '-y', '-i', assembled, '-i', trimmed[beatIndex], '-filter_complex', preserveOriginalAudio ? '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]' : '[0:v][1:v]concat=n=2:v=1:a=0', ...(preserveOriginalAudio ? ['-map', '[v]', '-map', '[a]', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-crf', '18', output],
        output,
      });
      assembledDurationMs += beatDurationMs;
    }
    assembled = output;
  }

  const [width, height] = SCALE_BY_ASPECT_RATIO[scene.aspectRatio];
  let safezonePath: string | undefined;
  if (width === 1080 && height === 1920) {
    const safezone = pathIn(options.workDir, 'safezone.png');
    safezonePath = safezone;
    commands.push({
      step: 'safezone',
      argv: ['ffmpeg', '-y', '-i', assembled, '-vf', 'scale=1080:1920:flags=lanczos,drawbox=y=0:h=192,drawbox=y=1536:h=384,drawbox=x=972:w=108', '-frames:v', '1', safezone],
      output: safezone,
    });
  } else {
    blocked.push(`Safezone overlay is only defined for 1080x1920; ${scene.aspectRatio} scales to ${width}x${height}.`);
  }

  const outputFps = options.outputFps ?? reference!.probe.fps;
  const masterInputs = masterAudio.kind === 'soundtrack' ? ['-i', masterAudio.path] : [];
  const masterAudioArgs = masterAudio.kind === 'silent'
    ? ['-an']
    : masterAudio.kind === 'original'
      ? ['-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k']
      : ['-map', '0:v:0', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'];
  commands.push({
    step: 'master',
    argv: ['ffmpeg', '-y', '-i', assembled, ...masterInputs, '-vf', `scale=${width}:${height}:flags=lanczos,fps=${outputFps}`, '-c:v', 'libx264', '-profile:v', 'high', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...masterAudioArgs, '-t', seconds(assembledDurationMs), master],
    output: master,
  });

  return { commands, masterPath: master, ...(safezonePath ? { safezonePath } : {}), masterAudio, mismatched, unprobed, trimDisagreement, blocked };
}
