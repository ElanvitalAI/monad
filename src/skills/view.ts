// ── Skill view state + helpers (Phase S3) ──
//
// Backing data for the Skill view (V3): a list of skills under
// LOCAL_SKILLS_DIR plus a flattened file listing for the currently
// selected skill. File listing filters by an extension whitelist
// (per PLAN Q3) and always surfaces the skill manifest (`SKILL.md` /
// `skill.md`) at the top.
//
// Pure data layer — no TUI imports so tests can drive it without
// spinning a dashboard.

import { readdirSync, statSync, type Stats } from 'fs';
import { join, resolve, basename, relative } from 'path';

/** One discovered skill — directory that sits under the skills root. */
export interface SkillInfo {
  name: string;      // basename of the skill directory
  dir: string;       // absolute path
}

/** One file row in the flattened Skill File pane. `relPath` is the
 *  file's path relative to the skill dir so rows stay readable when
 *  the file lives in a deep subdirectory. */
export interface SkillFileEntry {
  name: string;
  absPath: string;
  relPath: string;
  ext: string;
  size: number;
  mtime: number;
  /** True when this row is the skill manifest; sorted to the top. */
  isManifest: boolean;
}

export interface SkillViewState {
  skillsRoot: string;
  skills: SkillInfo[];
  skillCursor: number;
  skillOffset: number;

  /** Flattened files of the skill under skillCursor. */
  files: SkillFileEntry[];
  fileCursor: number;
  fileOffset: number;
  /** Selected file paths (multi-select attach). */
  selected: Set<string>;
}

/** Code/doc extensions that count as "skill content". Kept broad
 *  enough for most language mixes; trim here if a skill's node_modules
 *  accidentally slips through (we already filter that directory below). */
export const SKILL_FILE_EXTS = new Set([
  'md', 'markdown',
  'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx',
  'py',
  'sh', 'bash', 'zsh',
]);

/** Directories that never contribute files to the flat listing — they
 *  bloat the output or are build artefacts the user doesn't edit. */
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.venv', 'venv',
  '.git', '.hg', '.svn',
  'dist', 'build', 'target', 'out',
  '.next', '.nuxt', '.cache',
]);

export function createSkillViewState(skillsRoot: string): SkillViewState {
  return {
    skillsRoot: resolve(skillsRoot),
    skills: [],
    skillCursor: 0,
    skillOffset: 0,
    files: [],
    fileCursor: 0,
    fileOffset: 0,
    selected: new Set(),
  };
}

/** Rescan the skills root for top-level directories. Preserves the
 *  current skillCursor when possible by matching the previous skill
 *  name. Skipped silently when the root is missing. */
export function refreshSkills(state: SkillViewState): void {
  const prevName = state.skills[state.skillCursor]?.name;
  let names: string[] = [];
  try { names = readdirSync(state.skillsRoot); } catch { /* missing root */ }
  const skills: SkillInfo[] = [];
  for (const n of names) {
    if (n.startsWith('.')) continue;
    const dir = join(state.skillsRoot, n);
    let st: Stats;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    skills.push({ name: n, dir });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  state.skills = skills;
  if (prevName) {
    const i = skills.findIndex(s => s.name === prevName);
    state.skillCursor = i >= 0 ? i : 0;
  } else {
    state.skillCursor = 0;
  }
  state.skillCursor = Math.min(state.skillCursor, Math.max(0, skills.length - 1));
}

function walkSkill(skillDir: string, out: SkillFileEntry[]): void {
  let names: string[] = [];
  try { names = readdirSync(skillDir); } catch { return; }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    if (n.startsWith('.')) continue;
    const abs = join(skillDir, n);
    let st: Stats;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      walkSkill(abs, out);
      continue;
    }
    if (!st.isFile()) continue;
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : '';
    if (!SKILL_FILE_EXTS.has(ext)) continue;
    // Scope the relPath search to the original skill root. We lose
    // that information inside walkSkill's recursion, so compute it
    // lazily from the absolute path in refreshSkillFiles.
    out.push({
      name: n,
      absPath: abs,
      relPath: '',
      ext,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      isManifest: false,
    });
  }
}

/** Rebuild the file list for the currently selected skill. The
 *  skill manifest (`SKILL.md` / `skill.md`) always sorts first; the
 *  remainder is alphabetical by relative path. */
export function refreshSkillFiles(state: SkillViewState): void {
  state.files = [];
  state.fileCursor = 0;
  state.fileOffset = 0;
  const skill = state.skills[state.skillCursor];
  if (!skill) return;
  const raw: SkillFileEntry[] = [];
  walkSkill(skill.dir, raw);
  for (const e of raw) {
    e.relPath = relative(skill.dir, e.absPath);
    e.isManifest = /^skill\.(md|markdown)$/i.test(basename(e.absPath));
  }
  raw.sort((a, b) => {
    if (a.isManifest !== b.isManifest) return a.isManifest ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
  state.files = raw;
  // Drop stale selections (file may have disappeared).
  const alive = new Set(raw.map(r => r.absPath));
  for (const p of [...state.selected]) if (!alive.has(p)) state.selected.delete(p);
}

export function skillFocusedFile(state: SkillViewState): SkillFileEntry | null {
  return state.files[state.fileCursor] ?? null;
}

export function skillFocusedSkill(state: SkillViewState): SkillInfo | null {
  return state.skills[state.skillCursor] ?? null;
}

export function skillToggleSelection(
  state: SkillViewState,
  idx: number = state.fileCursor,
): number {
  const e = state.files[idx];
  if (!e) return state.selected.size;
  if (state.selected.has(e.absPath)) state.selected.delete(e.absPath);
  else state.selected.add(e.absPath);
  return state.selected.size;
}

export function skillToggleSelectAll(state: SkillViewState): number {
  const all = state.files.map(e => e.absPath);
  if (state.selected.size === all.length && all.every(p => state.selected.has(p))) {
    state.selected.clear();
  } else {
    state.selected = new Set(all);
  }
  return state.selected.size;
}

export function skillAttachTargets(state: SkillViewState): string[] {
  if (state.selected.size > 0) return [...state.selected];
  const e = state.files[state.fileCursor];
  return e ? [e.absPath] : [];
}
