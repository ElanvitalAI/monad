import { describe, expect, it, spyOn } from 'bun:test';
import { assessWorktree, defineBoundedPrFallback, execHarnessWorktrees, listRegisteredWorktrees, planHarnessWorktrees, queryWorktreePr, queryWorktreePrsBatch, readWorktreeProvenance, renderHarnessWorktreesReport, WORKTREE_PR_BATCH_LIMIT, worktreePrCandidateKey, worktreePrStateFromBatch } from '../src/harness/harness-worktrees.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorktreeSession } from '../src/git-fs/worktree.js';
import type { PtyManifestRow } from '../src/pty-shell/pty-manifest.js';

const base = { path: '/repo.worktrees/example', branch: 'feature/example', dirty: false, uniqueCommitCount: 0, changedFileCount: 0 };
const manifestRow = (sessionId: string, alive: boolean): PtyManifestRow => ({
  id: `pty-${sessionId}`, kind: 'shell', cmd: 'bun', ownerPid: 1, ptyPid: 1, instance: 'test', startedAt: 0,
  alive, exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0, outputBytesTotal: 0,
  runId: '', runIdSource: '', spaceId: '', sessionId, closedAt: alive ? 0 : 1, codeSha: '',
  // ⭐ PTY 계보 필드([F] 축) — main 을 받아 «필수»가 됐다. 이 픽스처는 계보를 안 쓴다.
  // ⚠️ 타입이 non-nullable 이라 「부모 없음」을 ''/0 으로 쓸 수밖에 없다 —
  //    ⛔ 그러면 「부모가 없다」와 「부모를 모른다」가 «같은 값»이 된다. 소유자에게 넘길 관측.
  parentPtyId: '', parentPid: 0, parentKind: '',
});

describe('harness worktrees — pure four-axis assessment', () => {
  it('maps the four required disposition branches without branch-prefix scope', () => {
    expect(assessWorktree({ ...base, pr: 'merged' }).disposition).toBe('reclaim-safe');
    expect(assessWorktree({ ...base, pr: 'none' }).disposition).toBe('reclaim-safe');
    expect(assessWorktree({ ...base, pr: 'none', uniqueCommitCount: 1 }).disposition).toBe('needs-human');
    expect(assessWorktree({ ...base, pr: 'merged', dirty: true }).disposition).toBe('needs-human');
    expect(assessWorktree({ ...base, pr: 'open' }).disposition).toBe('do-not-touch');
    expect(assessWorktree({ path: '/scratchpad/detached', pr: 'unknown' }).disposition).toBe('unjudgeable');
  });

  it('never classifies the primary worktree reclaim-safe', () => {
    expect(assessWorktree({ ...base, pr: 'none', isPrimary: true })).toMatchObject({ disposition: 'do-not-touch', reason: 'primary-worktree' });
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return { status: 0, stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /secondary\0branch refs/heads/feature/a\0\0', stderr: '' };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({ run, runGh: () => ({ status: 0, stdout: '' }) });
    expect(report.assessments[0]).toMatchObject({ path: '/repo', isPrimary: true, disposition: 'do-not-touch', reason: 'primary-worktree' });
  });

  it('queries one PR head at a time and only accepts the current HEAD', () => {
    let args: string[] = [];
    expect(queryWorktreePr('feature/only-this', 'current-head', '/wt', (actual) => {
      args = actual;
      return { status: 0, stdout: 'MERGED\told-head\nOPEN\tcurrent-head\nCLOSED\tolder-head\n' };
    })).toBe('open');
    expect(args).toContain('--head');
    expect(args).toContain('feature/only-this');
    // ⛔ 상한은 «명시»한다 — 인자를 빼면 `gh` 기본값(30)이 «안 보이는» 상한이 된다(원장 GIT-T19).
    //   ⭐ 값까지 고정한다 — 상한이 «내려가는» 회귀는 존재 검사만으로는 안 잡힌다(리뷰 지적).
    expect(args).toContain('--limit');
    expect(args[args.indexOf('--limit') + 1]).toBe('100');
  });

  // ⛔⭐⭐⭐ 반환 수가 상한과 «같으면» 잘렸을 수 있다 ⇒ 「PR 없음」으로 읽으면 회수 안전 쪽으로
  //   위험하게 틀린다. 원장 `GIT-T18` 이 세운 규칙(*반환 수가 상한과 같으면 데이터가 아니다*)의 적용.
  it('fails closed when the PR query return count reaches the declared limit', () => {
    const saturated = Array.from({ length: 100 }, () => 'CLOSED\tolder-head').join('\n');
    expect(queryWorktreePr('feature/saturated', 'current-head', '/wt', () => ({
      status: 0, stdout: `${saturated}\n`,
    }))).toBe('unknown');
  });

  it('fails closed when a successful PR query has malformed rows or unknown states', () => {
    expect(queryWorktreePr('feature/unknown', 'current-head', '/wt', () => ({
      status: 0, stdout: 'OPEN\tcurrent-head\nUNRECOGNIZED\tolder-head\n',
    }))).toBe('unknown');
    expect(queryWorktreePr('feature/malformed', 'current-head', '/wt', () => ({
      status: 0, stdout: 'OPEN\tcurrent-head\textra-field\n',
    }))).toBe('unknown');
    expect(assessWorktree({ ...base, pr: 'unknown' })).toMatchObject({
      disposition: 'unjudgeable', reason: 'measurement-unavailable',
    });
  });

  it('distinguishes a branch with no PR from one whose PR does not cover the current HEAD', () => {
    const noPr = queryWorktreePr('feature/no-pr', 'current-head', '/wt', () => ({ status: 0, stdout: '' }));
    const uncoveredPr = queryWorktreePr('feature/continued', 'current-head', '/wt', () => ({
      status: 0, stdout: 'MERGED\told-head\n',
    }));

    expect(noPr).toBe('none');
    expect(uncoveredPr).toBe('head-uncovered');
    expect(assessWorktree({ ...base, pr: noPr, uniqueCommitCount: 1 })).toMatchObject({
      disposition: 'needs-human', reason: 'no-pr-with-output',
    });
    expect(assessWorktree({ ...base, pr: uncoveredPr, uniqueCommitCount: 1 })).toMatchObject({
      disposition: 'needs-human', reason: 'pr-exists-head-uncovered',
    });
  });

  it('does not classify a branch as merged when only an earlier PR was merged', () => {
    expect(queryWorktreePr('feature/continued', 'current-head', '/wt', () => ({
      status: 0, stdout: 'MERGED\told-head\nCLOSED\tcurrent-head\n',
    }))).toBe('closed');
  });

  it('reclaims a clean merged PR even when squash leaves output relative to main', () => {
    expect(assessWorktree({ ...base, pr: 'merged', uniqueCommitCount: 1 })).toMatchObject({ disposition: 'reclaim-safe', reason: 'merged-clean', hasOutput: true });
    expect(assessWorktree({ ...base, pr: 'merged', changedFileCount: 1 })).toMatchObject({ disposition: 'reclaim-safe', reason: 'merged-clean', hasOutput: true });
  });

  it('puts branch-unavailable behind only the primary exclusion and fails closed on unknown ownership', () => {
    expect(assessWorktree({ path: '/wt', pr: 'unknown', sessionLiveness: 'live' })).toMatchObject({ disposition: 'unjudgeable', reason: 'branch-unavailable' });
    expect(assessWorktree({ ...base, pr: 'merged', sessionLiveness: 'unknown' })).toMatchObject({ disposition: 'unjudgeable', reason: 'owner-session-liveness-unavailable' });
  });

  it('makes no-PR reclamation depend on the explicit branch-content state when supplied', () => {
    expect(assessWorktree({ ...base, pr: 'none', uniqueCommitCount: 1, branchContent: 'already-contained' })).toMatchObject({
      disposition: 'reclaim-safe', reason: 'no-pr-content-already-contained',
    });
    expect(assessWorktree({ ...base, pr: 'none', branchContent: 'differs' })).toMatchObject({
      disposition: 'needs-human', reason: 'no-pr-content-differs',
    });
    expect(assessWorktree({ ...base, pr: 'none', branchContent: 'unavailable' })).toMatchObject({
      disposition: 'unjudgeable', reason: 'branch-content-unavailable',
    });
  });

  it('preserves legacy no-PR output-count assessment when branch content is omitted', () => {
    expect(assessWorktree({ ...base, pr: 'none' })).toMatchObject({
      disposition: 'reclaim-safe', reason: 'no-pr-and-no-output',
    });
    expect(assessWorktree({ ...base, pr: 'none', uniqueCommitCount: 1 })).toMatchObject({
      disposition: 'needs-human', reason: 'no-pr-with-output',
    });
  });

  it('never marks a dirty no-PR worktree reclaim-safe', () => {
    expect(assessWorktree({ ...base, pr: 'none', dirty: true, branchContent: 'already-contained' })).toMatchObject({ disposition: 'do-not-touch', reason: 'dirty-worktree' });
  });

  it('parses NUL-delimited porcelain fields as stateful worktree records including detached heads', () => {
    const run = () => ({ status: 0, stdout: 'worktree /repo\0HEAD aaa\0branch refs/heads/feature/a\0\0worktree /detached\0HEAD bbb\0detached\0\0', stderr: '' });
    expect(listRegisteredWorktrees(run)).toEqual([
      { path: '/repo', branch: 'feature/a', isPrimary: true },
      { path: '/detached', isPrimary: false },
    ]);
  });

  it('uses the production manifest adapter for opaque sessions and ignores non-exact paths', () => {
    const session: WorktreeSession = { sessionId: 'opaque-session', worktreePath: '/wt', branch: 'feature/a', previousCwd: '/repo', previousRepoRoot: '/repo', enteredAt: 0 };
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return { status: 0, stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-opaque-session-copy\0branch refs/heads/feature/a\0\0worktree /wt\0branch refs/heads/feature/b\0\0', stderr: '' };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('diff')) return { status: 0, stdout: 'ordinary.ts\0strange\nname.ts\0', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({
      run,
      runGh: () => ({ status: 0, stdout: '' }),
      sessions: [session],
      listPtyManifest: () => [manifestRow('other-session', true), manifestRow('opaque-session', false)],
    });
    expect(report.assessments[1]).toMatchObject({ changedFileCount: 2, disposition: 'needs-human', reason: 'no-pr-with-output' });
    expect(report.assessments[2]).toMatchObject({ changedFileCount: 2, sessionLiveness: 'stale', disposition: 'needs-human' });
  });

  it('aggregates every exact-path session with live before unknown and stale', () => {
    const stale: WorktreeSession = { sessionId: 'stale', worktreePath: '/wt', branch: 'feature/a', previousCwd: '/repo', previousRepoRoot: '/repo', enteredAt: 0 };
    const live: WorktreeSession = { ...stale, sessionId: 'live' };
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return { status: 0, stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt\0branch refs/heads/feature/a\0\0', stderr: '' };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({
      run, runGh: () => ({ status: 0, stdout: '' }), sessions: [stale, live],
      listPtyManifest: () => [manifestRow('stale', false), manifestRow('live', true)],
    });
    expect(report.assessments[1]).toMatchObject({ sessionLiveness: 'live', disposition: 'do-not-touch', reason: 'owner-session-alive' });
  });

  it('reports 45-worktree scan progress to stderr without changing serial assessment output', () => {
    const worktrees = Array.from({ length: 45 }, (_, index) => `worktree /wt-${index}\0branch refs/heads/feature/${index}\0\0`).join('');
    const progress: string[] = [];
    const gitCalls: string[][] = [];
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      gitCalls.push(args);
      if (args[0] === 'worktree') return { status: 0, stdout: worktrees, stderr: '' };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'head\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({
      run,
      runGh: (args) => { ghCalls.push(args); return { status: 0, stdout: '' }; },
      progress: (line) => progress.push(line),
    });

    expect(progress).toHaveLength(5);
    expect(progress[0]).toBe('harness worktrees: 45개 점검 시작');
    expect(progress.slice(1, -1)).toHaveLength(3);
    expect(progress.slice(1, -1)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^harness worktrees: 1\/45 · \d+초 경과$/),
      expect.stringMatching(/^harness worktrees: 21\/45 · \d+초 경과$/),
      expect.stringMatching(/^harness worktrees: 41\/45 · \d+초 경과$/),
    ]));
    expect(progress.at(-1)).toMatch(/^harness worktrees: 45개 점검 완료 · \d+초 소요$/);
    expect(report.assessments).toHaveLength(45);
    expect(gitCalls).toHaveLength(226);
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0]).not.toContain('--head');
    expect(ghCalls[0][ghCalls[0].indexOf('--limit') + 1]).toBe(String(WORKTREE_PR_BATCH_LIMIT));

    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      execHarnessWorktrees({ run, runGh: () => ({ status: 0, stdout: '' }) });
      console.log(renderHarnessWorktreesReport(report).join('\n'));
      expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('harness worktrees: 45개 점검 시작');
      expect(stdout.mock.calls.map(([line]) => String(line)).join('')).not.toContain('harness worktrees:');
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it('renders the PR, owner-session, and explicit absent provenance axes so a person can audit each disposition', () => {
    const report = planHarnessWorktrees([
      { ...base, path: '/without-owner', pr: 'none' },
      { ...base, path: '/owner-liveness-unavailable', pr: 'unknown', sessionLiveness: 'unknown', owner: 'dev:run-1', command: 'dev', createdAt: '2026-08-04T12:00:00.000Z' },
    ]);

    const lines = renderHarnessWorktreesReport(report);
    expect(lines[2]).toContain('PR 재질의 0 · 상한 미질의 0');
    expect(lines[3]).toContain('pr=none session=n/a');
    expect(lines[3]).toContain('owner=not-recorded command=not-recorded createdAt=not-recorded');
    expect(lines[4]).toContain('pr=unknown session=unknown');
    expect(lines[4]).toContain('owner=dev:run-1 command=dev createdAt=2026-08-04T12:00:00.000Z');
  });

  it('reads worktree-scoped provenance, reports absent keys, and preserves Git read failures', () => {
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return { status: 0, stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt\0branch refs/heads/feature/a\0\0', stderr: '' };
      if (args.includes('config')) {
        const key = args.at(-1);
        // ⭐ 계약이 바뀌었다 — provenance 를 읽기 «전»에 워크트리 config 확장 상태를 먼저 묻는다
        //    (문구가 아니라 «구조»로 「기록 없음」을 가르기 위해). 모의도 그 질의에 답해야 한다.
        if (key === 'extensions.worktreeConfig') {
          // /repo 는 read-error 경로를 유지해야 하므로 확장은 «켜져» 있다고 답한다.
          return { status: 0, stdout: 'true\n', stderr: '' };
        }
        const values: Record<string, string> = {
          'elanous.harness.owner': 'dev:run-1',
          'elanous.harness.command': 'dev',
          'elanous.harness.createdAt': '2026-08-04T12:00:00.000Z',
        };
        if (args[1] === '/repo') return { status: 128, stdout: '', stderr: 'fatal: config unreadable' };
        return args[1] === '/wt' && key && values[key] ? { status: 0, stdout: `${values[key]}\n`, stderr: '' } : { status: 1, stdout: '', stderr: '' };
      }
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({ run, runGh: () => ({ status: 0, stdout: '' }) });
    expect(report.assessments[0]).toMatchObject({ owner: 'read-error: fatal: config unreadable', command: 'read-error: fatal: config unreadable', createdAt: 'read-error: fatal: config unreadable' });
    expect(report.assessments[1]).toMatchObject({ owner: 'dev:run-1', command: 'dev', createdAt: '2026-08-04T12:00:00.000Z' });
  });

  it('rejects requested removal for human-review, open-PR, and unjudgeable cases with durable reasons', () => {
    const report = planHarnessWorktrees([
      { ...base, pr: 'merged' },
      { ...base, path: '/with-output', pr: 'none', uniqueCommitCount: 2 },
      { ...base, path: '/open', pr: 'open' },
      { path: '/detached', pr: 'unknown' },
    ], true);
    expect(report.counts).toEqual({ 'reclaim-safe': 1, 'needs-human': 1, 'do-not-touch': 1, unjudgeable: 1 });
    expect(report.rejectedRemoval.map((item) => item.reason)).toEqual(['no-pr-with-output', 'open-pr', 'branch-unavailable']);
    const text = renderHarnessWorktreesReport(report, true).join('\n');
    expect(text).toContain('사람이 봐야 함 1');
    expect(text).toContain('거부: /with-output · no-pr-with-output');
    expect(text).toContain('실제 worktree를 제거하지 않는다');
  });

  it('batches GitHub PR lookup once and maps raw states by branch', () => {
    let calls = 0;
    const batch = queryWorktreePrsBatch('/repo', (args) => {
      calls += 1;
      expect(args).toEqual(['pr', 'list', '--state', 'all', '--limit', String(WORKTREE_PR_BATCH_LIMIT), '--json', 'headRefName,state,headRefOid']);
      return {
        status: 0,
        stdout: JSON.stringify([
          { headRefName: 'feature/open', state: 'OPEN', headRefOid: 'aaa' },
          { headRefName: 'feature/merged', state: 'MERGED', headRefOid: 'bbb' },
        ]),
      };
    });
    expect(calls).toBe(1);
    expect(batch).toMatchObject({ ok: true, truncated: false });
    expect(batch.byBranch.get('feature/open')).toEqual([{ state: 'OPEN', headRefOid: 'aaa' }]);
    expect(worktreePrStateFromBatch('feature/open', 'aaa', batch)).toBe('open');
    expect(worktreePrStateFromBatch('feature/merged', 'bbb', batch)).toBe('merged');
    expect(worktreePrStateFromBatch('feature/absent', 'ccc', batch)).toBe('none');
  });

  it('marks a full batch as truncated and does not fold unseen branches into none', () => {
    let calls = 0;
    const rows = Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => ({
      headRefName: `feature/${index}`,
      state: 'CLOSED',
      headRefOid: `oid-${index}`,
    }));
    const batch = queryWorktreePrsBatch('/repo', () => {
      calls += 1;
      return { status: 0, stdout: JSON.stringify(rows) };
    });
    expect(calls).toBe(1);
    expect(batch.ok).toBe(true);
    expect(batch.truncated).toBe(true);
    expect(worktreePrStateFromBatch('feature/0', 'oid-0', batch)).toBe('closed');
    expect(worktreePrStateFromBatch('feature/unseen', 'oid-unseen', batch)).toBe('unknown');
    expect(worktreePrStateFromBatch('feature/unseen', 'oid-unseen', batch)).not.toBe('none');
  });

  it('requeries only truncated-batch unknown branches up to its cap', () => {
    const batch = queryWorktreePrsBatch('/repo', () => ({
      status: 0,
      stdout: JSON.stringify(Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => ({
        headRefName: index === 0 ? 'feature/answered' : `other/${index}`,
        state: 'CLOSED',
        headRefOid: index === 0 ? 'answered-head' : `oid-${index}`,
      }))),
    }));
    const calls: string[][] = [];
    const fallback = defineBoundedPrFallback([
      { branch: 'feature/answered', headOid: 'answered-head' },
      { branch: 'feature/first-unknown', headOid: 'first-head' },
      { branch: 'feature/second-unknown', headOid: 'second-head' },
    ], batch, '/repo', (args) => {
      calls.push(args);
      return { status: 0, stdout: args.includes('feature/first-unknown') ? 'MERGED\tfirst-head\n' : '' };
    }, 1);

    expect(calls).toEqual([expect.arrayContaining(['--head', 'feature/first-unknown'])]);
    expect(fallback.states.get(worktreePrCandidateKey('feature/first-unknown', 'first-head'))).toBe('merged');
    expect(fallback.states.has(worktreePrCandidateKey('feature/answered', 'answered-head'))).toBe(false);
    expect(fallback.states.has(worktreePrCandidateKey('feature/second-unknown', 'second-head'))).toBe(false);
    expect(fallback).toMatchObject({ queried: 1, unqueried: 1 });
  });

  it('deduplicates fallback candidates by branch and head OID and never applies a result to another head', () => {
    const batch = queryWorktreePrsBatch('/repo', () => ({
      status: 0,
      stdout: JSON.stringify(Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => ({
        headRefName: `answered/${index}`,
        state: 'CLOSED',
        headRefOid: `answered-head-${index}`,
      }))),
    }));
    const calls: string[][] = [];
    const fallback = defineBoundedPrFallback([
      { branch: 'feature/duplicate', headOid: 'same-head' },
      { branch: 'feature/duplicate', headOid: 'same-head' },
      { branch: 'feature/duplicate', headOid: 'new-head' },
    ], batch, '/repo', (args) => {
      calls.push(args);
      return { status: 0, stdout: 'MERGED\tsame-head\n' };
    }, 1);

    expect(calls).toEqual([expect.arrayContaining(['--head', 'feature/duplicate'])]);
    expect(fallback).toMatchObject({ queried: 1, unqueried: 1 });
    expect(fallback.states.get(worktreePrCandidateKey('feature/duplicate', 'same-head'))).toBe('merged');
    expect(fallback.states.get(worktreePrCandidateKey('feature/duplicate', 'new-head'))).toBeUndefined();
  });

  it('keeps a failed batch as ok:false, distinct from an empty successful list', () => {
    let calls = 0;
    const failed = queryWorktreePrsBatch('/repo', () => {
      calls += 1;
      return { status: 1, stdout: '' };
    });
    const empty = queryWorktreePrsBatch('/repo', () => ({ status: 0, stdout: '[]' }));
    expect(calls).toBe(1);
    expect(failed).toMatchObject({ ok: false, truncated: false });
    expect(empty).toMatchObject({ ok: true, truncated: false });
    expect(worktreePrStateFromBatch('feature/any', 'oid', failed)).toBe('unknown');
    expect(worktreePrStateFromBatch('feature/any', 'oid', empty)).toBe('none');
  });

  it('shares one GitHub lookup across several worktrees without changing PR verdicts', () => {
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-open\0branch refs/heads/feature/open\0\0worktree /wt-merged\0branch refs/heads/feature/merged\0\0worktree /wt-none\0branch refs/heads/feature/none\0\0worktree /wt-uncovered\0branch refs/heads/feature/uncovered\0\0',
          stderr: '',
        };
      }
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) {
        const path = args[1];
        const heads: Record<string, string> = {
          '/wt-open': 'open-head',
          '/wt-merged': 'merged-head',
          '/wt-none': 'none-head',
          '/wt-uncovered': 'new-head',
        };
        return { status: 0, stdout: `${heads[path] ?? 'main-head'}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({
      run,
      runGh: (args) => {
        ghCalls.push(args);
        return {
          status: 0,
          stdout: JSON.stringify([
            { headRefName: 'feature/open', state: 'OPEN', headRefOid: 'open-head' },
            { headRefName: 'feature/merged', state: 'MERGED', headRefOid: 'merged-head' },
            { headRefName: 'feature/uncovered', state: 'MERGED', headRefOid: 'old-head' },
          ]),
        };
      },
    });
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0]).not.toContain('--head');
    expect(report.assessments.map((item) => [item.branch, item.pr])).toEqual([
      ['main', 'none'],
      ['feature/open', 'open'],
      ['feature/merged', 'merged'],
      ['feature/none', 'none'],
      ['feature/uncovered', 'head-uncovered'],
    ]);
    expect(report.assessments[1]).toMatchObject({ disposition: 'do-not-touch', reason: 'open-pr' });
    expect(report.assessments[2]).toMatchObject({ disposition: 'reclaim-safe', reason: 'merged-clean' });
    expect(report.assessments[3]).toMatchObject({ disposition: 'reclaim-safe', reason: 'no-pr-and-no-output' });
    expect(report.assessments[4]).toMatchObject({ disposition: 'needs-human', reason: 'pr-exists-head-uncovered' });
  });

  it('fills truncated-batch unknowns through the bounded fallback without requerying answered branches', () => {
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return {
        status: 0,
        stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-answered\0branch refs/heads/feature/answered\0\0worktree /wt-fallback\0branch refs/heads/feature/fallback\0\0worktree /wt-unqueried\0branch refs/heads/feature/unqueried\0\0',
        stderr: '',
      };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) {
        const heads: Record<string, string> = { '/wt-answered': 'answered-head', '/wt-fallback': 'fallback-head', '/wt-unqueried': 'unqueried-head' };
        return { status: 0, stdout: `${heads[args[1]] ?? 'main-head'}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const rows = Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => ({
      headRefName: index === 0 ? 'feature/answered' : `other/${index}`,
      state: index === 0 ? 'MERGED' : 'CLOSED',
      headRefOid: index === 0 ? 'answered-head' : `oid-${index}`,
    }));
    const report = execHarnessWorktrees({
      run,
      prFallbackLimit: 1,
      runGh: (args) => {
        ghCalls.push(args);
        if (!args.includes('--head')) return { status: 0, stdout: JSON.stringify(rows) };
        return { status: 0, stdout: args.includes('feature/fallback') ? 'MERGED\tfallback-head\n' : '' };
      },
    });

    expect(ghCalls).toHaveLength(2);
    expect(ghCalls.filter((args) => args.includes('--head'))).toEqual([expect.arrayContaining(['feature/fallback'])]);
    expect(report.assessments.map((item) => [item.branch, item.pr])).toEqual([
      ['main', 'unknown'],
      ['feature/answered', 'merged'],
      ['feature/fallback', 'merged'],
      ['feature/unqueried', 'unknown'],
    ]);
    expect(report.prFallback).toEqual({ queried: 1, unqueried: 1 });
    expect(renderHarnessWorktreesReport(report).join('\n')).toContain('PR 재질의 1 · 상한 미질의 1');
  });

  it('executes one fallback per branch/head pair and does not share it with another head', () => {
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'worktree') return {
        status: 0,
        stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-first\0branch refs/heads/feature/shared\0\0worktree /wt-duplicate\0branch refs/heads/feature/shared\0\0worktree /wt-new-head\0branch refs/heads/feature/shared\0\0',
        stderr: '',
      };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) {
        const heads: Record<string, string> = {
          '/wt-first': 'shared-head',
          '/wt-duplicate': 'shared-head',
          '/wt-new-head': 'new-head',
        };
        return { status: 0, stdout: `${heads[args[1]] ?? 'main-head'}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const rows = Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => ({
      headRefName: `answered/${index}`,
      state: 'CLOSED',
      headRefOid: `answered-head-${index}`,
    }));
    const report = execHarnessWorktrees({
      run,
      prFallbackLimit: 1,
      runGh: (args) => {
        ghCalls.push(args);
        return args.includes('--head')
          ? { status: 0, stdout: 'MERGED\tshared-head\n' }
          : { status: 0, stdout: JSON.stringify(rows) };
      },
    });

    expect(ghCalls.filter((args) => args.includes('--head'))).toEqual([expect.arrayContaining(['feature/shared'])]);
    expect(report.prFallback).toEqual({ queried: 1, unqueried: 1 });
    expect(report.assessments.map((item) => [item.path, item.pr])).toEqual([
      ['/repo', 'unknown'],
      ['/wt-first', 'merged'],
      ['/wt-duplicate', 'merged'],
      ['/wt-new-head', 'unknown'],
    ]);
  });

  it('keeps unseen worktrees unknown when the shared lookup hits its declared cap', () => {
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-seen\0branch refs/heads/feature/seen\0\0worktree /wt-unseen\0branch refs/heads/feature/unseen\0\0',
          stderr: '',
        };
      }
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: args[1] === '/wt-seen' ? 'seen-head\n' : 'unseen-head\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const rows = Array.from({ length: WORKTREE_PR_BATCH_LIMIT }, (_, index) => (
      index === 0
        ? { headRefName: 'feature/seen', state: 'MERGED', headRefOid: 'seen-head' }
        : { headRefName: `other/${index}`, state: 'CLOSED', headRefOid: `oid-${index}` }
    ));
    const report = execHarnessWorktrees({
      run,
      runGh: (args) => {
        ghCalls.push(args);
        return { status: 0, stdout: JSON.stringify(rows) };
      },
    });
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls.filter((args) => args.includes('--head'))).toEqual([expect.arrayContaining(['feature/unseen'])]);
    expect(report.prFallback).toEqual({ queried: 1, unqueried: 0 });
    expect(report.assessments.find((item) => item.branch === 'feature/seen')).toMatchObject({ pr: 'merged' });
    expect(report.assessments.find((item) => item.branch === 'feature/unseen')).toMatchObject({ pr: 'unknown' });
    expect(report.assessments.find((item) => item.branch === 'feature/unseen')?.pr).not.toBe('none');
    expect(report.assessments.find((item) => item.branch === 'feature/unseen')).toMatchObject({
      disposition: 'unjudgeable', reason: 'measurement-unavailable',
    });
  });

  it('leaves every worktree unknown when the shared GitHub lookup fails, distinct from none', () => {
    const ghCalls: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: 'worktree /repo\0branch refs/heads/main\0\0worktree /wt-a\0branch refs/heads/feature/a\0\0worktree /wt-b\0branch refs/heads/feature/b\0\0',
          stderr: '',
        };
      }
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'head\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = execHarnessWorktrees({
      run,
      runGh: (args) => {
        ghCalls.push(args);
        return { status: 1, stdout: '' };
      },
    });
    expect(ghCalls).toHaveLength(1);
    expect(report.assessments.map((item) => item.pr)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(report.assessments.every((item) => item.pr !== 'none')).toBe(true);
    expect(report.assessments.slice(1).every((item) => item.disposition === 'unjudgeable')).toBe(true);
  });
});

// ⛔⭐⭐ 진짜 git 으로 문다 — 모의 GitRunner 는 「확장이 꺼진 다중 워크트리」에서 git 이 실제로 무엇을
//    내는지 못 잰다(무인 리뷰 must-fix: *"실제 저장소에서 not-recorded 가 출력되는 통합 회귀"*).
describe('harness worktrees — provenance 부재 판정 (진짜 git)', () => {
  const g = (cwd: string, ...args: string[]): void => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  const realRunner = (args: readonly string[]) => {
    const r = spawnSync('git', args as string[], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('워크트리 config 확장이 «꺼진» 다중 워크트리에서도 read-error 가 아니라 not-recorded 다', () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-provenance-'));
    try {
      const repo = join(root, 'repo');
      g(root, 'init', '-q', '-b', 'main', repo);
      g(repo, 'config', 'user.email', 'test@example.com');
      g(repo, 'config', 'user.name', 'Test');
      writeFileSync(join(repo, 'README.md'), 'x\n');
      g(repo, 'add', '.');
      g(repo, 'commit', '-qm', 'init');
      const linked = join(root, 'linked');
      g(repo, 'worktree', 'add', '-q', linked, '-b', 'feat');

      // ⭐ 전제를 먼저 못 박는다 — 확장이 «실제로» 꺼져 있어야 이 테스트가 의미를 갖는다.
      expect(spawnSync('git', ['-C', linked, 'config', '--get', 'extensions.worktreeConfig'],
        { encoding: 'utf8' }).stdout.trim()).toBe('');
      // ⊕ 그리고 git 이 실제로 «거절»하는지도 — 거절하지 않으면 이 분기가 안 돈다.
      expect(spawnSync('git', ['-C', linked, 'config', '--worktree', '--get', 'elanous.harness.owner'],
        { encoding: 'utf8' }).status).toBe(128);

      const provenance = readWorktreeProvenance(linked, realRunner);
      expect(provenance).toEqual({ owner: 'not-recorded', command: 'not-recorded', createdAt: 'not-recorded' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
