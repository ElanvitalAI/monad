// ── Markdown-to-ANSI preview (glow wrapper) ──
//
// Optional enhancement to the plain colorLine preview path: when
// `glow` (https://github.com/charmbracelet/glow) is on PATH, we let
// it render markdown with headings/code blocks/tables styled for the
// terminal. Falls through to `null` when glow is missing so callers
// can keep the existing plaintext pipeline as a fallback.
//
// Cache key: `${absPath}|${mtime}|${size}|${width}` — re-previewing
// the same file at the same pane width is free.

import { spawn } from 'bun';
import { statSync } from 'fs';

let detected: 'glow' | null | undefined;
const cache: Map<string, string[]> = new Map();

export async function detectGlow(): Promise<boolean> {
  if (detected !== undefined) return detected === 'glow';
  try {
    const proc = spawn(['which', 'glow'], { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    detected = (code === 0 && out.trim().length > 0) ? 'glow' : null;
  } catch {
    detected = null;
  }
  return detected === 'glow';
}

export interface MarkdownPreviewOpts {
  /** Pane width (cells). glow's `-w` flag respects this so tables /
   *  code blocks don't overflow. Default 80. */
  width?: number;
  /** Style name. `auto` adapts to the terminal theme; `dark` / `light`
   *  force one. Default 'auto'. */
  style?: 'auto' | 'dark' | 'light';
}

/** Render `absPath` via glow. Returns null when glow isn't installed
 *  or the render fails — caller falls back to colorLine. */
export async function renderMarkdown(
  absPath: string,
  opts: MarkdownPreviewOpts = {},
): Promise<string[] | null> {
  if (!(await detectGlow())) return null;

  const width = Math.max(20, Math.min(200, opts.width ?? 80));
  const style = opts.style ?? 'auto';

  let mtime = 0;
  let size = 0;
  try {
    const st = statSync(absPath);
    mtime = Math.floor(st.mtimeMs);
    size = st.size;
  } catch { return null; }

  const key = `${absPath}|${mtime}|${size}|${width}|${style}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // `-s auto|dark|light` styles headings/code/etc.; `-w N` wraps to
  // pane width. No pager — we capture stdout directly.
  const argv = ['glow', '-s', style, '-w', String(width), absPath];
  let stdout = '';
  try {
    const proc = spawn(argv, { stdout: 'pipe', stderr: 'ignore' });
    stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
  } catch {
    return null;
  }

  const lines = stdout.replace(/\n$/, '').split('\n');
  cache.set(key, lines);
  return lines;
}

/** Test-only escape hatch to reset the detection cache. */
export function _resetForTest(): void {
  detected = undefined;
  cache.clear();
}
