// ── Git tools · Coding Pipeline P4 tests ──
//
// Covers GitCommit + OpenPullRequest + synthesiseAutoBranchName.
// All git/gh executions are stubbed through injected runner so tests
// don't touch the real repo or network.

import { describe, expect, test } from 'bun:test';

import {
  buildGitCommitTool,
  dispatchGitCommit,
  findSensitiveFiles,
  appendAuthorTrailer,
} from '../src/tool-runtime/git-commit-runtime.js';
import {
  buildOpenPullRequestTool,
  dispatchOpenPullRequest,
  buildMergePullRequestTool,
  dispatchMergePullRequest,
} from '../src/tool-runtime/git-pr-runtime.js';
import { synthesiseAutoBranchName } from '../src/tool-runtime/git-worktree-runtimes.js';

// ── GitCommit ───────────────────────────────────────────────────────

describe('findSensitiveFiles', () => {
  test('flags .env variants', () => {
    expect(findSensitiveFiles(['.env', '.env.local', '.env.production']).length).toBe(3);
  });

  test('flags credentials patterns', () => {
    expect(findSensitiveFiles(['.credentials', 'credentials.json', '.aws-credentials']).length).toBe(3);
  });

  test('flags *.pem and SSH keys', () => {
    expect(findSensitiveFiles(['server.pem', 'id_rsa', 'id_rsa.pub']).length).toBe(3);
  });

  test('passes through safe files', () => {
    expect(findSensitiveFiles(['src/foo.ts', 'docs/README.md', 'package.json'])).toEqual([]);
  });

  test('basename-only matching (path prefix ignored)', () => {
    expect(findSensitiveFiles(['config/.env', 'deep/nested/path/.env']).length).toBe(2);
  });
});

describe('appendAuthorTrailer', () => {
  test('appends when missing', () => {
    const out = appendAuthorTrailer('feat: add X');
    expect(out).toContain('Co-Authored-By: Claude');
    // Exactly one blank line before trailer.
    expect(out).toMatch(/feat: add X\n\nCo-Authored-By/);
  });

  test('does not double-add when present', () => {
    const pre = `feat: add X\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
    const out = appendAuthorTrailer(pre);
    const occurrences = (out.match(/Co-Authored-By/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('handles trailing whitespace in input', () => {
    const out = appendAuthorTrailer('feat: add X\n\n\n   ');
    expect(out).toMatch(/feat: add X\n\nCo-Authored-By/);
  });
});

describe('dispatchGitCommit', () => {
  test('rejects empty file list', () => {
    expect(() =>
      dispatchGitCommit({ message: 'x', files: [] }),
    ).toThrow(/non-empty/);
  });

  test('rejects empty message', () => {
    expect(() =>
      dispatchGitCommit({ message: '  ', files: ['a'] }),
    ).toThrow(/message/i);
  });

  test('rejects sensitive files without allowSensitive', () => {
    expect(() =>
      dispatchGitCommit({ message: 'oops', files: ['.env'] }),
    ).toThrow(/sensitive/i);
  });

  test('accepts sensitive when allowSensitive=true', () => {
    const calls: Array<{ cmd: string; argv: string[] }> = [];
    const runner = (cmd: string, argv: string[]) => {
      calls.push({ cmd, argv });
      if (argv[0] === 'rev-parse' && argv[1] === 'HEAD') return { stdout: 'abc1234', stderr: '', status: 0 };
      if (argv[0] === 'rev-parse') return { stdout: 'main', stderr: '', status: 0 };
      return { stdout: '', stderr: '', status: 0 };
    };
    const r = dispatchGitCommit(
      { message: 'ack: .env known-ok', files: ['.env'], allowSensitive: true },
      { cwd: '/tmp', runner },
    );
    expect(r.commitSha).toBe('abc1234');
    expect(r.branch).toBe('main');
    expect(calls[0]!.argv).toEqual(['add', '--', '.env']);
  });

  test('skipHooks requires reason', () => {
    expect(() =>
      dispatchGitCommit({ message: 'x', files: ['a'], skipHooks: true }),
    ).toThrow(/skipHooksReason/);
  });

  test('auto-appends Co-Authored-By trailer', () => {
    const seenArgs: string[][] = [];
    const runner = (cmd: string, argv: string[]) => {
      seenArgs.push(argv);
      if (argv[0] === 'rev-parse' && argv[1] === 'HEAD') return { stdout: 'sha', stderr: '', status: 0 };
      if (argv[0] === 'rev-parse') return { stdout: 'br', stderr: '', status: 0 };
      return { stdout: '', stderr: '', status: 0 };
    };
    dispatchGitCommit(
      { message: 'fix: Y', files: ['src/y.ts'] },
      { cwd: '/tmp', runner },
    );
    const commitCall = seenArgs.find((a) => a[0] === 'commit');
    expect(commitCall).toBeDefined();
    const msgArg = commitCall![2]!;
    expect(msgArg).toContain('Co-Authored-By: Claude');
  });

  test('surfaces git add failure', () => {
    const runner = (_cmd: string, argv: string[]) => {
      if (argv[0] === 'add') return { stdout: '', stderr: 'fatal: pathspec unknown', status: 1 };
      return { stdout: '', stderr: '', status: 0 };
    };
    expect(() =>
      dispatchGitCommit({ message: 'x', files: ['nope'] }, { cwd: '/tmp', runner }),
    ).toThrow(/git add failed/);
  });

  test('surfaces git commit failure', () => {
    const runner = (_cmd: string, argv: string[]) => {
      if (argv[0] === 'add') return { stdout: '', stderr: '', status: 0 };
      if (argv[0] === 'commit') return { stdout: '', stderr: 'nothing to commit', status: 1 };
      return { stdout: '', stderr: '', status: 0 };
    };
    expect(() =>
      dispatchGitCommit({ message: 'x', files: ['a'] }, { cwd: '/tmp', runner }),
    ).toThrow(/git commit failed/);
  });

  test('schema build is valid', () => {
    const spec = buildGitCommitTool();
    expect(spec.name).toBe('GitCommit');
    expect((spec.parameters as any).required).toEqual(['message', 'files']);
  });
});

// ── OpenPullRequest ─────────────────────────────────────────────────

describe('dispatchOpenPullRequest', () => {
  test('rejects missing title', () => {
    expect(() => dispatchOpenPullRequest({ title: '', body: 'b' })).toThrow(/title/);
  });

  test('rejects missing body', () => {
    expect(() => dispatchOpenPullRequest({ title: 'T', body: '' })).toThrow(/body/);
  });

  test('rejects title > 120 chars', () => {
    expect(() =>
      dispatchOpenPullRequest({ title: 'x'.repeat(121), body: 'b' }),
    ).toThrow(/120 chars/);
  });

  test('refuses head=main', () => {
    expect(() =>
      dispatchOpenPullRequest({ title: 'T', body: 'b', head: 'main' }),
    ).toThrow(/protected branch/);
  });

  test('refuses head=master', () => {
    expect(() =>
      dispatchOpenPullRequest({ title: 'T', body: 'b', head: 'master' }),
    ).toThrow(/protected branch/);
  });

  test('streams body via stdin', () => {
    let seenStdin = '';
    let seenArgv: string[] = [];
    const runner = (_cmd: string, argv: string[], stdin: string) => {
      seenArgv = argv;
      seenStdin = stdin;
      return {
        stdout: 'https://github.com/o/r/pull/42',
        stderr: '',
        status: 0,
      };
    };
    const r = dispatchOpenPullRequest(
      { title: 'Fix Y', body: '## Summary\n- something' },
      { cwd: '/tmp', runner },
    );
    expect(seenArgv).toContain('--body-file');
    expect(seenArgv).toContain('-');  // stdin sigil
    expect(seenStdin).toContain('## Summary');
    expect(r.url).toBe('https://github.com/o/r/pull/42');
    expect(r.number).toBe(42);
  });

  test('respects base / head / draft', () => {
    let seenArgv: string[] = [];
    const runner = (_cmd: string, argv: string[]) => {
      seenArgv = argv;
      return { stdout: 'https://github.com/o/r/pull/1', stderr: '', status: 0 };
    };
    dispatchOpenPullRequest(
      { title: 'T', body: 'B', base: 'develop', head: 'feat/x', draft: true },
      { cwd: '/tmp', runner },
    );
    expect(seenArgv).toContain('--base');
    expect(seenArgv).toContain('develop');
    expect(seenArgv).toContain('--head');
    expect(seenArgv).toContain('feat/x');
    expect(seenArgv).toContain('--draft');
  });

  test('surfaces gh failure', () => {
    const runner = () => ({ stdout: '', stderr: 'no auth', status: 1 });
    expect(() =>
      dispatchOpenPullRequest({ title: 'T', body: 'B' }, { cwd: '/tmp', runner }),
    ).toThrow(/gh pr create failed/);
  });

  test('schema build', () => {
    const spec = buildOpenPullRequestTool();
    expect(spec.name).toBe('OpenPullRequest');
    expect((spec.parameters as any).required).toEqual(['title', 'body']);
  });
});

// ── MergePullRequest (Coding Pipeline P4 followup) ──────────────────

describe('dispatchMergePullRequest', () => {
  function okRunner(): { runner: (cmd: string, argv: string[], stdin: string, cwd: string) => { stdout: string; stderr: string; status: number }; seenArgv: string[][] } {
    const seen: string[][] = [];
    return {
      seenArgv: seen,
      runner: (_cmd: string, argv: string[]) => {
        seen.push([...argv]);
        return { stdout: '✓ Pull request #42 merged.', stderr: '', status: 0 };
      },
    };
  }

  test('rejects when both number and url are provided', () => {
    expect(() =>
      dispatchMergePullRequest(
        { number: 42, url: 'https://github.com/o/r/pull/43', strategy: 'squash' },
        { cwd: '/tmp' },
      ),
    ).toThrow(/exactly one/);
  });

  test('rejects when neither number nor url is provided', () => {
    expect(() =>
      dispatchMergePullRequest({ strategy: 'squash' } as any, { cwd: '/tmp' }),
    ).toThrow(/required/);
  });

  test('rejects malformed url', () => {
    expect(() =>
      dispatchMergePullRequest(
        { url: 'https://example.com/foo', strategy: 'squash' },
        { cwd: '/tmp' },
      ),
    ).toThrow(/url .* doesn't match/);
  });

  test('rejects invalid strategy', () => {
    expect(() =>
      dispatchMergePullRequest(
        { number: 1, strategy: 'bogus' as any },
        { cwd: '/tmp' },
      ),
    ).toThrow(/invalid strategy/);
  });

  test('squash by number — argv contains pr/merge/N/--squash', () => {
    const { runner, seenArgv } = okRunner();
    const r = dispatchMergePullRequest(
      { number: 42, strategy: 'squash' },
      { cwd: '/tmp', runner },
    );
    expect(seenArgv[0]).toEqual(['pr', 'merge', '42', '--squash']);
    expect(r.ref).toBe('42');
    expect(r.strategy).toBe('squash');
    expect(r.deletedBranch).toBe(false);
    expect(r.usedAdmin).toBe(false);
    expect(r.usedAuto).toBe(false);
    expect(r.output).toContain('merged via squash');
  });

  test('rebase + deleteBranch + auto', () => {
    const { runner, seenArgv } = okRunner();
    dispatchMergePullRequest(
      { url: 'https://github.com/o/r/pull/9', strategy: 'rebase', deleteBranch: true, auto: true },
      { cwd: '/tmp', runner },
    );
    expect(seenArgv[0]).toEqual([
      'pr', 'merge', 'https://github.com/o/r/pull/9',
      '--rebase', '--delete-branch', '--auto',
    ]);
  });

  test('admin without env var → throws helpful error', () => {
    expect(() =>
      dispatchMergePullRequest(
        { number: 7, strategy: 'merge', admin: true },
        { cwd: '/tmp', adminEnvAllowed: false },
      ),
    ).toThrow(/MONAD_GH_ALLOW_ADMIN=1/);
  });

  test('admin + adminEnvAllowed=true → passes --admin', () => {
    const { runner, seenArgv } = okRunner();
    const r = dispatchMergePullRequest(
      { number: 7, strategy: 'merge', admin: true },
      { cwd: '/tmp', runner, adminEnvAllowed: true },
    );
    expect(seenArgv[0]).toContain('--admin');
    expect(r.usedAdmin).toBe(true);
  });

  test('admin + auto → mutually exclusive', () => {
    expect(() =>
      dispatchMergePullRequest(
        { number: 7, strategy: 'squash', admin: true, auto: true },
        { cwd: '/tmp', adminEnvAllowed: true },
      ),
    ).toThrow(/mutually exclusive/);
  });

  test('surfaces gh failure with stderr', () => {
    const runner = () => ({ stdout: '', stderr: 'PR not mergeable', status: 1 });
    expect(() =>
      dispatchMergePullRequest(
        { number: 1, strategy: 'squash' },
        { cwd: '/tmp', runner },
      ),
    ).toThrow(/gh pr merge failed.*PR not mergeable/);
  });

  test('schema build', () => {
    const spec = buildMergePullRequestTool();
    expect(spec.name).toBe('MergePullRequest');
    expect((spec.parameters as any).required).toEqual(['strategy']);
    const props = (spec.parameters as any).properties;
    expect(props.strategy.enum).toEqual(['squash', 'merge', 'rebase']);
  });
});

// ── Auto-branch name synthesis ──────────────────────────────────────

describe('synthesiseAutoBranchName', () => {
  test('shape: session/YYYYMMDD-HHmm-<slug>', () => {
    const name = synthesiseAutoBranchName('refactor the cache', new Date(2026, 3, 24, 15, 30));
    expect(name).toBe('session/20260424-1530-refactor-the-cache');
  });

  test('slugifies special chars', () => {
    const name = synthesiseAutoBranchName('Fix: bug #42!', new Date(2026, 0, 1, 0, 0));
    expect(name).toBe('session/20260101-0000-fix-bug-42');
  });

  test('clamps slug to 40 chars', () => {
    const long = 'a'.repeat(100);
    const name = synthesiseAutoBranchName(long, new Date(2026, 0, 1, 0, 0));
    const slug = name.split('-').slice(2).join('-');
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  test('fallback when topic empty → "work"', () => {
    const name = synthesiseAutoBranchName('', new Date(2026, 0, 1, 0, 0));
    expect(name).toBe('session/20260101-0000-work');
  });

  test('fallback when topic is only special chars → "work"', () => {
    const name = synthesiseAutoBranchName('!!!###', new Date(2026, 0, 1, 0, 0));
    expect(name).toBe('session/20260101-0000-work');
  });
});
