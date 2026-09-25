// ── Handler utilities shared across pdf/svg/video/font/magick ──
//
// The non-text handlers follow the same recipe:
//   1. Look up an external tool (which). Missing → install hint.
//   2. Compute cache path. Exists → return it directly (cache hit).
//   3. Spawn converter; on failure → error message lines.
//   4. On success → { kind: 'image', cachePath }.
//
// The DI hooks below let tests exercise each branch without touching
// a real binary.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { C } from '../../tui.js';
import { fileColor, fileIcon } from '../../panes/file-icons.js';
import { whichSync } from '../detect.js';
import type { PreviewResult } from '../index.js';

export interface SpawnResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

export interface HandlerDeps {
  /** Resolve a command name to an absolute path, or null if missing. */
  which?: (cmd: string) => string | null;
  /** Run a command synchronously. */
  spawn?: (cmd: string, args: string[]) => SpawnResult;
  /** Check whether a cache file already exists on disk. */
  exists?: (path: string) => boolean;
}

export function defaultDeps(): Required<HandlerDeps> {
  return {
    which: whichSync,
    spawn: (cmd, args) => {
      const r: SpawnSyncReturns<Buffer> = spawnSync(cmd, args);
      return {
        status: r.status,
        stderr: r.stderr?.toString() ?? '',
        stdout: r.stdout?.toString() ?? '',
      };
    },
    exists: existsSync,
  };
}

export function header(absPath: string): string[] {
  const base = absPath.slice(absPath.lastIndexOf('/') + 1);
  return [
    `${C.bold(fileIcon(base))} ${fileColor(base)(base)}`,
    C.muted(absPath),
    '',
  ];
}

export function installHint(
  absPath: string,
  brewPkg: string,
  cmd: string,
): PreviewResult {
  return {
    kind: 'lines',
    lines: [
      ...header(absPath),
      C.muted(`  (${cmd} not found — install with: brew install ${brewPkg})`),
    ],
  };
}

export function errorLines(
  absPath: string,
  summary: string,
  detail?: string,
): PreviewResult {
  const lines = [...header(absPath), C.muted(`  ${summary}`)];
  if (detail && detail.trim().length > 0) {
    for (const dl of detail.trim().split('\n').slice(0, 6)) {
      lines.push(C.muted(`    ${dl}`));
    }
  }
  return { kind: 'lines', lines };
}
