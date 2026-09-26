// ── PX-7 P1: declarative-source discovery ──
//
// Resolves the 3-path precedence for .md / .sh declarations the
// elanous-declarative plugin loads:
//   1. <cwd>/.elanous/<kind>/       — project-local (overrides user)
//   2. ~/.elanous/<kind>/            — user-global
//   3. <repo>/plugins/*/catalog/  — plugin-bundled (reserved)
//
// Listing honours the `<kind>/` direct-child-file convention for five
// kinds (agents / skills / hooks / routes / workflows — one file per
// declaration) and the `<kind>/<id>/mission.md` directory convention
// for `missions` (evaluator.sh + sandbox.md siblings).
//
// Auto-creates `~/.elanous/<kind>/` on first touch so a fresh
// environment does not need a setup script.

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type DeclarativeKind =
  | 'agents'
  | 'skills'
  | 'missions'
  | 'workflows'
  | 'hooks'
  | 'routes';

export const DECLARATIVE_KINDS: readonly DeclarativeKind[] = [
  'agents', 'skills', 'missions', 'workflows', 'hooks', 'routes',
] as const;

export interface DeclarativeSources {
  user: string;              // ~/.elanous — always set, auto-created
  project?: string;          // <cwd>/.elanous — only when it already exists
}

export interface DiscoverOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Resolve the user + project roots. Creates `~/.elanous/<kind>/` for
 *  all 6 kinds if missing so the watcher has something to listen to
 *  out of the box. project source is returned only when `<cwd>/.elanous/`
 *  already exists — we never auto-create inside a user project. */
export function resolveDeclarativeSources(opts: DiscoverOpts = {}): DeclarativeSources {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const userRoot = env.ELANOUS_HOME?.trim() || join(home, '.elanous');
  for (const kind of DECLARATIVE_KINDS) {
    const dir = join(userRoot, kind);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const projectRoot = join(opts.cwd ?? process.cwd(), '.elanous');
  if (existsSync(projectRoot)) {
    return { user: userRoot, project: projectRoot };
  }
  return { user: userRoot };
}

/** Enumerate candidate files for a kind in the given root. Returns
 *  absolute paths. Skips hidden (./.foo), underscore-prefixed, and
 *  non-markdown entries. Mission declarations are discovered as
 *  subdirectories containing `mission.md`. */
export function listDeclarativeFiles(root: string, kind: DeclarativeKind): string[] {
  const kindDir = join(root, kind);
  if (!existsSync(kindDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(kindDir)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const path = join(kindDir, entry);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (kind === 'missions' && st.isDirectory()) {
      const missionMd = join(path, 'mission.md');
      if (existsSync(missionMd)) out.push(missionMd);
      continue;
    }
    if (!st.isFile()) continue;
    if (!entry.endsWith('.md')) continue;
    out.push(path);
  }
  return out.sort();
}
