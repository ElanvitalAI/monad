// ── Video handler ──
//
// `ffmpegthumbnailer -i in.mp4 -s 800 -t 10% -o cache.jpg` — one
// command, no ffprobe dance. Yazi runs ffmpeg directly because it
// wants keyframe-skip + hwaccel knobs; for a TUI thumbnail, the
// simpler path is fine.
//
// `opts.skip` advances through the video in 10% steps (skip=0 → 10%,
// skip=1 → 20%, …, capped at 90%).

import { cachePathFor } from '../cache.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, installHint, type HandlerDeps } from './common.js';

const STEP_PCT = 10;
const START_PCT = 10;
const MAX_PCT = 90;

export function runVideo(
  absPath: string,
  opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };
  const bin = d.which('ffmpegthumbnailer');
  if (!bin) return installHint(absPath, 'ffmpegthumbnailer', 'ffmpegthumbnailer');

  const skip = Math.max(0, Math.floor(opts.skip ?? 0));
  const pct = Math.min(MAX_PCT, START_PCT + skip * STEP_PCT);
  const cachePath = cachePathFor(absPath, skip, '.jpg');

  if (d.exists(cachePath)) return { kind: 'image', cachePath };

  const res = d.spawn(bin, [
    '-i', absPath,
    '-s', '800',
    '-t', `${pct}%`,
    '-q', '8',
    '-o', cachePath,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'ffmpegthumbnailer failed', res.stderr);
  }
  return { kind: 'image', cachePath };
}
