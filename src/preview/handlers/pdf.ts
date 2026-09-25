// ── PDF handler ──
//
// Converts a single PDF page to JPG via poppler's `pdftoppm`. Matches
// yazi's pdf.lua:
//   pdftoppm -f N -l N -singlefile -jpeg -jpegopt quality=Q FILE PREFIX
//
// pdftoppm emits `<prefix>.jpg`, so we strip the `.jpg` off the cache
// path we computed and let the tool append it. `opts.skip` maps to the
// 0-indexed page offset (0 → first page).

import { cachePathFor } from '../cache.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, installHint, type HandlerDeps } from './common.js';

const QUALITY = 75;

export function runPdf(
  absPath: string,
  opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };
  const bin = d.which('pdftoppm');
  if (!bin) return installHint(absPath, 'poppler', 'pdftoppm');

  const page = Math.max(0, Math.floor(opts.skip ?? 0));
  const cachePath = cachePathFor(absPath, page, '.jpg');

  if (d.exists(cachePath)) {
    return { kind: 'image', cachePath };
  }

  // pdftoppm -singlefile appends `.jpg` to the PREFIX it's given.
  const prefix = cachePath.replace(/\.jpg$/, '');
  const res = d.spawn(bin, [
    '-f', String(page + 1),
    '-l', String(page + 1),
    '-singlefile',
    '-jpeg',
    '-jpegopt', `quality=${QUALITY}`,
    absPath,
    prefix,
  ]);

  if (res.status !== 0) {
    return errorLines(absPath, 'pdftoppm failed', res.stderr);
  }
  return { kind: 'image', cachePath };
}
