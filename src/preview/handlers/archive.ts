// ── Archive handler ──
//
// Uses `7zz l -ba` (brew `sevenzip` exposes the binary as `7zz`; the
// classic `7z` name ships with p7zip, which brew aliases away). The
// `-ba` flag strips the header/footer so stdout is one row per entry:
//
//   2026-04-17 12:34:56 D....      0     0  subdir
//   2026-04-17 12:34:56 .....   4096  1234  subdir/file.txt
//
// Columns are fixed up to the path, which starts at col 53. We don't
// render a ratatui-style tree (yazi does); flat listing with a folder
// marker is enough for a TUI peek.

import { C } from '../../tui.js';
import type { PreviewResult, RunOpts } from '../index.js';
import { defaultDeps, errorLines, header, installHint, type HandlerDeps } from './common.js';

const MAX_ENTRIES = 500;
const PATH_COL = 53;

export function runArchive(
  absPath: string,
  _opts: RunOpts,
  deps: HandlerDeps = {},
): PreviewResult {
  const d = { ...defaultDeps(), ...deps };
  const bin = d.which('7zz') ?? d.which('7z');
  if (!bin) return installHint(absPath, 'sevenzip', '7zz');

  const res = d.spawn(bin, ['l', '-ba', absPath]);
  if (res.status !== 0) {
    return errorLines(absPath, '7zz list failed', res.stderr);
  }

  const raw = res.stdout.split('\n').filter(l => l.length >= PATH_COL);
  const out: string[] = [...header(absPath)];
  let total = 0, dirs = 0;
  for (const line of raw.slice(0, MAX_ENTRIES)) {
    const attrs = line.slice(20, 25);
    const sizeField = line.slice(26, 38).trim();
    const path = line.slice(PATH_COL).trim();
    if (path.length === 0) continue;
    const isDir = attrs.startsWith('D');
    if (isDir) dirs++;
    total++;
    const label = isDir ? C.muted(`  ${path}/`) : `  ${path}`;
    const size = !isDir && sizeField.length > 0 ? C.muted(`  ${sizeField}B`) : '';
    out.push(`${label}${size}`);
  }
  if (raw.length > MAX_ENTRIES) {
    out.push(C.muted(`  ... +${raw.length - MAX_ENTRIES} more entries`));
  }
  out.splice(3, 0, C.muted(`  ${total} entries · ${dirs} dirs`), '');
  return { kind: 'lines', lines: out };
}
