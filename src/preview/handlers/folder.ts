// ── Folder handler ──
//
// `eza --tree --color=always --icons=always -L 2 DIR` gives a compact
// colored tree with file-type glyphs. Falls back to an in-process
// readdirSync walk when eza isn't installed — no second external
// dependency on the critical path.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { C } from '../../tui.js';
import { fileColor, fileIcon } from '../../panes/file-icons.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, header, type HandlerDeps } from './common.js';

const DEFAULT_DEPTH = 2;
const MAX_LINES = 400;

export function runFolder(
  absPath: string,
  _opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };

  const eza = d.which('eza');
  if (eza) {
    const res = d.spawn(eza, [
      '--tree',
      '--color=always',
      '--icons=always',
      '-L', String(DEFAULT_DEPTH),
      absPath,
    ]);
    if (res.status === 0) {
      const body = res.stdout.split('\n').slice(0, MAX_LINES);
      return { kind: 'lines', lines: [...header(absPath), ...body] };
    }
    return errorLines(absPath, 'eza failed', res.stderr);
  }

  return nativeListing(absPath);
}

function nativeListing(absPath: string): PreviewResult {
  const out = [...header(absPath)];
  try {
    const entries = readdirSync(absPath, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_LINES);
    for (const ent of entries) {
      if (ent.isDirectory()) {
        out.push(`  ${C.bold('')} ${ent.name}/`);
      } else {
        let size = '';
        try { size = ` ${humanSize(statSync(join(absPath, ent.name)).size)}`; } catch { /* ignore */ }
        out.push(`  ${fileIcon(ent.name)} ${fileColor(ent.name)(ent.name)}${C.muted(size)}`);
      }
    }
  } catch (e: unknown) {
    out.push(C.muted(`  (unable to read directory: ${String((e as Error).message)})`));
  }
  return { kind: 'lines', lines: out };
}

function humanSize(n: number): string {
  const units = ['B', 'K', 'M', 'G'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`;
}
