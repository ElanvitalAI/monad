// ── Fallback handler ──
//
// For MIME types we don't yet handle or for binary blobs. Shows the
// filename + a short "no preview available" hint. Non-null so the UI
// layer doesn't have to special-case "nothing to show".

import { statSync } from 'node:fs';
import { C } from '../../tui.js';
import { fileColor, fileIcon } from '../../panes/file-icons.js';
import type { PreviewResult, RunOpts } from '../index.js';

export function runFallback(absPath: string, _opts: RunOpts): PreviewResult {
  const base = absPath.slice(absPath.lastIndexOf('/') + 1);
  let size = '';
  try { size = humanSize(statSync(absPath).size); } catch { /* ignore */ }
  return {
    kind: 'lines',
    lines: [
      `${C.bold(fileIcon(base))} ${fileColor(base)(base)}`,
      C.muted(absPath),
      '',
      C.muted(size ? `  (${size} — no preview available)` : '  (no preview available)'),
    ],
  };
}

function humanSize(n: number): string {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`;
}
