// ── Image handler ──
//
// PNG/JPG/GIF/WEBP/BMP/TIFF → pass the original path through
// (chafa renders them natively in the UI layer).
//
// AVIF / HEIC / HEIF / JXL → chafa and viu can't always decode these
// without external libs, so we run them through ImageMagick first
// and hand the UI a decoded JPG in the preview cache. Mirrors yazi's
// magick.lua flow.

import { extname } from 'node:path';
import { cachePathFor } from '../cache.js';
import { _internal } from '../router.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, installHint, type HandlerDeps } from './common.js';

export function runImage(
  absPath: string,
  _opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const ext = extname(absPath).toLowerCase();

  if (!_internal.MAGICK_EXTS.has(ext)) {
    return { kind: 'image', cachePath: absPath };
  }

  const d = { ...defaultDeps(), ...deps };
  const bin = d.which('magick');
  if (!bin) return installHint(absPath, 'imagemagick', 'magick');

  const cachePath = cachePathFor(absPath, 0, '.jpg');
  if (d.exists(cachePath)) return { kind: 'image', cachePath };

  const res = d.spawn(bin, [
    absPath,
    '-auto-orient',
    '-strip',
    '-filter', 'triangle',
    '-thumbnail', '800x800>',
    '-quality', '75',
    `jpg:${cachePath}`,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'magick failed on image', res.stderr);
  }
  return { kind: 'image', cachePath };
}
