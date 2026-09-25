// ── SVG handler ──
//
// Prefer `rsvg-convert` (librsvg) — it's what magick's SVG delegate
// actually shells out to anyway, and the direct call avoids magick's
// font-rendering pipeline (which trips on empty font attrs in some
// SVGs). Falls back to `magick` when rsvg is missing. Roughly
// mirrors yazi's svg.lua, which uses the Rust `resvg` binary.

import { cachePathFor } from '../cache.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, installHint, type HandlerDeps } from './common.js';

const MAX_W = 800;
const MAX_H = 600;

export function runSvg(
  absPath: string,
  _opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };

  const rsvg = d.which('rsvg-convert');
  if (rsvg) return viaRsvg(absPath, rsvg, d);

  const magick = d.which('magick');
  if (magick) return viaMagick(absPath, magick, d);

  return installHint(absPath, 'librsvg', 'rsvg-convert');
}

function viaRsvg(
  absPath: string,
  bin: string,
  d: Required<HandlerDeps>,
): PreviewResult {
  const cachePath = cachePathFor(absPath, 0, '.png');
  if (d.exists(cachePath)) return { kind: 'image', cachePath };

  const res = d.spawn(bin, [
    '-w', String(MAX_W),
    '-h', String(MAX_H),
    '-b', 'white',
    absPath,
    '-o', cachePath,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'rsvg-convert failed', res.stderr);
  }
  return { kind: 'image', cachePath };
}

function viaMagick(
  absPath: string,
  bin: string,
  d: Required<HandlerDeps>,
): PreviewResult {
  const cachePath = cachePathFor(absPath, 0, '.jpg');
  if (d.exists(cachePath)) return { kind: 'image', cachePath };

  const res = d.spawn(bin, [
    '-background', 'white',
    absPath,
    '-resize', `${MAX_W}x${MAX_H}>`,
    '-quality', '75',
    `jpg:${cachePath}`,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'magick failed on SVG', res.stderr);
  }
  return { kind: 'image', cachePath };
}
