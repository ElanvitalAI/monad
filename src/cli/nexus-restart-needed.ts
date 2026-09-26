// `elanous nexus restart-needed` — R0 of 내부 문서 `RFC-nexus-restart-minimization-2026-09-24`.
// Read-only: classifies the path diff between the running daemon's commit and
// the commit about to be installed. Never restarts the daemon and never builds.

import {
  runNexusShow,
  defaultProbeHealth,
  joinRestHealthUrl,
  resolveRevisionFreshness,
  type NexusHealthProbeResult,
} from './nexus-show.js';
import { runGitCommand, type GitCommandRunner } from '../git-fs/runner.js';
import type { GitRunResult } from '../git-fs/retry.js';

export type RestartNeededVerdict = 'none' | 'build' | 'restart';

export const RESTART_NEEDED_EXIT: Record<RestartNeededVerdict, number> = {
  none: 0,
  build: 10,
  restart: 11,
};

export const RESTART_NEEDED_UNKNOWN_EXIT = 2;

const RESTART_PATH_LIMIT = 20;

export interface RestartNeededOpts {
  /** Commit the new code would land at. Default: current checkout HEAD. */
  to?: string;
  format?: 'human' | 'json';
  cwd?: string;
  /** Test seam — probe daemon health at the already-joined URL. */
  healthFn?: (url: string) => Promise<NexusHealthProbeResult | null | undefined>;
  /** Test seam — local-only Git commands. */
  gitFn?: GitCommandRunner;
  /** Test seam — resolve the REST base the health probe is joined onto. */
  restBaseFn?: (cwd: string) => Promise<string | undefined>;
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface RestartNeededResult {
  exitCode: number;
  verdict?: RestartNeededVerdict;
  /** Daemon SHA when health answered. `null` when it never did. */
  from?: string | null;
  /** Resolved `--to` or HEAD. `null` when that commit was never resolved. */
  to?: string | null;
  /** Changed-path count. `null` when the diff never ran. */
  pathCount?: number | null;
  /** Paths that forced `restart`, capped at 20. */
  restartPaths?: readonly string[];
  /** How many restart paths were not listed. */
  more?: number;
  /** Why the verdict is unknown (exit 2). Never folded into `none`. */
  reason?: string;
}

function successfulOutput(result: GitRunResult): string | undefined {
  const output = result.status === 0 ? result.stdout.trim() : '';
  return output || undefined;
}

/**
 * `git diff -z --name-only` records each path as raw bytes terminated by NUL.
 * Default `--name-only` C-quotes non-ASCII names (`"apps/pwa/src/\\355...tsx"`),
 * which would mis-classify a PWA-only Korean path as `restart`.
 */
export function parseNulPaths(stdout: string): string[] {
  // A leading or trailing space is part of the filename. Only the NUL
  // separator is discarded — trimming would turn ` 내부 문서 `a`` into
  // `내부 문서 `a`` and report `none` where the verdict is `restart`.
  return stdout.split('\0').filter((line) => line.length > 0);
}

/** `apps/pwa/**` — static files the daemon reads per request. */
export function isPwaPath(path: string): boolean {
  return path === 'apps/pwa' || path.startsWith('apps/pwa/');
}

/** Docs and tests: `docs/**` · `*.md` · `test/**` · `*.test.ts`. */
export function isDocsOrTestPath(path: string): boolean {
  if (path === 'docs' || path.startsWith('docs/')) return true;
  if (path === 'test' || path.startsWith('test/')) return true;
  if (path.endsWith('.md')) return true;
  if (path.endsWith('.test.ts')) return true;
  return false;
}

export function classifyChangedPaths(paths: readonly string[]): RestartNeededVerdict {
  if (paths.length === 0) return 'none';
  let sawPwa = false;
  let sawDocs = false;
  for (const path of paths) {
    if (isPwaPath(path)) {
      sawPwa = true;
      continue;
    }
    if (isDocsOrTestPath(path)) {
      sawDocs = true;
      continue;
    }
    return 'restart';
  }
  if (sawPwa) return 'build';
  void sawDocs;
  return 'none';
}

function restartCausingPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => !isPwaPath(path) && !isDocsOrTestPath(path));
}

async function defaultRestBase(cwd: string): Promise<string | undefined> {
  const captured: string[] = [];
  const result = await runNexusShow({
    format: 'json',
    cwd,
    out: { log: (s) => captured.push(s), error: (s) => captured.push(s) },
  });
  if (!result.urls?.rest.loopback) return undefined;
  return result.urls.rest.loopback;
}

export async function decideRestartNeeded(opts: RestartNeededOpts = {}): Promise<RestartNeededResult> {
  const cwd = opts.cwd ?? process.cwd();
  const out = opts.out ?? console;
  const format = opts.format ?? 'human';
  const git: GitCommandRunner = opts.gitFn ?? runGitCommand;
  const gitOpts = { env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } };

  // Known evidence stays. A later git failure must not drop a daemon SHA or
  // a `--to` already resolved. Unknown fields stay `null`, never omitted.
  const known: { from: string | null; to: string | null; pathCount: number | null } = {
    from: null,
    to: null,
    pathCount: null,
  };
  const fail = (reason: string): RestartNeededResult => {
    const body = {
      verdict: 'unknown' as const,
      reason,
      from: known.from,
      to: known.to,
      pathCount: known.pathCount,
    };
    if (format === 'json') {
      out.log(JSON.stringify(body, null, 2));
    } else {
      out.error(`elanous nexus restart-needed — unknown: ${reason}`);
      out.error(`from      ${known.from ?? 'null'}`);
      out.error(`to        ${known.to ?? 'null'}`);
      out.error(`paths     ${known.pathCount ?? 'null'}`);
    }
    return {
      exitCode: RESTART_NEEDED_UNKNOWN_EXIT,
      reason,
      from: known.from,
      to: known.to,
      pathCount: known.pathCount,
    };
  };

  let restBase: string | undefined;
  try {
    restBase = await (opts.restBaseFn ?? defaultRestBase)(cwd);
  } catch {
    return fail('데몬 무응답');
  }
  if (!restBase) return fail('데몬 무응답');

  const healthUrl = joinRestHealthUrl(restBase);
  let health: NexusHealthProbeResult | null | undefined;
  try {
    health = await (opts.healthFn ?? defaultProbeHealth)(healthUrl);
  } catch {
    return fail('데몬 무응답');
  }
  if (health == null) return fail('데몬 무응답');
  const from = typeof health.daemonSha === 'string' ? health.daemonSha.trim() : '';
  if (!from) return fail('데몬 무응답');
  known.from = from;

  // A present `--to`, even whitespace-only, was specified. Do not fall
  // through to HEAD — a commit that cannot be found is exit 2.
  const toSpecified = opts.to !== undefined;
  let to = opts.to?.trim() ?? '';
  if (toSpecified && !to) return fail('커밋을 로컬에서 못 찾음: (empty)');
  if (!to) {
    let head: GitRunResult;
    try {
      head = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], gitOpts);
    } catch {
      return fail('git 실패');
    }
    if (head.status !== 0) return fail('git 실패');
    to = successfulOutput(head) ?? '';
    if (!to) return fail('git 실패');
  }
  known.to = to;

  // Commit presence is `resolveRevisionFreshness` (rev-parse `${ref}^{commit}`
  // on the injected runner). Its origin/HEAD half is not this decision — a
  // missing tracking ref must not become "unknown".
  const missing = (ref: string): RestartNeededResult => fail(`커밋을 로컬에서 못 찾음: ${ref}`);
  for (const ref of [from, to]) {
    let freshness: ReturnType<typeof resolveRevisionFreshness>;
    try {
      freshness = resolveRevisionFreshness(cwd, ref, git);
    } catch {
      return fail('git 실패');
    }
    if (freshness.status === 'daemon-commit-missing') return missing(ref);
    if (freshness.status === 'unmeasurable') return fail('git 실패');
  }

  let diff: GitRunResult;
  try {
    diff = git(cwd, ['diff', '-z', '--name-only', `${from}..${to}`], gitOpts);
  } catch {
    return fail('git 실패');
  }
  if (diff.status !== 0) return fail('git 실패');
  const paths = parseNulPaths(diff.stdout);

  const verdict = classifyChangedPaths(paths);
  const causing = verdict === 'restart' ? restartCausingPaths(paths) : [];
  const shown = causing.slice(0, RESTART_PATH_LIMIT);
  const more = Math.max(0, causing.length - shown.length);
  const result: RestartNeededResult = {
    exitCode: RESTART_NEEDED_EXIT[verdict],
    verdict,
    from,
    to,
    pathCount: paths.length,
    ...(shown.length > 0 ? { restartPaths: shown } : {}),
    ...(more > 0 ? { more } : {}),
  };

  if (format === 'json') {
    out.log(JSON.stringify({
      verdict,
      from,
      to,
      pathCount: paths.length,
      ...(shown.length > 0 ? { restartPaths: shown } : {}),
      ...(more > 0 ? { more } : {}),
    }, null, 2));
  } else {
    out.log(`verdict   ${verdict}`);
    out.log(`from      ${from}`);
    out.log(`to        ${to}`);
    out.log(`paths     ${paths.length}`);
    if (verdict === 'restart') {
      for (const path of shown) out.log(`  ${path}`);
      if (more > 0) out.log(`  ${more}개 더`);
    }
  }
  return result;
}
