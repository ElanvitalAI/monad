// ── Image-to-ANSI preview (chafa / viu wrapper) ──
//
// Render an image file as a block-art ANSI snippet so the dashboard
// can show the user what they just attached — used by the auto-
// dismissing image modal in showImageModal(). Pure shell-out: we
// don't link a renderer at the bun level. The first usable CLI on
// PATH wins; users without one see no preview overlay at all.
//
// Backend choices considered:
//   - chafa (CLI):          best density + color, supports symbols/
//                           sixel/kitty graphics. Already on most
//                           devs' macOS via brew. PICKED.
//   - viu (CLI):            simpler, narrower output. FALLBACK.
//   - terminal-image (npm): pure-JS half-block via jimp. Good if we
//                           ever want zero-deps; quality is lower
//                           than chafa block mode and we'd add a
//                           ~5MB dep. NOT YET ADOPTED.
//
// Cached by `${absPath}|${mtime}|${cols}x${rows}` so re-displaying
// the same attachment at the same size doesn't re-spawn chafa.

import { spawn } from 'bun';
import { statSync } from 'fs';

export type ImagePreviewBackend = 'chafa' | 'viu' | null;

interface CachedRender {
  key: string;
  lines: string[];
}

let detected: ImagePreviewBackend | undefined;
const cache: Map<string, CachedRender> = new Map();

/** Discover which CLI to use. Cached after the first call so we don't
 *  pay a process-spawn for every preview. `chafa` is preferred — it
 *  produces denser, color-accurate Unicode block art and supports
 *  explicit cell-grid sizing. */
async function detectBackend(): Promise<ImagePreviewBackend> {
  if (detected !== undefined) return detected;
  for (const cmd of ['chafa', 'viu'] as const) {
    try {
      const proc = spawn(['which', cmd], { stdout: 'pipe', stderr: 'ignore' });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code === 0 && out.trim().length > 0) {
        detected = cmd;
        return detected;
      }
    } catch { /* try next */ }
  }
  detected = null;
  return detected;
}

export interface ImagePreviewOpts {
  /** Maximum width in terminal cells. Default 32. */
  cols?: number;
  /** Maximum height in terminal cells (rows). Default 12. */
  rows?: number;
}

/** Render `absPath` as ANSI lines suitable for pushing into the log
 *  buffer. Returns null when no backend is installed or the render
 *  failed — caller should skip the preview gracefully in that case
 *  (no fallback "image not previewable" placeholder; the attachment
 *  summary line above already conveys that the file was attached). */
export async function renderImagePreview(
  absPath: string,
  opts: ImagePreviewOpts = {},
): Promise<string[] | null> {
  const cols = Math.max(8, Math.min(80, opts.cols ?? 32));
  const rows = Math.max(4, Math.min(40, opts.rows ?? 12));

  let mtime = 0;
  try { mtime = Math.floor(statSync(absPath).mtimeMs); } catch { return null; }

  const key = `${absPath}|${mtime}|${cols}x${rows}`;
  const hit = cache.get(key);
  if (hit) return hit.lines;

  const backend = await detectBackend();
  if (backend === null) return null;

  let argv: string[];
  if (backend === 'chafa') {
    // --size WxH       fits inside a WxH cell box, preserves aspect
    // --symbols block  use full + half block glyphs for density
    // --colors 256     wide palette without truecolor escape weirdness
    // --animate off    a single frame for animated GIFs (avoids ANSI loop output)
    argv = ['chafa', '--size', `${cols}x${rows}`, '--symbols', 'block',
            '--colors', '256', '--animate', 'off', absPath];
  } else {
    // viu: -w / -h are cell counts; -s skips truecolor detection probe.
    argv = ['viu', '-w', String(cols), '-h', String(rows), '-s', '-b', absPath];
  }

  let stdout = '';
  try {
    const proc = spawn(argv, { stdout: 'pipe', stderr: 'ignore' });
    stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
  } catch {
    return null;
  }

  // Strip the trailing newline so the slice doesn't introduce an
  // empty row at the end of the log push.
  const lines = stdout.replace(/\n$/, '').split('\n');
  cache.set(key, { key, lines });
  return lines;
}

/** Reset the detection + cache. Test-only escape hatch — production
 *  callers never need this since the cache is bounded by attachment
 *  count and stays valid for the session. */
export function _resetForTest(): void {
  detected = undefined;
  cache.clear();
}
