/**
 * 🔍 샷별 초점(`focus_peak`) — OpenCV 로 «가장 선명한 부위»의 선명도를 잰다(`scripts/video/cv_measure.py`).
 *
 * 📏 2026-09-24 🅢 실측(생성 샷 ⊕ 같은 샷 gblur=3 양성 대조): 상대 비교(같은 샷 원본 대비)는 분별력이 크고
 *    절대값은 겹친다(정상 근접 256 ↔ 흐린 인물 208). ⇒ 이 판은 «관측»만 한다 — 절대 문턱으로 막지 않는다.
 * ⛔ 파이썬·cv2·파일이 없으면 `null` — 「못 잼」이지 0 이 아니다.
 */
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolvePython } from '../../python/resolve-python.js';

export const CV_MEASURE_SCRIPT = resolve(import.meta.dir, '..', '..', '..', 'scripts', 'video', 'cv_measure.py');

export interface FocusMeasurement {
  readonly path: string;
  /** 95 백분위 칸 선명도. null = 못 잼. */
  readonly focusPeak: number | null;
  readonly frames: number;
  readonly faceFrames: number;
  readonly faceCenterX: number | null;
}

export interface FocusDeps {
  /** 파이썬 경로(주입용). 주입 안 하면 `resolvePython()`. null = 파이썬 없음. */
  readonly python?: string | null;
  readonly run?: (bin: string, args: readonly string[]) => { status: number | null; stdout: string };
}

/** 여러 샷의 `focus_peak`. 측정 자체를 못 하면(파이썬 없음·스크립트 실패·산출 모양 틀림) null. */
export function measureFocusPeaks(paths: readonly string[], deps: FocusDeps = {}): FocusMeasurement[] | null {
  if (paths.length === 0) return [];
  const python = deps.python !== undefined ? deps.python : resolvePython()?.path ?? null;
  if (!python) return null;
  const run = deps.run ?? ((bin, args) => {
    const r = spawnSync(bin, [...args], { encoding: 'utf8', timeout: 180_000 });
    return { status: r.status, stdout: r.stdout ?? '' };
  });
  const result = run(python, [CV_MEASURE_SCRIPT, ...paths]);
  if (result.status !== 0) return null;
  try {
    const line = result.stdout.trim().split('\n').at(-1) ?? '';
    const parsed = JSON.parse(line) as { results?: Array<{ path?: unknown; focus_peak?: unknown; frames?: unknown; face_frames?: unknown; face_center_x?: unknown }> };
    if (!Array.isArray(parsed.results) || parsed.results.length !== paths.length) return null;
    return parsed.results.map((entry, index) => ({
      path: typeof entry.path === 'string' ? entry.path : paths[index]!,
      focusPeak: typeof entry.focus_peak === 'number' && Number.isFinite(entry.focus_peak) ? entry.focus_peak : null,
      frames: typeof entry.frames === 'number' && Number.isInteger(entry.frames) && entry.frames >= 0 ? entry.frames : 0,
      faceFrames: typeof entry.face_frames === 'number' && Number.isInteger(entry.face_frames) && entry.face_frames >= 0 ? entry.face_frames : 0,
      faceCenterX: typeof entry.face_center_x === 'number' && Number.isFinite(entry.face_center_x) && entry.face_center_x >= 0 && entry.face_center_x <= 1 ? entry.face_center_x : null,
    }));
  } catch {
    return null;
  }
}

/** QC 결과 문면 한 조각 — 샷별 값 · 가장 낮은 샷 · 못 잰 샷 수. */
export function describeFocus(measurements: readonly FocusMeasurement[] | null): string {
  if (measurements === null) return 'focus_peak «못 쟀다»(파이썬/cv2 없음 또는 측정 실패)';
  if (measurements.length === 0) return 'focus_peak 잴 샷 없음';
  const measured = measurements.filter((m) => m.focusPeak !== null);
  const missing = measurements.length - measured.length;
  if (measured.length === 0) return `focus_peak 샷 ${measurements.length}개 모두 «못 쟀다»`;
  const lowest = measured.reduce((a, b) => (b.focusPeak! < a.focusPeak! ? b : a));
  const values = measurements.map((m) => (m.focusPeak === null ? '?' : String(Math.round(m.focusPeak)))).join('/');
  return `focus_peak ${values} · 최저 ${Math.round(lowest.focusPeak!)}(${lowest.path.split('/').at(-1)})${missing ? ` · 못 잰 샷 ${missing}` : ''} · 관측만(관문 아님)`;
}

