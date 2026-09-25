// run 하이라이트릴 조립기 — DI 로 keyframe 수집→인코딩 배선·ffmpeg 없음·keyframe 0개 판정 회귀 가드(실 ffmpeg 불요).
import { describe, it, expect } from 'bun:test';
import { buildRunHighlightReel, type RunHighlightReelDeps } from './run-highlight-reel.js';
import type { KeyframeEntry } from '../capture/keyframe-capture.js';

const kf = (seq: number, state = 'working', ptyId = 'pty', mtimeMs = seq): KeyframeEntry => ({
  path: `/kf/kf-run-${ptyId}-${String(seq).padStart(3, '0')}-${state}.png`, ptyId, seq, state, bytes: 100, mtimeMs,
});

const deps = (over: Partial<RunHighlightReelDeps> = {}): RunHighlightReelDeps => ({
  listKeyframes: () => [kf(0), kf(1)],
  encodeMp4: async () => Buffer.from('MP4DATA'),
  probeFfmpeg: async () => '/usr/bin/ffmpeg',
  ...over,
});

describe('buildRunHighlightReel', () => {
  it('keyframe 있음 + ffmpeg 있음 → encoded(프레임 seq 순으로 encodeMp4 배선)', async () => {
    let passedFrames: any[] = [];
    const r = await buildRunHighlightReel('run1', deps({
      listKeyframes: () => [kf(2), kf(0), kf(1)], // 뒤섞인 순서
      encodeMp4: async (o) => { passedFrames = [...o.frames]; return Buffer.from('MP4'); },
    }));
    expect(r.kind).toBe('encoded');
    if (r.kind === 'encoded') { expect(r.frames).toBe(3); expect(r.mp4.toString()).toBe('MP4'); }
    // seq 순 정렬 후 pngPath 로 전달(재래스터 없이 keyframe PNG 직접).
    expect(passedFrames.map((f) => f.pngPath)).toEqual([kf(0).path, kf(1).path, kf(2).path]);
  });

  it('⚠️ 다중 PTY → 전역 캡처시각(mtime) 순 인터리브(seq-alone 교차훼손 방지·must-fix)', async () => {
    let passed: any[] = [];
    // seq 는 ptyId별 로컬 순번 — seq 만으로 정렬하면 두 PTY 의 seq=0끼리 섞여 실제 시간순 훼손. mtime 으로 정렬.
    // 실제 캡처 순서(mtime): A#0(t10) → B#0(t20) → A#1(t30) → B#1(t40).
    const r = await buildRunHighlightReel('run1', deps({
      listKeyframes: () => [
        kf(1, 'working', 'ptyB', 40), kf(0, 'working', 'ptyA', 10),
        kf(1, 'working', 'ptyA', 30), kf(0, 'working', 'ptyB', 20),
      ],
      encodeMp4: async (o) => { passed = [...o.frames]; return Buffer.from('MP4'); },
    }));
    expect(r.kind).toBe('encoded');
    // mtime 순 인터리브(seq-alone 이면 A#0,B#0,A#1,B#1 이 아니라 잘못 섞임).
    expect(passed.map((f) => f.pngPath)).toEqual([
      kf(0, 'working', 'ptyA').path, kf(0, 'working', 'ptyB').path,
      kf(1, 'working', 'ptyA').path, kf(1, 'working', 'ptyB').path,
    ]);
  });

  it('하이라이트릴은 낮은 fps 로 인코딩(각 순간 노출·should-fix)', async () => {
    let passedFps: number | undefined;
    await buildRunHighlightReel('run1', deps({ encodeMp4: async (o) => { passedFps = o.fps; return Buffer.from('MP4'); } }));
    expect(passedFps).toBe(1);
  });

  it('keyframe 0개 → no-keyframes(인코더 미호출)', async () => {
    let encoded = false;
    const r = await buildRunHighlightReel('run1', deps({
      listKeyframes: () => [],
      encodeMp4: async () => { encoded = true; return Buffer.from(''); },
    }));
    expect(r.kind).toBe('no-keyframes');
    if (r.kind === 'no-keyframes') expect(r.frames).toBe(0);
    expect(encoded).toBe(false);
  });

  it('ffmpeg 미설치 → ffmpeg-unavailable(인코더 미호출·프레임 수는 보고)', async () => {
    let encoded = false;
    const r = await buildRunHighlightReel('run1', deps({
      probeFfmpeg: async () => undefined,
      encodeMp4: async () => { encoded = true; return Buffer.from(''); },
    }));
    expect(r.kind).toBe('ffmpeg-unavailable');
    if (r.kind === 'ffmpeg-unavailable') expect(r.frames).toBe(2);
    expect(encoded).toBe(false); // 인코딩 시도 안 함
  });
});
