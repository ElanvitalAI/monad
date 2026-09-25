// ── Text handler ──
//
// Generic text/code preview. Uses `bat` when available (ANSI syntax
// highlighting + line numbers, matches the look of Phase C's richer
// code pane) and falls back to the existing in-process regex
// highlighter from panes/syntax-color.ts.
//
// Returns ANSI-formatted lines. Producers of the preview UI (markdown
// widget, modal, finder pane) treat these as preformatted ANSI —
// identical to the path used by preview-pane.ts today.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { C } from '../../tui.js';
import { fileColor, fileIcon } from '../../panes/file-icons.js';
import { colorLine } from '../../panes/syntax-color.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { whichSync } from '../detect.js';

const MAX_LINES_DEFAULT = 400;

export function runText(absPath: string, opts: RunOpts): PreviewResult {
  const maxLines = Math.max(20, Math.min(2000, opts.maxLines ?? MAX_LINES_DEFAULT));
  const maxW = Math.max(20, Math.min(400, opts.cols ?? 120));

  const head = buildHeader(absPath);

  const bat = whichSync('bat');
  if (bat) {
    const res = spawnSync(bat, [
      '--color=always',
      '--paging=never',
      '--style=numbers,changes',
      `--line-range=:${maxLines}`,
      '--terminal-width', String(maxW),
      absPath,
    ], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.length > 0) {
      const body = stripTrailingNewline(res.stdout).split('\n');
      return { kind: 'lines', lines: [...head, ...body] };
    }
  }

  return fallbackHighlight(absPath, maxLines, maxW, head);
}

function buildHeader(absPath: string): string[] {
  const base = absPath.slice(absPath.lastIndexOf('/') + 1);
  return [
    `${C.bold(fileIcon(base))} ${fileColor(base)(base)}`,
    C.muted(absPath),
    '',
  ];
}

function fallbackHighlight(
  absPath: string,
  maxLines: number,
  maxW: number,
  head: string[],
): PreviewResult {
  const ext = extname(absPath).toLowerCase();
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { kind: 'lines', lines: [...head, C.muted('  (unable to read)')] };
  }
  const raw = content.split('\n');
  const take = raw.slice(0, maxLines);
  const out: string[] = [...head];
  for (let i = 0; i < take.length; i++) {
    const n = C.muted(String(i + 1).padStart(3) + ' │');
    let line = take[i]!;
    if (line.length > maxW - 8) line = line.slice(0, maxW - 9) + '…';
    out.push(`${n} ${colorLine(line, ext)}`);
  }
  if (raw.length > take.length) {
    out.push(C.muted(`  ... +${raw.length - take.length} more lines`));
  }
  return { kind: 'lines', lines: out };
}

function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}
