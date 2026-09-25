// ── Font handler ──
//
// Renders a glyph specimen card via `magick` — same approach as yazi's
// font.lua. No real font parsing; we just ask ImageMagick to typeset
// sample text using the file itself as the font source.

import { cachePathFor } from '../cache.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, installHint, type HandlerDeps } from './common.js';

const SPECIMEN = 'ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\nabcdefghijklm\nnopqrstuvwxyz\n0123456789\n!$&*()[]{}';

export function runFont(
  absPath: string,
  _opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };
  const bin = d.which('magick');
  if (!bin) return installHint(absPath, 'imagemagick', 'magick');

  const cachePath = cachePathFor(absPath, 0, '.jpg');
  if (d.exists(cachePath)) return { kind: 'image', cachePath };

  const res = d.spawn(bin, [
    '-size', '800x560',
    '-gravity', 'center',
    '-font', absPath,
    '-pointsize', '56',
    'xc:white',
    '-fill', 'black',
    '-annotate', '+0+0', SPECIMEN,
    `jpg:${cachePath}`,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'magick failed on font', res.stderr);
  }
  return { kind: 'image', cachePath };
}
