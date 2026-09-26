#!/usr/bin/env bun
/** Import a public PR patch without fetching, committing, or publishing it. */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { loadExportConfig, selectExportFiles, transformExportFiles } from './public-export.js';

export type ImportKind = 'clean' | 'renamed' | 'transformed' | 'outside-export';
export interface ImportFile { publicPath: string; sourcePath?: string; kind: ImportKind; reason?: string }
export interface ImportResult { files: ImportFile[]; rc: number; message?: string }

function safePath(path: string): boolean {
  return path !== '' && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..') && !path.startsWith('-');
}

interface PatchFile { publicPath: string; text: string; error?: string }
/** Consume each hunk completely; no second (non-git) unified diff may follow it. */
function singleFileHunks(text: string, publicPath: string): boolean {
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  const oldIndex = lines.findIndex((line) => line.startsWith('--- '));
  if (oldIndex < 1 || lines[oldIndex] !== `--- a/${publicPath}` && lines[oldIndex] !== '--- /dev/null' ||
      lines[oldIndex + 1] !== `+++ b/${publicPath}` && lines[oldIndex + 1] !== '+++ /dev/null') return false;
  if (lines.slice(1, oldIndex).some((line) => !/^(?:index |new file mode 100644$|deleted file mode 100644$)/.test(line))) return false;
  let i = oldIndex + 2;
  if (i === lines.length) return false;
  while (i < lines.length) {
    const header = /^@@ -(?:\d+)(?:,(\d+))? \+(?:\d+)(?:,(\d+))? @@/.exec(lines[i++]!);
    if (!header) return false;
    let before = header[1] === undefined ? 1 : Number(header[1]);
    let after = header[2] === undefined ? 1 : Number(header[2]);
    while (before || after) {
      const line = lines[i++];
      if (line === undefined) return false;
      if (line.startsWith(' ')) { before--; after--; }
      else if (line.startsWith('-')) before--;
      else if (line.startsWith('+')) after--;
      else return false;
      if (before < 0 || after < 0) return false;
      if (lines[i]?.startsWith('\\ No newline at end of file')) i++;
    }
  }
  return true;
}
function splitPatch(patch: string): PatchFile[] {
  const starts = [...patch.matchAll(/^diff --git /gm)].map((match) => match.index);
  if (!starts.length || patch.slice(0, starts[0]!).trim()) throw new Error('expected git unified diff (diff --git)');
  const blocks = starts.map((start, i) => patch.slice(start, starts[i + 1] ?? patch.length));
  const files: PatchFile[] = [];
  for (const text of blocks) {
    const header = /^diff --git a\/([^\n]+) b\/([^\n]+)\n/.exec(text);
    if (!header) throw new Error('unsupported or quoted diff path');
    const publicPath = header[2]!;
    let error: string | undefined;
    if (!safePath(header[1]!) || !safePath(publicPath) || header[1] !== publicPath) error = 'unsafe path or cross-file rename';
    else if (/^(?:GIT binary patch|Binary files |rename (?:from|to) |copy (?:from|to) |old mode |new mode |similarity index |dissimilarity index |index [^\n]* 160000|new file mode (?!100644$)|deleted file mode (?!100644$))/m.test(text)) error = 'binary, mode, submodule, or rename patch unsupported';
    else if (!/^@@ /m.test(text) || !/^--- (?:a\/[^\n]+|\/dev\/null)$/m.test(text) || !/^\+\+\+ (?:b\/[^\n]+|\/dev\/null)$/m.test(text)) error = 'missing unified text hunks';
    else {
      const old = /^--- ([^\n]+)$/m.exec(text)?.[1];
      const next = /^\+\+\+ ([^\n]+)$/m.exec(text)?.[1];
      if ((old !== `a/${publicPath}` && old !== '/dev/null') || (next !== `b/${publicPath}` && next !== '/dev/null') || !singleFileHunks(text, publicPath)) error = 'patch contains invalid or additional file diff';
    }
    files.push({ publicPath, text, error });
  }
  if (!files.length) throw new Error('empty patch');
  return files;
}

function safeDestination(root: string, path: string): boolean {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return true;
}

function gitApply(root: string, patch: string, check = false): string | undefined {
  const result = spawnSync('git', ['apply', ...(check ? ['--check'] : []), '--', '-'], { cwd: root, input: patch, encoding: 'utf8' });
  return result.status === 0 ? undefined : (result.stderr || result.error?.message || 'git apply failed').trim();
}

function trackedFiles(root: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

/** Classify against the real export, stage eligible edits, then write only on --apply. */
export function importPublicPatch(patch: string, root: string, apply = false, author?: string, writeTarget = writeFileSync): ImportResult {
  const config = loadExportConfig(root);
  const tracked = trackedFiles(root);
  const pieces = splitPatch(patch);
  const selected = new Set(selectExportFiles([...tracked, ...pieces.map((p) => p.publicPath)], config));
  const staging = mkdtempSync(join(tmpdir(), 'public-import-'));
  const files: ImportFile[] = [];
  const eligible: string[] = [];
  const originals = new Map<string, string | undefined>();
  try {
    for (const piece of pieces) {
      const { publicPath } = piece;
      const sourcePath = config.replace[publicPath] ?? publicPath;
      const entry: ImportFile = { publicPath, sourcePath, kind: config.replace[publicPath] ? 'renamed' : 'clean' };
      files.push(entry);
      if (piece.error) { entry.kind = 'outside-export'; entry.reason = piece.error; continue; }
      if (!config.replace[publicPath] && !selected.has(publicPath)) {
        entry.kind = 'outside-export'; entry.reason = 'not present in public export'; continue;
      }
      if (!safePath(sourcePath) || !safeDestination(root, sourcePath) || files.slice(0, -1).some((prev) => prev.sourcePath === sourcePath)) {
        entry.kind = 'outside-export'; entry.reason = 'unsafe or duplicate source path'; continue;
      }
      const source = join(root, sourcePath);
      const original = existsSync(source) ? readFileSync(source, 'utf8') : undefined;
      if (original !== undefined && !tracked.includes(sourcePath)) {
        entry.kind = 'outside-export'; entry.reason = 'untracked source collision'; continue;
      }
      originals.set(sourcePath, original);
      const transformed = (text: string) => transformExportFiles(new Map([[publicPath, text]]), config, [...selected]).contents.get(publicPath)!;
      if (original !== undefined && transformed(original) !== original) {
        entry.kind = 'transformed'; entry.reason = 'export transforms change source text'; continue;
      }
      const oldHeader = /^--- ([^\n]+)$/m.exec(piece.text)?.[1];
      const nextHeader = /^\+\+\+ ([^\n]+)$/m.exec(piece.text)?.[1];
      if ((oldHeader === '/dev/null' && original !== undefined) || (oldHeader !== '/dev/null' && original === undefined) ||
          (nextHeader === '/dev/null' && original === undefined)) {
        entry.reason = 'inapplicable patch: source existence differs from patch'; continue;
      }
      const mapped = piece.text.replace(/^diff --git a\/[^\n]+ b\/[^\n]+/m, `diff --git a/${sourcePath} b/${sourcePath}`)
        .replace(/^--- a\/[^\n]+$/m, `--- a/${sourcePath}`).replace(/^\+\+\+ b\/[^\n]+$/m, `+++ b/${sourcePath}`);
      const stagedPath = join(staging, sourcePath);
      if (original !== undefined) { mkdirSync(dirname(stagedPath), { recursive: true }); writeFileSync(stagedPath, original); }
      const failure = gitApply(staging, mapped, true);
      if (failure) { entry.reason = `inapplicable patch: ${failure}`; continue; }
      const applyFailure = gitApply(staging, mapped);
      if (applyFailure) { entry.reason = `inapplicable patch: ${applyFailure}`; continue; }
      if (existsSync(stagedPath) && transformed(readFileSync(stagedPath, 'utf8')) !== readFileSync(stagedPath, 'utf8')) {
        entry.kind = 'transformed'; entry.reason = 'export transforms change patched text'; continue;
      }
      eligible.push(sourcePath);
    }
    // A rejected patch or a stale hunk is not a successful import, even if other files are eligible.
    const rejected = files.some((f) => f.kind === 'transformed' || f.kind === 'outside-export' || f.reason);
    if (apply && eligible.length) {
      // Recheck every source immediately before writing; do not overwrite concurrent edits.
      const stale = eligible.some((path) => {
        const file = join(root, path);
        return !safeDestination(root, path) || (existsSync(file) ? readFileSync(file, 'utf8') : undefined) !== originals.get(path);
      });
      if (stale) return { files, rc: 1, message: 'source changed during import; nothing written' };
      const written: string[] = [];
      try {
        for (const path of eligible) {
          const target = join(root, path);
          const staged = join(staging, path);
          if (existsSync(staged)) {
            mkdirSync(dirname(target), { recursive: true });
            written.push(path);
            writeTarget(target, readFileSync(staged));
          } else {
            written.push(path);
            unlinkSync(target);
          }
        }
      } catch (error) {
        for (const path of written.reverse()) {
          const old = originals.get(path);
          if (old === undefined) rmSync(join(root, path), { force: true });
          else writeFileSync(join(root, path), old);
        }
        throw error;
      }
    }
    const message = apply && eligible.length ? `Import public PR changes\n\nCo-Authored-By: ${author}` : undefined;
    return { files, rc: apply && rejected ? 1 : 0, ...(message ? { message } : {}) };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** CLI entrypoint: bun scripts/public-import-pr.ts [patch-file] --author 'Name <email>' [--apply]. */
export function run(argv: readonly string[], root = process.cwd(), stdin?: string): number {
  const apply = argv.includes('--apply');
  const authorIndex = argv.indexOf('--author');
  const author = authorIndex >= 0 ? argv[authorIndex + 1] : undefined;
  const positional = argv.filter((arg, i) => !['--apply', '--dry-run'].includes(arg) && i !== authorIndex && i !== authorIndex + 1);
  if (positional.length > 1 || positional.some((arg) => arg.startsWith('-') && arg !== '-') ||
      !author || !/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$/.test(author) || (apply && argv.includes('--dry-run'))) {
    console.error('usage: bun scripts/public-import-pr.ts [patch-file|-] --author "Name <email>" [--dry-run|--apply]');
    return 2;
  }
  try {
    const patch = positional.length && positional[0] !== '-' ? readFileSync(positional[0]!, 'utf8') : stdin ?? readFileSync(0, 'utf8');
    const result = importPublicPatch(patch, root, apply, author);
    for (const file of result.files) console.log(`${file.kind}\t${file.publicPath}\t${file.sourcePath ?? '-'}${file.reason ? `\t${file.reason}` : ''}`);
    if (result.message) console.log(`\nCommit message draft (not committed):\n${result.message}`);
    if (result.rc) console.error('import incomplete: one or more files were not applied');
    return result.rc;
  } catch (error) { console.error(`import failed: ${String(error)}`); return 1; }
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));
