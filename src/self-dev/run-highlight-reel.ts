import type { KeyframeEntry } from '../capture/keyframe-capture.js';
import type { EncodeMp4Opts } from '../capture/encoders/mp4.js';

export interface RunHighlightReelDeps {
  readonly listKeyframes: (runId: string) => readonly KeyframeEntry[];
  readonly encodeMp4: (opts: EncodeMp4Opts) => Promise<Buffer>;
  readonly probeFfmpeg: () => Promise<string | undefined>;
}

export type RunHighlightReel =
  | { readonly kind: 'encoded'; readonly frames: number; readonly mp4: Buffer }
  | { readonly kind: 'ffmpeg-unavailable'; readonly frames: number; readonly message: string }
  | { readonly kind: 'no-keyframes'; readonly frames: 0; readonly message: string };

export async function buildRunHighlightReel(runId: string, deps: RunHighlightReelDeps): Promise<RunHighlightReel> {
  // ★ 정렬(리뷰 must-fix): seq 는 **ptyId별 로컬 순번**이라 seq-alone 은 다중 PTY 를 교차 훼손한다. 하이라이트릴은
  //   **전역 캡처 시각(mtimeMs)** 순으로 — 동시각이면 ptyId·seq(결정론). 다중 PTY run 도 실제 전이 시간순 재생.
  const keyframes = [...deps.listKeyframes(runId)].sort((a, b) =>
    (a.mtimeMs !== b.mtimeMs ? a.mtimeMs - b.mtimeMs : a.ptyId === b.ptyId ? a.seq - b.seq : a.ptyId.localeCompare(b.ptyId)));
  if (keyframes.length === 0) {
    return {
      kind: 'no-keyframes',
      frames: 0,
      message: `run '${runId}' 에 키프레임 PNG 없음 (전이 미발생·미스폰·다른 MONAD_STATE_DIR·grace TTL). executor(goal-loop PTY) run 만 캡처됨.`,
    };
  }

  const ffmpegPath = await deps.probeFfmpeg();
  if (!ffmpegPath) {
    return {
      kind: 'ffmpeg-unavailable',
      frames: keyframes.length,
      message: 'ffmpeg를 찾을 수 없습니다. ffmpeg를 설치하거나 PATH에 추가한 뒤 다시 실행하세요.',
    };
  }

  return {
    kind: 'encoded',
    frames: keyframes.length,
    mp4: await deps.encodeMp4({
      frames: keyframes.map((keyframe) => ({ pngPath: keyframe.path })),
      ffmpegPath,
      // ★ 하이라이트릴은 keyframe 당 1 프레임 — 낮은 fps 로 각 순간이 충분히 노출되게(리뷰 should-fix·기본 fps 면
      //   N프레임이 순식간). 1fps = 각 keyframe ~1초.
      fps: 1,
    }),
  };
}
