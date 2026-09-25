// ── IUL Bundle 8T — recording runtime path resolver ──
//
// Keep the `~/.monad/timelines/` path + directory creation isolated
// from the dispatch module so tests can override either the base
// directory (via deps.baseDir) or the fs shim (via deps.fs) without
// touching the real file system.

import { monadStateRoot } from '../autopilot/state-paths.js';
import path from 'node:path';

/** Default base directory for persisted widget timelines. Tilde is
 *  expanded at call time; callers can also pass an explicit `baseDir`
 *  (tests use `mkdtemp`). */
export function defaultTimelineBaseDir(): string {
  return path.join(monadStateRoot(), 'timelines');
}

/** Path for a given recorder id under the supplied base directory.
 *  `<recorderId>.cast` — asciicast v2.1 convention. */
export function timelinePathFor(baseDir: string, recorderId: string): string {
  return path.join(baseDir, `${recorderId}.cast`);
}
