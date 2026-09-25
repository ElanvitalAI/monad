// Arc G follow-up — related-test path heuristic + spawn runner.
//
// Goal: after an Edit/Write succeeds its tsc check, optionally spawn
// `bun test <matched paths>` so simple regressions surface inside the
// same turn instead of the next user interaction.
//
// Design notes:
//   • `deriveTestPaths(filePath, cwd)` is a pure function (existsSync
//     filter aside) — easy to unit-test without spawning anything.
//   • `runRelatedTests(paths, cwd, timeoutMs)` spawns `bun test`
//     against the matched files and scrapes the tail summary /
//     `(fail)` lines. No test framework coupling beyond bun-test's
//     printable format.
//
// PLAN: 내부 문서 `PLAN-harness-arc-g-follow-up` §6

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join as joinPath, relative, resolve as resolvePath } from 'node:path';

export interface TestRunSummary {
  ran: string[];
  failureCount: number;
  sampleFailures: string[];
  timedOut: boolean;
  spawnError?: string;
}

/** Derive candidate test paths for a given edited file. Paths are
 *  relative to `cwd` and filtered to those that exist on disk — so the
 *  caller can trust the list as "these are files bun test can run".
 *  Returns `[]` when the edited file is outside `src/` + `test/` (docs,
 *  scripts, scratch, absolute paths outside cwd). */
export function deriveTestPaths(filePath: string, cwd: string): string[] {
  if (!filePath) return [];

  // Normalise to cwd-relative. Paths outside cwd return '' / '..'
  // prefixed strings and are rejected below.
  const rel = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
  if (!rel || rel.startsWith('..')) return [];

  const candidates: string[] = [];

  // Identity: editing a test file → run that file.
  if (rel.startsWith('test/') && /\.(test|spec)\.ts$/.test(rel)) {
    candidates.push(rel);
  } else if (rel.startsWith('src/') && rel.endsWith('.ts')) {
    const suffix = rel.replace(/^src\//, '').replace(/\.ts$/, '.test.ts');
    // Mirror hierarchy: src/foo/bar.ts → test/foo/bar.test.ts
    candidates.push(joinPath('test', suffix));
    // Dash-flattened: test/foo-bar.test.ts
    if (suffix.includes('/')) {
      const dashed = suffix.replace(/\//g, '-');
      candidates.push(joinPath('test', dashed));
    }
    // Flat basename: test/bar.test.ts
    const flat = basename(rel).replace(/\.ts$/, '.test.ts');
    candidates.push(joinPath('test', flat));
  }

  // Dedupe and keep only paths that exist on disk.
  return [...new Set(candidates)].filter(p => existsSync(resolvePath(cwd, p)));
}

/** Spawn `bun test` against the given paths with a hard timeout. The
 *  verifier treats failures as `warn` issues — this helper only shapes
 *  the spawn result. Never throws; timeout / spawn errors surface via
 *  the returned struct. */
export async function runRelatedTests(
  paths: string[],
  cwd: string,
  timeoutMs: number,
): Promise<TestRunSummary> {
  if (paths.length === 0) {
    return { ran: [], failureCount: 0, sampleFailures: [], timedOut: false };
  }

  return new Promise((resolve) => {
    let killed = false;
    let child: ChildProcess;
    try {
      child = spawn('bun', ['test', ...paths], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        ran: paths,
        failureCount: 0,
        sampleFailures: [],
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => chunks.push(c));
    child.stderr?.on('data', (c: Buffer) => chunks.push(c));

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ran: paths,
        failureCount: 0,
        sampleFailures: [],
        timedOut: false,
        spawnError: err.message,
      });
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (killed) {
        resolve({ ran: paths, failureCount: 0, sampleFailures: [], timedOut: true });
        return;
      }
      const out = Buffer.concat(chunks).toString('utf8');
      const failLines = out.split('\n').filter(line => /^\(fail\)/.test(line));
      // bun test prints e.g. "  12466 pass\n  76 fail\n" — prefer the
      // numeric summary when present; fall back to the per-test count.
      const sumMatch = out.match(/(\d+)\s+fail\b/);
      const summaryFailures = sumMatch ? Number.parseInt(sumMatch[1]!, 10) : failLines.length;
      resolve({
        ran: paths,
        failureCount: Number.isFinite(summaryFailures) ? summaryFailures : failLines.length,
        sampleFailures: failLines.slice(0, 5),
        timedOut: false,
      });
    });
  });
}
