// Phase 1 (PLAN-config-unification-elanous-root-2026-05-10):
//   one-time migrate ~/.config/elanous/<subdir>/ → ~/.elanous/<subdir>/
//
// Used by storage modules (policy, budget) whose DEFAULT_STORAGE_DIR
// flipped from XDG to ~/.elanous/. SQLite-aware (multi-file copy that
// preserves .sqlite + .sqlite-shm + .sqlite-wal together). Idempotent
// per-process · safe to call from every consumer's constructor.
//
// Behavior:
//   - old dir absent          → no-op
//   - new dir already has files → no-op (don't clobber newer state)
//   - else                    → copy all files · rename old → .bak
//
// FU2 (closing follow-up · 2026-05-10): `migrateLegacyXdgFile()` is the
// single-file analogue used by oauth/auth.json · acp/acp-sessions.json ·
// codex-app-server-threads.json · expression/setup-answers.json. Same
// idempotent + .bak semantics, no overwrite of existing target.

import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const migrated = new Set<string>();
const migratedFiles = new Set<string>();

/** Resolve the home directory. Tests inject via `ELANOUS_TEST_HOME` so they
 *  cannot accidentally migrate the user's actual ~/.config/elanous/ — Bun's
 *  `os.homedir()` does not always honor `process.env.HOME` overrides. */
function resolveHome(): string {
  const testHome = process.env.ELANOUS_TEST_HOME?.trim();
  if (testHome) return testHome;
  return homedir();
}

export function migrateLegacyXdgSubdir(subdir: string): void {
  if (migrated.has(subdir)) return;
  migrated.add(subdir);

  const home = resolveHome();
  const oldDir = join(home, '.config', 'elanous', subdir);
  const newDir = join(home, '.elanous', subdir);

  if (!existsSync(oldDir)) return;

  if (existsSync(newDir)) {
    let entries: string[];
    try { entries = readdirSync(newDir); } catch { return; }
    if (entries.length > 0) return;
  } else {
    try { mkdirSync(newDir, { recursive: true }); }
    catch { return; }
  }

  let oldEntries: string[];
  try { oldEntries = readdirSync(oldDir); }
  catch { return; }

  let copied = 0;
  for (const entry of oldEntries) {
    const oldPath = join(oldDir, entry);
    const newPath = join(newDir, entry);
    try {
      const s = statSync(oldPath);
      if (!s.isFile()) continue;
      copyFileSync(oldPath, newPath);
      copied++;
    } catch {
      // Locked file or perm issue · skip · best-effort migration.
    }
  }

  if (copied > 0) {
    try { renameSync(oldDir, oldDir + '.bak'); }
    catch { /* hygiene-only; copy already succeeded */ }
  }
}

export function __resetLegacyMigrateForTests(): void {
  migrated.clear();
  migratedFiles.clear();
}

/** Single-file analogue of migrateLegacyXdgSubdir. Copies
 *  ~/.config/elanous/<filename> → ~/.elanous/<filename> once-per-process,
 *  preserves the source as .bak. `mode` defaults to 0o600 (user-config
 *  files often carry secrets such as OAuth tokens). */
export function migrateLegacyXdgFile(filename: string, mode: number = 0o600): void {
  migrateLegacyHomeFile({
    legacyHomeRel: join('.config', 'elanous', filename),
    elanousRel: filename,
    mode,
  });
}

/** General-purpose home-relative file migration. FU2 Tier 2/3 uses this
 *  for `~/.config/monad-agent/...` and `~/.monad-agent/...` legacies that
 *  don't fit the `~/.config/elanous/<name>` shape `migrateLegacyXdgFile`
 *  assumes. Idempotent · once-per-process · preserves source as `.bak`. */
export interface MigrateLegacyHomeFileOpts {
  /** Path relative to home of the legacy file, e.g. '.config/monad-agent/hints.json'. */
  legacyHomeRel: string;
  /** Path relative to ~/.elanous/ for the new location, e.g. 'hints.json'. */
  elanousRel: string;
  mode?: number;
}

export function migrateLegacyHomeFile(opts: MigrateLegacyHomeFileOpts): void {
  const key = `file:${opts.legacyHomeRel}`;
  if (migratedFiles.has(key)) return;
  migratedFiles.add(key);

  const home = (() => {
    const t = process.env.ELANOUS_TEST_HOME?.trim();
    return t ? t : homedir();
  })();
  const oldPath = join(home, opts.legacyHomeRel);
  const newPath = join(home, '.elanous', opts.elanousRel);

  if (!existsSync(oldPath)) return;
  if (existsSync(newPath)) return;

  try { mkdirSync(dirname(newPath), { recursive: true }); }
  catch { return; }

  try {
    copyFileSync(oldPath, newPath);
    try { chmodSync(newPath, opts.mode ?? 0o600); } catch { /* best-effort */ }
  } catch { return; }

  try { renameSync(oldPath, oldPath + '.bak'); }
  catch { /* hygiene */ }
}

/** Directory analogue of `migrateLegacyHomeFile`. Used for arbitrary
 *  legacy dirs (e.g. `~/.monad-agent/audit/` → `~/.elanous/audit/`). */
export interface MigrateLegacyHomeDirOpts {
  legacyHomeRel: string;
  elanousRel: string;
}

export function migrateLegacyHomeDir(opts: MigrateLegacyHomeDirOpts): void {
  const key = `dir:${opts.legacyHomeRel}`;
  if (migratedFiles.has(key)) return;
  migratedFiles.add(key);

  const home = (() => {
    const t = process.env.ELANOUS_TEST_HOME?.trim();
    return t ? t : homedir();
  })();
  const oldDir = join(home, opts.legacyHomeRel);
  const newDir = join(home, '.elanous', opts.elanousRel);

  if (!existsSync(oldDir)) return;

  if (existsSync(newDir)) {
    let entries: string[];
    try { entries = readdirSync(newDir); } catch { return; }
    if (entries.length > 0) return;
  } else {
    try { mkdirSync(newDir, { recursive: true }); }
    catch { return; }
  }

  let oldEntries: string[];
  try { oldEntries = readdirSync(oldDir); }
  catch { return; }

  let copied = 0;
  for (const entry of oldEntries) {
    const oldPath = join(oldDir, entry);
    const newPath = join(newDir, entry);
    try {
      const s = statSync(oldPath);
      if (!s.isFile()) continue;
      copyFileSync(oldPath, newPath);
      copied++;
    } catch { /* skip locked files */ }
  }

  if (copied > 0) {
    try { renameSync(oldDir, oldDir + '.bak'); }
    catch { /* hygiene */ }
  }
}
