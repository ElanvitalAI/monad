import { createHash } from 'crypto';
import { readFileSync, statSync, readdirSync, lstatSync } from 'fs';
import { join, relative } from 'path';
import { RSYNC_EXCLUDES } from './config.js';
import type { FileTreeEntry, SkillInfo } from './types.js';

// ── Exclude logic (properly handles globs like *.pyc) ──
const EXACT_EXCLUDES = new Set<string>();
const GLOB_EXCLUDES: RegExp[] = [];

for (const pattern of RSYNC_EXCLUDES) {
  const clean = pattern.replace(/\/+$/, ''); // strip trailing slash
  if (clean.includes('*')) {
    // Convert glob to regex: *.pyc → /\.pyc$/
    const re = new RegExp(
      '^' + clean.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    );
    GLOB_EXCLUDES.push(re);
  } else {
    EXACT_EXCLUDES.add(clean);
  }
}

function shouldExclude(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (EXACT_EXCLUDES.has(name)) return true;
  return GLOB_EXCLUDES.some(re => re.test(name));
}

// ── Symlink-safe directory walker ──
const MAX_DEPTH = 32;

function walkDir(dir: string, base: string, entries: FileTreeEntry[], depth = 0): void {
  if (depth > MAX_DEPTH) return; // prevent symlink cycles

  let items: string[];
  try { items = readdirSync(dir).sort(); } catch { return; }

  for (const item of items) {
    if (shouldExclude(item)) continue;

    const fullPath = join(dir, item);

    // Check for symlink loops: use lstat first
    let lstat;
    try { lstat = lstatSync(fullPath); } catch { continue; }

    if (lstat.isSymbolicLink()) {
      // Follow symlink but track depth to avoid cycles
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        walkDir(fullPath, base, entries, depth + 1);
      } else if (stat.isFile()) {
        entries.push({
          path: relative(base, fullPath),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    } else if (lstat.isDirectory()) {
      walkDir(fullPath, base, entries, depth + 1);
    } else if (lstat.isFile()) {
      entries.push({
        path: relative(base, fullPath),
        size: lstat.size,
        mtime: lstat.mtime.toISOString(),
      });
    }
  }
}

export function getFileTree(skillDir: string): FileTreeEntry[] {
  const entries: FileTreeEntry[] = [];
  walkDir(skillDir, skillDir, entries);
  return entries;
}

// ── Hash cache (prevents O(n²) in status checks) ──
const _hashCache = new Map<string, { hash: string; mtime: number }>();

export function hashSkill(skillDir: string): SkillInfo {
  const name = skillDir.split('/').filter(Boolean).pop()!;
  const tree = getFileTree(skillDir);

  // Check cache — use dir mtime as invalidation signal
  let dirMtime = 0;
  try { dirMtime = statSync(skillDir).mtimeMs; } catch { /* skip */ }
  const cached = _hashCache.get(skillDir);
  if (cached && cached.mtime === dirMtime) {
    return {
      name,
      localPath: skillDir,
      hash: cached.hash,
      fileCount: tree.length,
      totalBytes: 0,
      fileTree: tree,
    };
  }

  const hasher = createHash('sha256');
  let totalBytes = 0;

  for (const entry of tree) {
    const fullPath = join(skillDir, entry.path);
    try {
      const content = readFileSync(fullPath);
      hasher.update(entry.path);
      hasher.update(content);
      totalBytes += content.length;
    } catch { /* skip unreadable */ }
  }

  const hash = hasher.digest('hex');
  _hashCache.set(skillDir, { hash, mtime: dirMtime });

  return { name, localPath: skillDir, hash, fileCount: tree.length, totalBytes, fileTree: tree };
}

export function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Clear the in-memory hash cache (useful between sync rounds) */
export function clearHashCache(): void {
  _hashCache.clear();
}
