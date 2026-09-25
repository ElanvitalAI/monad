import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePython } from '../../python/resolve-python.js';
import { describeFocus, measureFocusPeaks } from './focus.js';

const python = resolvePython()?.path ?? null;
const hasCv2 = python !== null && spawnSync(python, ['-c', 'import cv2'], { encoding: 'utf8' }).status === 0;
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;

describe('focus_peak (OpenCV)', () => {
  test.skipIf(!hasCv2 || !hasFfmpeg)('[needs monad python venv with cv2 and ffmpeg] a gblur=3 copy scores far below the sharp original, and a missing file is null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'focus-peak-'));
    try {
      const sharp = join(dir, 'sharp.mp4');
      const blur = join(dir, 'blur.mp4');
      expect(spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-t', '1', sharp]).status).toBe(0);
      expect(spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', sharp, '-vf', 'gblur=sigma=3', blur]).status).toBe(0);
      const measured = measureFocusPeaks([sharp, blur, join(dir, 'missing.mp4')])!;
      expect(measured).toHaveLength(3);
      const [s, b, missing] = measured;
      expect(s!.focusPeak! / b!.focusPeak!).toBeGreaterThan(5);
      expect(missing!.focusPeak).toBeNull();
      expect(missing).toMatchObject({ frames: 0, faceFrames: 0, faceCenterX: null });
      expect(s!.frames).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('한 번의 스크립트 호출에서 얼굴 프레임·중앙값과 기존 초점값을 함께 파싱한다', () => {
    let calls = 0;
    const measured = measureFocusPeaks(['/a'], { python: '/py', run: (_bin, args) => {
      calls++;
      expect(args).toHaveLength(2);
      return { status: 0, stdout: '{"results":[{"path":"/a","focus_peak":2665,"frames":8,"face_frames":6,"face_center_x":0.58}]}' };
    } });
    expect(calls).toBe(1);
    expect(measured).toEqual([{ path: '/a', focusPeak: 2665, frames: 8, faceFrames: 6, faceCenterX: 0.58 }]);
  });

  test('no python means "not measured" (null), not zero', () => {
    expect(measureFocusPeaks(['/x.mp4'], { python: null })).toBeNull();
    expect(describeFocus(null)).toContain('못 쟀다');
  });

  test('a failed or malformed measurement run is null; a well-formed one keeps per-shot nulls', () => {
    expect(measureFocusPeaks(['/a'], { python: '/py', run: () => ({ status: 1, stdout: '' }) })).toBeNull();
    expect(measureFocusPeaks(['/a', '/b'], { python: '/py', run: () => ({ status: 0, stdout: '{"results":[{"path":"/a","focus_peak":10}]}' }) })).toBeNull();
    const ok = measureFocusPeaks(['/a', '/b'], { python: '/py', run: () => ({ status: 0, stdout: 'noise\n{"results":[{"path":"/a","focus_peak":812.4},{"path":"/b","focus_peak":null}]}' }) })!;
    expect(ok).toEqual([{ path: '/a', focusPeak: 812.4, frames: 0, faceFrames: 0, faceCenterX: null }, { path: '/b', focusPeak: null, frames: 0, faceFrames: 0, faceCenterX: null }]);
    expect(describeFocus(ok)).toBe('focus_peak 812/? · 최저 812(a) · 못 잰 샷 1 · 관측만(관문 아님)');
  });
});
