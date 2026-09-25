import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitCommand, type GitCommandRunner } from '../git-fs/runner.js';
import type { GitRunResult } from '../git-fs/retry.js';
import {
  classifyChangedPaths,
  decideRestartNeeded,
  isDocsOrTestPath,
  isPwaPath,
  parseNulPaths,
  RESTART_NEEDED_EXIT,
  RESTART_NEEDED_UNKNOWN_EXIT,
} from './nexus-restart-needed.js';

const FROM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TO = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function ok(stdout: string): GitRunResult {
  return { status: 0, stdout, stderr: '' };
}

/** Injected runner: rev-parse verifies FROM/TO/HEAD; diff returns the given paths. */
function gitReturning(paths: readonly string[], opts?: { missing?: string; fail?: boolean }): GitCommandRunner {
  return (_cwd, args) => {
    if (opts?.fail) return { status: 128, stdout: '', stderr: 'git failed' };
    const joined = args.join(' ');
    if (joined.startsWith('rev-parse')) {
      const ref = args[args.length - 1] ?? '';
      if (opts?.missing && ref.startsWith(opts.missing)) return { status: 1, stdout: '', stderr: '' };
      if (ref.startsWith('HEAD')) return ok(`${TO}\n`);
      return ok(`${ref.replace(/\^\{commit\}$/, '')}\n`);
    }
    // resolveRevisionFreshness also asks origin/HEAD. Absence is not "unknown".
    if (joined.startsWith('symbolic-ref')) return { status: 1, stdout: '', stderr: '' };
    if (joined.startsWith('rev-list')) return ok('0\n');
    if (joined.startsWith('diff -z --name-only') || joined.startsWith('diff --name-only')) {
      return ok(paths.length ? `${paths.join('\0')}\0` : '');
    }
    return { status: 1, stdout: '', stderr: `unexpected ${joined}` };
  };
}

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: { log: (s: string) => lines.push(s), error: (s: string) => errors.push(s) },
  };
}

describe('classifyChangedPaths', () => {
  test('pwa sources outside apps/pwa/out are still build', () => {
    const paths = ['apps/pwa/src/a.tsx', 'apps/pwa/src/b.tsx'];
    expect(paths.every((p) => !p.startsWith('apps/pwa/out'))).toBe(true);
    expect(classifyChangedPaths(paths)).toBe('build');
  });

  test('a src/llm.ts path forces restart', () => {
    expect(classifyChangedPaths(['apps/pwa/src/a.tsx', 'src/llm.ts'])).toBe('restart');
  });

  test('docs and tests only are none', () => {
    expect(classifyChangedPaths(['docs/RFC.md', 'test/foo.test.ts', 'README.md'])).toBe('none');
  });

  test('empty diff is none', () => {
    expect(classifyChangedPaths([])).toBe('none');
  });

  test('pwa mixed with docs is build', () => {
    expect(classifyChangedPaths(['apps/pwa/src/a.tsx', 'docs/x.md', 'test/y.test.ts'])).toBe('build');
  });

  test('path classes', () => {
    expect(isPwaPath('apps/pwa/src/a.tsx')).toBe(true);
    expect(isPwaPath('apps/pwa-extra/a.ts')).toBe(false);
    expect(isDocsOrTestPath('docs/a.md')).toBe(true);
    expect(isDocsOrTestPath('src/cli/foo.test.ts')).toBe(true);
    expect(isDocsOrTestPath('notes.md')).toBe(true);
    expect(isDocsOrTestPath('src/llm.ts')).toBe(false);
  });
});

describe('decideRestartNeeded', () => {
  const healthOk = async () => ({ daemonSha: FROM });

  test('pwa-only paths → build, exit 10', async () => {
    const cap = capture();
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning(['apps/pwa/src/a.tsx', 'apps/pwa/src/b.tsx']),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    expect(result.verdict).toBe('build');
    expect(result.exitCode).toBe(10);
    expect(result.exitCode).toBe(RESTART_NEEDED_EXIT.build);
    expect(result.from).toBe(FROM);
    expect(result.to).toBe(TO);
    expect(result.pathCount).toBe(2);
    expect(cap.lines.join('\n')).toContain('verdict   build');
  });

  test('src/llm.ts mixed in → restart, exit 11, path in evidence', async () => {
    const cap = capture();
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning(['apps/pwa/src/a.tsx', 'src/llm.ts', 'docs/x.md']),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1',
      out: cap.out,
    });
    expect(result.verdict).toBe('restart');
    expect(result.exitCode).toBe(11);
    expect(result.restartPaths).toEqual(['src/llm.ts']);
    expect(cap.lines.join('\n')).toContain('src/llm.ts');
    expect(result.pathCount).toBe(3);
  });

  test('docs and tests only → none, exit 0', async () => {
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning(['docs/a.md', 'test/b.test.ts']),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: capture().out,
    });
    expect(result.verdict).toBe('none');
    expect(result.exitCode).toBe(0);
    expect(result.pathCount).toBe(2);
  });

  test('zero changes → none', async () => {
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning([]),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: capture().out,
    });
    expect(result.verdict).toBe('none');
    expect(result.exitCode).toBe(0);
    expect(result.pathCount).toBe(0);
  });

  test('health does not respond → exit 2, daemon-unresponsive reason, not none', async () => {
    const cap = capture();
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: async () => null,
      gitFn: gitReturning([]),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    expect(result.exitCode).toBe(2);
    expect(result.exitCode).toBe(RESTART_NEEDED_UNKNOWN_EXIT);
    expect(result.verdict).toBeUndefined();
    expect(result.reason).toContain('데몬 무응답');
    expect(cap.errors.join('\n')).toContain('데몬 무응답');
  });

  test('daemonSha commit missing locally → exit 2, not none', async () => {
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning([], { missing: FROM }),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: capture().out,
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).not.toBe('none');
    expect(result.verdict).toBeUndefined();
    expect(result.reason).toContain('커밋을 로컬에서 못 찾음');
  });

  test('git failure → exit 2', async () => {
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning([], { fail: true }),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: capture().out,
    });
    expect(result.exitCode).toBe(2);
    expect(result.reason).toContain('git 실패');
  });

  test('git diff failure after from and to are known keeps both and a null path count', async () => {
    const cap = capture();
    const calls: string[][] = [];
    const gitFn: GitCommandRunner = (_cwd, args) => {
      calls.push([...args]);
      const joined = args.join(' ');
      if (joined.startsWith('rev-parse')) {
        const ref = args[args.length - 1] ?? '';
        return ok(`${ref.replace(/\^\{commit\}$/, '')}\n`);
      }
      if (joined.startsWith('symbolic-ref')) return { status: 1, stdout: '', stderr: '' };
      if (joined.startsWith('rev-list')) return ok('0\n');
      if (joined.startsWith('diff')) return { status: 128, stdout: '', stderr: 'diff failed' };
      return { status: 1, stdout: '', stderr: `unexpected ${joined}` };
    };
    const result = await decideRestartNeeded({
      to: TO,
      format: 'json',
      healthFn: healthOk,
      gitFn,
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).toBeUndefined();
    expect(result.reason).toContain('git 실패');
    expect(result.from).toBe(FROM);
    expect(result.to).toBe(TO);
    expect(result.pathCount).toBeNull();
    // 리뷰 must-fix(Goodhart): 실패가 «diff 에서» 났는지 — diff 앞에서 죽어도 통과하던 시험이었다.
    const diffCall = calls.find((args) => args[0] === 'diff');
    expect(diffCall).toBeDefined();
    expect(diffCall).toContain('-z');
    expect(diffCall).toContain('--name-only');
    const body = JSON.parse(cap.lines.join('\\n')) as {
      verdict: string;
      reason: string;
      from: string | null;
      to: string | null;
      pathCount: number | null;
    };
    expect(body.verdict).toBe('unknown');
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(TO);
    expect(body.pathCount).toBeNull();
  });

  test('whitespace-only --to is not HEAD — exit 2, commit not found', async () => {
    const cap = capture();
    let sawHead = false;
    const gitFn: GitCommandRunner = (_cwd, args) => {
      const joined = args.join(' ');
      if (joined.includes('HEAD')) sawHead = true;
      return { status: 1, stdout: '', stderr: 'should not run' };
    };
    const result = await decideRestartNeeded({
      to: '   ',
      healthFn: healthOk,
      gitFn,
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).not.toBe('none');
    expect(result.verdict).toBeUndefined();
    expect(result.reason).toContain('커밋을 로컬에서 못 찾음');
    expect(result.from).toBe(FROM);
    expect(result.to).toBeNull();
    expect(sawHead).toBe(false);
    expect(cap.errors.join('\\n')).toContain(`from      ${FROM}`);
    expect(cap.errors.join('\\n')).toContain('to        null');
    expect(cap.errors.join('\\n')).toContain('paths     null');
  });

  test('omitted --to uses checkout HEAD', async () => {
    const result = await decideRestartNeeded({
      healthFn: healthOk,
      gitFn: gitReturning(['docs/a.md']),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: capture().out,
    });
    expect(result.to).toBe(TO);
    expect(result.from).toBe(FROM);
    expect(result.verdict).toBe('none');
  });

  test('restart evidence lists at most 20 paths and says how many more', async () => {
    const causing = Array.from({ length: 23 }, (_, i) => `src/f${i}.ts`);
    const cap = capture();
    const result = await decideRestartNeeded({
      to: TO,
      healthFn: healthOk,
      gitFn: gitReturning(causing),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    expect(result.verdict).toBe('restart');
    expect(result.restartPaths).toHaveLength(20);
    expect(result.more).toBe(3);
    expect(cap.lines.join('\n')).toContain('3개 더');
    expect(result.pathCount).toBe(23);
  });

  test('quoted non-ASCII diff lines are not the contract — NUL paths stay raw', () => {
    const quoted = '"apps/pwa/src/\\355\\225\\234\\352\\270\\200.tsx"';
    expect(classifyChangedPaths([quoted])).toBe('restart');
    expect(parseNulPaths('apps/pwa/src/한글.tsx\0')).toEqual(['apps/pwa/src/한글.tsx']);
    expect(classifyChangedPaths(parseNulPaths('apps/pwa/src/한글.tsx\0'))).toBe('build');
  });

  test('NUL paths keep a leading space — trimming would hide a restart', () => {
    // ` docs/note.txt` is not `docs/**` and not `*.md`. Trimming the leading
    // space turns it into `docs/note.txt` (`none`). The bytes stay as git wrote them.
    expect(parseNulPaths(' docs/note.txt\0')).toEqual([' docs/note.txt']);
    expect(classifyChangedPaths(parseNulPaths(' docs/note.txt\0'))).toBe('restart');
    expect(classifyChangedPaths(['docs/note.txt'])).toBe('none');
    // `*.md` still classifies as docs even with a leading space — that suffix is the contract.
    expect(parseNulPaths(' docs/a.md\0')).toEqual([' docs/a.md']);
    expect(classifyChangedPaths([' docs/a.md'])).toBe('none');
  });

  test('real git -z diff keeps a leading space and does not collapse it into docs/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'restart-needed-'));
    const git = (args: string[]) => {
      const result = runGitCommand(root, args, {
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      });
      if (result.status !== 0) throw new Error(`${args.join(' ')} → ${result.status} ${result.stderr}`);
      return result.stdout.trim();
    };
    const decide = async (rel: string, from: string, to: string) => {
      const cap = capture();
      return decideRestartNeeded({
        to,
        healthFn: async () => ({ daemonSha: from }),
        gitFn: runGitCommand,
        restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
        cwd: root,
        out: cap.out,
      });
    };
    const commitChange = (rel: string, body: string, message: string): string => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), body);
      git(['add', '--', rel]);
      git(['commit', '-q', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    };
    try {
      git(['init', '-q']);
      git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      git(['config', 'user.email', 't@t']);
      git(['config', 'user.name', 't']);
      // The cited name. `*.md` is docs either way — what must not happen is
      // the parser rewriting ` 내부 문서 `a`` into `내부 문서 `a``.
      const cited = ' docs/a.md';
      const citedBase = commitChange(cited, 'a\n', 'cited-base');
      const citedTo = commitChange(cited, 'b\n', 'cited');
      const citedDiff = runGitCommand(root, ['diff', '-z', '--name-only', `${citedBase}..${citedTo}`]);
      expect(citedDiff.status).toBe(0);
      expect(parseNulPaths(citedDiff.stdout)).toEqual([cited]);
      expect(parseNulPaths(citedDiff.stdout)).not.toContain('docs/a.md');
      const citedResult = await decide(cited, citedBase, citedTo);
      expect(citedResult.pathCount).toBe(1);
      expect(citedResult.verdict).toBe('none');
      expect(citedResult.exitCode).toBe(0);

      // Same leading space, but the trimmed form is `docs/**` (`none`) while
      // the real name is not. Trimming would report exit 0.
      const forcing = ' docs/note.txt';
      const forcingBase = commitChange(forcing, 'a\n', 'forcing-base');
      const forcingTo = commitChange(forcing, 'b\n', 'forcing');
      const forcingResult = await decide(forcing, forcingBase, forcingTo);
      expect(forcingResult.verdict).toBe('restart');
      expect(forcingResult.exitCode).toBe(11);
      expect(forcingResult.verdict).not.toBe('none');
      expect(forcingResult.exitCode).not.toBe(0);
      expect(forcingResult.restartPaths).toEqual([forcing]);
      expect(forcingResult.pathCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('real git -z diff of apps/pwa/src/한글.tsx only → build, exit 10', async () => {
    const root = mkdtempSync(join(tmpdir(), 'restart-needed-'));
    const git = (args: string[]) => {
      const result = runGitCommand(root, args, {
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      });
      if (result.status !== 0) throw new Error(`${args.join(' ')} → ${result.status} ${result.stderr}`);
      return result.stdout.trim();
    };
    try {
      git(['init', '-q']);
      git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      git(['config', 'user.email', 't@t']);
      git(['config', 'user.name', 't']);
      const rel = 'apps/pwa/src/한글.tsx';
      mkdirSync(join(root, 'apps/pwa/src'), { recursive: true });
      writeFileSync(join(root, rel), 'a\n');
      git(['add', '--', rel]);
      git(['commit', '-q', '-m', 'base']);
      const from = git(['rev-parse', 'HEAD']);
      writeFileSync(join(root, rel), 'b\n');
      git(['add', '--', rel]);
      git(['commit', '-q', '-m', 'pwa']);
      const to = git(['rev-parse', 'HEAD']);
      const cap = capture();
      const result = await decideRestartNeeded({
        to,
        healthFn: async () => ({ daemonSha: from }),
        gitFn: runGitCommand,
        restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
        cwd: root,
        out: cap.out,
      });
      expect(result.verdict).toBe('build');
      expect(result.exitCode).toBe(10);
      expect(result.pathCount).toBe(1);
      expect(result.from).toBe(from);
      expect(result.to).toBe(to);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--json carries from, to, pathCount', async () => {
    const cap = capture();
    const result = await decideRestartNeeded({
      to: TO,
      format: 'json',
      healthFn: healthOk,
      gitFn: gitReturning(['src/llm.ts']),
      restBaseFn: async () => 'http://127.0.0.1:31415/v1/',
      out: cap.out,
    });
    const body = JSON.parse(cap.lines.join('\n')) as { verdict: string; from: string; to: string; pathCount: number; restartPaths: string[] };
    expect(body.verdict).toBe('restart');
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(TO);
    expect(body.pathCount).toBe(1);
    expect(body.restartPaths).toEqual(['src/llm.ts']);
    expect(result.exitCode).toBe(11);
  });
});
