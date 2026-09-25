// ── File index — nucleo-style fuzzy matcher + git ls-files loader ──
//
// Scorer ported from Claude Code's pure-TS port of nucleo
// (helix-editor/nucleo, fzf-v2-compatible bonuses). The original sits at
// `claude-code-fork/src/native-ts/file-index/index.ts`; this file keeps
// the algorithm and constants 1:1 so future upstream tweaks can be
// re-merged without re-deriving. Added on top:
//
//   - `loadFromGit(cwd)` — git ls-files (tracked + untracked non-ignored)
//     with ripgrep / walk fallback for non-git dirs
//   - `FileIndexCache` — mtime-watched snapshot with 5s floor for
//     untracked refresh. Drop-in for dashboard onAtCandidates.
//
// Scoring is lower = better (position-normalized), matching Claude
// Code's semantics so a future swap to the upstream implementation
// (or the Rust NAPI module) is a straight rename.

import { statSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { runGitCommand } from './git-fs/runner.js';

export type SearchResult = {
  path: string;
  score: number;
};

// nucleo-style scoring constants (approximating fzf-v2 / nucleo bonuses)
const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 8;
const BONUS_CAMEL = 6;
const BONUS_CONSECUTIVE = 4;
const BONUS_FIRST_CHAR = 8;
const PENALTY_GAP_START = 3;
const PENALTY_GAP_EXTENSION = 1;

const TOP_LEVEL_CACHE_LIMIT = 100;
const MAX_QUERY_LEN = 64;
// Per-path cap on re-anchor attempts in the scoring loop. Pure
// greedy-earliest (Claude Code's port) loses boundary-aligned matches
// when the first needle char repeats before the real hit. We try each
// occurrence as an anchor, capped so pathological cases (e.g. query "e"
// against 200-char path) don't blow up search time. 8 is enough to
// beat every real-world boundary-vs-mid-word case the port misses.
const MAX_ANCHORS = 8;
// Yield to event loop after this many ms of sync work. Chunk sizes are
// time-based (not count-based) so slow machines get smaller chunks and
// stay responsive.
const CHUNK_MS = 4;

// Reusable buffer: records where each needle char matched during the indexOf scan
const posBuf = new Int32Array(MAX_QUERY_LEN);

export class FileIndex {
  private paths: string[] = [];
  private lowerPaths: string[] = [];
  private charBits: Int32Array = new Int32Array(0);
  private pathLens: Uint16Array = new Uint16Array(0);
  private topLevelCache: SearchResult[] | null = null;
  // During async build, tracks how many paths have bitmap/lowerPath filled.
  // search() uses this to search the ready prefix while build continues.
  private readyCount = 0;

  /** Load + dedup + index in one sync pass. Use for small lists or
   *  tests. Large lists should prefer `loadFromFileListAsync`. */
  loadFromFileList(fileList: string[]): void {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const line of fileList) {
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line);
        paths.push(line);
      }
    }
    this.buildIndex(paths);
  }

  /** Progressive build: yields every ~CHUNK_MS ms. Returns two promises:
   *   - `queryable`: resolves after the first chunk so search() returns
   *     partial results while the rest streams in.
   *   - `done`: resolves when the full index is built. */
  loadFromFileListAsync(fileList: string[]): {
    queryable: Promise<void>;
    done: Promise<void>;
  } {
    let markQueryable: () => void = () => {};
    const queryable = new Promise<void>((resolve) => {
      markQueryable = resolve;
    });
    const done = this.buildAsync(fileList, markQueryable);
    return { queryable, done };
  }

  /** How many entries the index currently holds. Useful for tests + the
   *  "Indexing…" placeholder in UI while async build is in-flight. */
  size(): number {
    return this.readyCount;
  }

  /** Primary entry point. Returns up to `limit` results sorted best-first
   *  (score ascending in the SearchResult, where 0.0 = best). Smart case:
   *  all-lowercase query = case-insensitive, any uppercase = exact case. */
  search(query: string, limit: number): SearchResult[] {
    if (limit <= 0) return [];
    if (query.length === 0) {
      if (this.topLevelCache) return this.topLevelCache.slice(0, limit);
      return [];
    }

    const caseSensitive = query !== query.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const nLen = Math.min(needle.length, MAX_QUERY_LEN);
    const needleChars: string[] = new Array(nLen);
    let needleBitmap = 0;
    for (let j = 0; j < nLen; j++) {
      const ch = needle.charAt(j);
      needleChars[j] = ch;
      const cc = ch.charCodeAt(0);
      if (cc >= 97 && cc <= 122) needleBitmap |= 1 << (cc - 97);
    }

    // Upper bound on score assuming every match gets the max boundary bonus.
    // Lets us skip the boundary pass for paths whose gap penalty alone
    // puts them below the current top-k threshold.
    const scoreCeiling =
      nLen * (SCORE_MATCH + BONUS_BOUNDARY) + BONUS_FIRST_CHAR + 32;

    const topK: { path: string; fuzzScore: number }[] = [];
    let threshold = -Infinity;

    const { paths, lowerPaths, charBits, pathLens, readyCount } = this;

    outer: for (let i = 0; i < readyCount; i++) {
      // O(1) bitmap reject: path must contain every letter in the needle
      if ((charBits[i]! & needleBitmap) !== needleBitmap) continue;

      const haystack = caseSensitive ? paths[i]! : lowerPaths[i]!;
      const path = paths[i]!;
      const hLen = pathLens[i]!;

      // Multi-anchor scoring: pure greedy-earliest loses cases like
      // needle="chat" against "src/chat.ts" because it locks onto the
      // 'c' in "src" (no boundary bonus + gap penalty) instead of the
      // stronger match at "/chat". Try each occurrence of the first
      // needle char in the haystack as an anchor, score the greedy
      // tail from there, keep the best. Anchors are capped so worst
      // case stays bounded on pathological single-char queries.
      let bestScore = -Infinity;
      let bestFirstPos = -1;
      let anchors = 0;
      const needle0 = needleChars[0]!;
      const hStart = caseSensitive ? path : haystack;
      for (
        let anchor = hStart.indexOf(needle0);
        anchor !== -1 && anchors < MAX_ANCHORS;
        anchor = hStart.indexOf(needle0, anchor + 1), anchors++
      ) {
        posBuf[0] = anchor;
        let gapPenalty = 0;
        let consecBonus = 0;
        let prev = anchor;
        let ok = true;
        for (let j = 1; j < nLen; j++) {
          const p = haystack.indexOf(needleChars[j]!, prev + 1);
          if (p === -1) { ok = false; break; }
          posBuf[j] = p;
          const gap = p - prev - 1;
          if (gap === 0) consecBonus += BONUS_CONSECUTIVE;
          else gapPenalty += PENALTY_GAP_START + gap * PENALTY_GAP_EXTENSION;
          prev = p;
        }
        if (!ok) continue;
        let score = nLen * SCORE_MATCH + consecBonus - gapPenalty;
        score += scoreBonusAt(path, anchor, true);
        for (let j = 1; j < nLen; j++) {
          score += scoreBonusAt(path, posBuf[j]!, false);
        }
        if (score > bestScore) {
          bestScore = score;
          bestFirstPos = anchor;
        }
      }
      if (bestFirstPos === -1) continue;

      if (
        topK.length === limit &&
        bestScore + 32 <= threshold
      ) {
        continue;
      }

      const score = bestScore + Math.max(0, 32 - (hLen >> 2));

      if (topK.length < limit) {
        topK.push({ path, fuzzScore: score });
        if (topK.length === limit) {
          topK.sort((a, b) => a.fuzzScore - b.fuzzScore);
          threshold = topK[0]!.fuzzScore;
        }
      } else if (score > threshold) {
        let lo = 0;
        let hi = topK.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (topK[mid]!.fuzzScore < score) lo = mid + 1;
          else hi = mid;
        }
        topK.splice(lo, 0, { path, fuzzScore: score });
        topK.shift();
        threshold = topK[0]!.fuzzScore;
      }
    }

    topK.sort((a, b) => b.fuzzScore - a.fuzzScore);

    const matchCount = topK.length;
    const denom = Math.max(matchCount, 1);
    const results: SearchResult[] = new Array(matchCount);
    for (let i = 0; i < matchCount; i++) {
      const path = topK[i]!.path;
      const positionScore = i / denom;
      const finalScore = path.includes('test')
        ? Math.min(positionScore * 1.05, 1.0)
        : positionScore;
      results[i] = { path, score: finalScore };
    }
    return results;
  }

  private async buildAsync(
    fileList: string[],
    markQueryable: () => void,
  ): Promise<void> {
    const seen = new Set<string>();
    const paths: string[] = [];
    let chunkStart = performance.now();
    for (let i = 0; i < fileList.length; i++) {
      const line = fileList[i]!;
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line);
        paths.push(line);
      }
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        await yieldToEventLoop();
        chunkStart = performance.now();
      }
    }

    this.resetArrays(paths);

    chunkStart = performance.now();
    let firstChunk = true;
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i);
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        this.readyCount = i + 1;
        if (firstChunk) {
          markQueryable();
          firstChunk = false;
        }
        await yieldToEventLoop();
        chunkStart = performance.now();
      }
    }
    this.readyCount = paths.length;
    markQueryable();
  }

  private buildIndex(paths: string[]): void {
    this.resetArrays(paths);
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i);
    }
    this.readyCount = paths.length;
  }

  private resetArrays(paths: string[]): void {
    const n = paths.length;
    this.paths = paths;
    this.lowerPaths = new Array(n);
    this.charBits = new Int32Array(n);
    this.pathLens = new Uint16Array(n);
    this.readyCount = 0;
    this.topLevelCache = computeTopLevelEntries(paths, TOP_LEVEL_CACHE_LIMIT);
  }

  private indexPath(i: number): void {
    const lp = this.paths[i]!.toLowerCase();
    this.lowerPaths[i] = lp;
    const len = lp.length;
    this.pathLens[i] = len;
    let bits = 0;
    for (let j = 0; j < len; j++) {
      const c = lp.charCodeAt(j);
      if (c >= 97 && c <= 122) bits |= 1 << (c - 97);
    }
    this.charBits[i] = bits;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function scoreBonusAt(path: string, pos: number, first: boolean): number {
  if (pos === 0) return first ? BONUS_FIRST_CHAR : 0;
  const prevCh = path.charCodeAt(pos - 1);
  if (isBoundary(prevCh)) return BONUS_BOUNDARY;
  if (isLower(prevCh) && isUpper(path.charCodeAt(pos))) return BONUS_CAMEL;
  return 0;
}

function isBoundary(code: number): boolean {
  // / \ - _ . space
  return (
    code === 47 || // /
    code === 92 || // \
    code === 45 || // -
    code === 95 || // _
    code === 46 || // .
    code === 32
  );
}

function isLower(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Top-level segments, sorted short→long then alpha. Used as the
 *  empty-query default so `@` alone still shows something useful. */
function computeTopLevelEntries(paths: string[], limit: number): SearchResult[] {
  const topLevel = new Set<string>();
  for (const p of paths) {
    let end = p.length;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c === 47 || c === 92) {
        end = i;
        break;
      }
    }
    const segment = p.slice(0, end);
    if (segment.length > 0) {
      topLevel.add(segment);
      if (topLevel.size >= limit) break;
    }
  }
  const sorted = Array.from(topLevel);
  sorted.sort((a, b) => {
    const lenDiff = a.length - b.length;
    if (lenDiff !== 0) return lenDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted.slice(0, limit).map((path) => ({ path, score: 0.0 }));
}

// ── Loader: git ls-files + untracked merge + walk fallback ────────

const GIT_LS_TIMEOUT_MS = 3000;
/** Hard cap on walk-fallback results — one chat session shouldn't
 *  stall opening a picker in a node_modules-sized tree. git repos
 *  don't hit this (ls-files is O(tracked) and fast). */
const WALK_HARD_CAP = 50_000;

const WALK_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.cache',
  '.vscode',
  '.idea',
  '.DS_Store',
  'target',      // Rust
  '__pycache__',
  '.venv',
  'venv',
]);

export interface LoadedFileList {
  paths: string[];
  source: 'git' | 'walk' | 'git-only';
  gitIndexMtimeMs: number | null;
}

/** Load file list rooted at `cwd`. Tries `git ls-files` first (fast,
 *  gitignore-aware). Falls back to a depth-limited directory walk when
 *  the dir isn't a git checkout. Paths are relative to `cwd` with
 *  POSIX separators (so the index and the UI share one normalization). */
export function loadFileList(cwd: string): LoadedFileList {
  const tracked = runGit(['ls-files', '-z'], cwd);
  if (tracked !== null) {
    const untracked = runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      cwd,
    ) ?? '';
    const paths: string[] = [];
    const seen = new Set<string>();
    appendNulSeparated(tracked, paths, seen);
    appendNulSeparated(untracked, paths, seen);
    return {
      paths,
      source: untracked.length > 0 ? 'git' : 'git-only',
      gitIndexMtimeMs: gitIndexMtime(cwd),
    };
  }
  // Non-git: depth-limited walk with skip-dirs.
  const paths = walkSync(cwd, WALK_HARD_CAP);
  return { paths, source: 'walk', gitIndexMtimeMs: null };
}

function runGit(args: string[], cwd: string): string | null {
  try {
    const result = runGitCommand(cwd, args, {
      timeout: GIT_LS_TIMEOUT_MS,
      encoding: 'utf8',
      // Discard stderr — `not a git repo` is an expected fall-through,
      // the stdout value (empty + non-zero status) tells us everything.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0) return null;
    return result.stdout;
  } catch {
    return null;
  }
}

function appendNulSeparated(
  raw: string,
  out: string[],
  seen: Set<string>,
): void {
  if (!raw) return;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 0) {
      if (i > start) {
        const p = raw.slice(start, i);
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
      start = i + 1;
    }
  }
  if (start < raw.length) {
    const p = raw.slice(start);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
}

function gitIndexMtime(cwd: string): number | null {
  try {
    const s = statSync(join(cwd, '.git', 'index'));
    return Math.floor(s.mtimeMs);
  } catch {
    return null;
  }
}

/** Simple BFS-ish walk. Returns POSIX-relative paths, skipping common
 *  build/dep directories and anything starting with `.`. Capped at
 *  `hardCap` entries so a gigantic tree doesn't stall the first search. */
function walkSync(root: string, hardCap: number): string[] {
  const out: string[] = [];
  const stack: string[] = ['.'];
  while (stack.length > 0 && out.length < hardCap) {
    const rel = stack.pop()!;
    const abs = rel === '.' ? root : join(root, rel);
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (WALK_SKIP_DIRS.has(name)) continue;
      const childRel = rel === '.' ? name : rel + '/' + name;
      const childAbs = join(abs, name);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(childRel);
      } else if (st.isFile()) {
        out.push(childRel);
        if (out.length >= hardCap) break;
      }
    }
  }
  return out;
}

// ── FileIndexCache: stateful snapshot with mtime watch + 5s floor ──

export interface FileIndexCacheOpts {
  /** Working directory root. Paths in the index are relative to this. */
  cwd: string;
  /** Seconds to wait after a successful refresh before another full
   *  reload (unless git index mtime changes). Default 5s. */
  refreshFloorMs?: number;
  /** Override for tests. */
  now?: () => number;
}

const DEFAULT_REFRESH_FLOOR_MS = 5000;

/** Snapshot-caching wrapper around FileIndex. Safe to construct eagerly
 *  at startup; `maybeRefresh()` is cheap (one stat call when git-backed,
 *  one monotonic time check otherwise) and is the intended entry point
 *  before each search. */
export class FileIndexCache {
  private readonly cwd: string;
  private readonly refreshFloorMs: number;
  private readonly now: () => number;
  private index = new FileIndex();
  private lastLoadedAt = 0;
  private lastGitIndexMtime: number | null = null;
  private lastSource: LoadedFileList['source'] | 'empty' = 'empty';

  constructor(opts: FileIndexCacheOpts) {
    this.cwd = opts.cwd;
    this.refreshFloorMs = opts.refreshFloorMs ?? DEFAULT_REFRESH_FLOOR_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Reload when either: (a) git `.git/index` mtime moved (tracked
   *  changed), or (b) refreshFloorMs elapsed since the last reload
   *  (catches untracked file adds). Sync for now — loadFileList is
   *  O(ls-files) which is single-digit ms on most repos. */
  maybeRefresh(): void {
    const now = this.now();
    const gitMtime = gitIndexMtime(this.cwd);

    // First load or explicit miss.
    if (this.lastSource === 'empty') {
      this.reload();
      return;
    }

    // git index moved → tracked file set changed. Reload.
    if (gitMtime !== null && gitMtime !== this.lastGitIndexMtime) {
      this.reload();
      return;
    }

    // Floor elapsed → pick up untracked file adds.
    if (now - this.lastLoadedAt >= this.refreshFloorMs) {
      this.reload();
      return;
    }
  }

  /** Unconditional reload. Exposed for `/file-index reload` slash + tests. */
  reload(): void {
    const loaded = loadFileList(this.cwd);
    this.index.loadFromFileList(loaded.paths);
    this.lastLoadedAt = this.now();
    this.lastGitIndexMtime = loaded.gitIndexMtimeMs;
    this.lastSource = loaded.source;
  }

  search(query: string, limit: number): SearchResult[] {
    return this.index.search(query, limit);
  }

  size(): number {
    return this.index.size();
  }

  status(): { source: string; count: number; gitIndexMtimeMs: number | null; lastLoadedAt: number } {
    return {
      source: this.lastSource,
      count: this.index.size(),
      gitIndexMtimeMs: this.lastGitIndexMtime,
      lastLoadedAt: this.lastLoadedAt,
    };
  }
}

/** Convert a POSIX-relative path back to the absolute form the host
 *  needs for attachment tokenization. Kept as a helper so the dashboard
 *  doesn't need to know about path internals. */
export function absolutize(relPath: string, cwd: string): string {
  return join(cwd, relPath.split('/').join(sep));
}

/** Compute the relative path for display. Mirrors what the index stores
 *  so highlight positions line up. */
export function relativize(absPath: string, cwd: string): string {
  return relative(cwd, absPath).split(sep).join('/');
}
