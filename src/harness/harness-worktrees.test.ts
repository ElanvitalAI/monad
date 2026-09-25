import { describe, expect, it } from 'bun:test';
import {
  assessWorktree,
  execHarnessWorktrees,
  planHarnessWorktrees,
  renderHarnessWorktreesReport,
  type WorktreeAssessmentInput,
  type WorktreeSessionLiveness,
} from './harness-worktrees.js';
import type { WorktreeSession } from '../git-fs/worktree.js';
import type { RunningRunAssessment, RunningRunStatus, RunningRunsResult } from '../self-implement/running-runs.js';

const measured = {
  path: '/repo.worktrees/example',
  branch: 'feature/example',
  uniqueCommitCount: 0,
  changedFileCount: 0,
} as const;

const dirtyNoPr: WorktreeAssessmentInput = {
  ...measured,
  pr: 'none',
  dirty: true,
};

const fourDispositionInputs: WorktreeAssessmentInput[] = [
  { ...measured, path: '/reclaim', pr: 'merged', dirty: false },
  { ...measured, path: '/human-output', pr: 'none', dirty: false, uniqueCommitCount: 2 },
  { ...measured, path: '/open', pr: 'open', dirty: false },
  { path: '/detached', pr: 'unknown' },
];

describe('assessWorktree — stale-owner dirty worktrees need a human', () => {
  it('classifies a dirty no-PR worktree whose owner session is known stale as needs-human with a reason distinct from dirty-worktree', () => {
    expect(assessWorktree({ ...dirtyNoPr, sessionLiveness: 'stale' })).toMatchObject({
      disposition: 'needs-human',
      reason: 'stale-owner-dirty-worktree',
    });
    expect(assessWorktree({ ...dirtyNoPr, sessionLiveness: 'stale' }).reason).not.toBe('dirty-worktree');
  });

  it('keeps a live owner ahead of dirty leftover work as do-not-touch', () => {
    expect(assessWorktree({ ...dirtyNoPr, sessionLiveness: 'live' })).toMatchObject({
      disposition: 'do-not-touch',
      reason: 'owner-session-alive',
    });
  });

  it('keeps unknown owner liveness unjudgeable even when the worktree is dirty', () => {
    expect(assessWorktree({ ...dirtyNoPr, sessionLiveness: 'unknown' })).toMatchObject({
      disposition: 'unjudgeable',
      reason: 'owner-session-liveness-unavailable',
    });
  });

  it('does not rename merged-but-dirty when the owner session is stale', () => {
    expect(assessWorktree({ ...measured, pr: 'merged', dirty: true, sessionLiveness: 'stale' })).toMatchObject({
      disposition: 'needs-human',
      reason: 'merged-but-dirty',
    });
  });

  it('leaves an unmeasured-liveness dirty worktree on the previous dirty-worktree protection', () => {
    expect(assessWorktree(dirtyNoPr)).toMatchObject({
      disposition: 'do-not-touch',
      reason: 'dirty-worktree',
    });
  });
});

describe('planHarnessWorktrees — stale-owner dirty is counted, not reclaimable', () => {
  it('does not widen the reclaim-safe set when a stale-owner dirty worktree is added', () => {
    const before = planHarnessWorktrees(fourDispositionInputs, true);
    const after = planHarnessWorktrees(
      [...fourDispositionInputs, { ...dirtyNoPr, path: '/stale-dirty', sessionLiveness: 'stale' }],
      true,
    );
    expect(before.counts['reclaim-safe']).toBe(1);
    expect(after.counts['reclaim-safe']).toBe(before.counts['reclaim-safe']);
    expect(after.assessments.find((item) => item.path === '/stale-dirty')).toMatchObject({
      disposition: 'needs-human',
      reason: 'stale-owner-dirty-worktree',
    });
    expect(after.rejectedRemoval.map((item) => item.path)).toContain('/stale-dirty');
    expect(after.rejectedRemoval.every((item) => item.disposition !== 'reclaim-safe')).toBe(true);
  });

  it('protects needs-human from removal the same way as do-not-touch', () => {
    const report = planHarnessWorktrees([
      { ...measured, path: '/reclaim', pr: 'merged', dirty: false },
      { ...dirtyNoPr, path: '/stale-dirty', sessionLiveness: 'stale' },
      { ...measured, path: '/open', pr: 'open', dirty: false },
    ], true);
    expect(report.counts['reclaim-safe']).toBe(1);
    expect(report.rejectedRemoval.map((item) => item.path).sort()).toEqual(['/open', '/stale-dirty']);
    expect(report.rejectedRemoval.find((item) => item.path === '/stale-dirty')?.disposition).toBe('needs-human');
    expect(report.rejectedRemoval.find((item) => item.path === '/open')?.disposition).toBe('do-not-touch');
  });

  it('counts the stale-owner dirty classification in the human-readable summary', () => {
    const report = planHarnessWorktrees([
      { ...measured, path: '/reclaim', pr: 'merged', dirty: false },
      { ...dirtyNoPr, path: '/stale-dirty', sessionLiveness: 'stale' },
      { ...measured, path: '/open', pr: 'open', dirty: false },
      { path: '/detached', pr: 'unknown' },
    ]);
    expect(report.counts).toEqual({
      'reclaim-safe': 1,
      'needs-human': 1,
      'do-not-touch': 1,
      unjudgeable: 1,
    });
    const summary = renderHarnessWorktreesReport(report)[1];
    expect(summary).toBe('회수 안전 1 · 사람이 봐야 함 1 · 손대지 않음 1 · 판정 불가 1');
    expect(renderHarnessWorktreesReport(report).join('\n')).toContain('stale-owner-dirty-worktree');
  });

  it('reaches assessWorktree from planHarnessWorktrees without a new caller', () => {
    const input: WorktreeAssessmentInput = { ...dirtyNoPr, path: '/wired', sessionLiveness: 'stale' };
    const planned = planHarnessWorktrees([input]);
    expect(planned.assessments).toEqual([assessWorktree(input)]);
  });
});

const ownerRunAssessment = (runId: string, status: RunningRunStatus): RunningRunAssessment => ({
  runId,
  status,
  presence: 'ledger-without-pty-observed',
  reason: 'test-fixture',
  lifecycle: null,
  lastActivityTimestamp: null,
  ptyUpdatedAt: null,
  ledgerDirectories: [],
  ptyRefs: [],
});

const ownerRunQueryResult = (entries: readonly RunningRunAssessment[]): RunningRunsResult => {
  const counts: Record<RunningRunStatus, number> = { running: 0, 'probable-running': 0, 'ended-unclosed': 0, unknown: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  const observation = { runsNotYetInLedgerDuringAuthoringAreNotCounted: true as const, includesTest: false };
  const countedStatuses = ['running', 'probable-running'] as const;
  return {
    entries,
    counts,
    total: entries.length,
    countedStatuses,
    quantities: {
      counts: { value: counts, population: 'all assessed runs', observation },
      total: { value: entries.length, population: 'all assessed runs', observation },
      entries: { value: entries.length, population: 'all assessed runs', observation },
      running: { value: counts.running + counts['probable-running'], population: 'assessed runs whose status is in countedStatuses', observation },
    },
    observation,
    ledger: {
      ledgerDirectories: [],
      unreadableLedgerCount: 0,
      unreadableLedgerDirectoryCount: 0,
      missingLedgerDirectoryCount: 0,
      unreadableLedgerDirectoryAccessCount: 0,
      indeterminateLedgerDirectoryCount: 0,
    },
    pty: { unreadable: [], observedRefCount: 0, withoutRunIdCount: 0, notCountedRefCount: 0 },
  };
};

const isolatedSessionEnv = {
  sessions: [] as const,
  listPtyManifest: () => [],
};

function worktreeSession(path: string, sessionId: string): WorktreeSession {
  return {
    sessionId,
    worktreePath: path,
    branch: 'feature/example',
    previousCwd: '/repo',
    previousRepoRoot: '/repo',
    enteredAt: 0,
  };
}

function gitWithOwners(owners: Record<string, string>, extraWorktrees = '') {
  return (args: string[]) => {
    if (args[0] === 'worktree') {
      return {
        status: 0,
        stdout: `worktree /repo\0branch refs/heads/main\0\0${extraWorktrees}`,
        stderr: '',
      };
    }
    const path = args[0] === '-C' ? args[1] : undefined;
    if (args.includes('config')) {
      const key = args.at(-1);
      if (key === 'extensions.worktreeConfig') return { status: 0, stdout: 'true\n', stderr: '' };
      if (key === 'monad.harness.owner' && path && owners[path]) return { status: 0, stdout: `${owners[path]}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    }
    if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
    if (args.includes('status') && args.includes('--porcelain')) {
      return { status: 0, stdout: path && path !== '/repo' ? ' M leftover.ts\n' : '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

describe('execHarnessWorktrees — owner run liveness from queryRunningRuns', () => {
  it('classifies a recorded running owner as owner-session-alive', () => {
    const queryRunningRuns = () => ownerRunQueryResult([ownerRunAssessment('run-A', 'running')]);
    const report = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-alive': 'dev:run-A' }, 'worktree /wt-alive\0branch refs/heads/feature/alive\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns,
      ...isolatedSessionEnv,
    });
    expect(report.assessments.find((item) => item.path === '/wt-alive')).toMatchObject({
      owner: 'dev:run-A',
      sessionLiveness: 'live',
      disposition: 'do-not-touch',
      reason: 'owner-session-alive',
    });
  });

  it('classifies a recorded ended owner of a dirty no-PR worktree as needs-human', () => {
    const queryRunningRuns = () => ownerRunQueryResult([ownerRunAssessment('run-B', 'ended-unclosed')]);
    const report = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-ended': 'dev:run-B' }, 'worktree /wt-ended\0branch refs/heads/feature/ended\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns,
      ...isolatedSessionEnv,
    });
    expect(report.assessments.find((item) => item.path === '/wt-ended')).toMatchObject({
      owner: 'dev:run-B',
      dirty: true,
      pr: 'none',
      sessionLiveness: 'stale',
      disposition: 'needs-human',
      reason: 'stale-owner-dirty-worktree',
    });
  });

  it('leaves an unrecorded owner on the previous disposition and reason', () => {
    const withoutOwner = execHarnessWorktrees({
      run: gitWithOwners({}, 'worktree /wt-unrecorded\0branch refs/heads/feature/unrecorded\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => ownerRunQueryResult([]),
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-unrecorded');
    const withQueryNoise = execHarnessWorktrees({
      run: gitWithOwners({}, 'worktree /wt-unrecorded\0branch refs/heads/feature/unrecorded\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => ownerRunQueryResult([ownerRunAssessment('run-A', 'running')]),
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-unrecorded');
    expect(withoutOwner).toMatchObject({ owner: 'not-recorded', disposition: 'do-not-touch', reason: 'dirty-worktree' });
    expect(withoutOwner?.sessionLiveness).toBeUndefined();
    expect(withQueryNoise).toMatchObject({
      owner: withoutOwner?.owner,
      disposition: withoutOwner?.disposition,
      reason: withoutOwner?.reason,
    });
    expect(withQueryNoise?.sessionLiveness).toBe(withoutOwner?.sessionLiveness);
  });

  it('calls queryRunningRuns once per command rather than once per worktree', () => {
    let calls = 0;
    const queryRunningRuns = () => {
      calls += 1;
      return ownerRunQueryResult([
        ownerRunAssessment('run-A', 'running'),
        ownerRunAssessment('run-B', 'ended-unclosed'),
      ]);
    };
    const report = execHarnessWorktrees({
      run: gitWithOwners(
        { '/wt-alive': 'dev:run-A', '/wt-ended': 'dev:run-B' },
        'worktree /wt-alive\0branch refs/heads/feature/alive\0\0worktree /wt-ended\0branch refs/heads/feature/ended\0\0',
      ),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns,
      ...isolatedSessionEnv,
    });
    expect(calls).toBe(1);
    expect(report.assessments.filter((item) => item.path !== '/repo')).toHaveLength(2);
  });

  it('treats a query failure or missing run record as unavailable, never ended', () => {
    const failed = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-failed': 'dev:run-A' }, 'worktree /wt-failed\0branch refs/heads/feature/failed\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => { throw new Error('ledger unreadable'); },
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-failed');
    const missing = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-missing': 'dev:run-A' }, 'worktree /wt-missing\0branch refs/heads/feature/missing\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => ownerRunQueryResult([]),
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-missing');
    const malformed = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-malformed': 'other:run-A' }, 'worktree /wt-malformed\0branch refs/heads/feature/malformed\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => ownerRunQueryResult([ownerRunAssessment('run-A', 'ended-unclosed')]),
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-malformed');
    const unknownStatus = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-unknown': 'dev:run-A' }, 'worktree /wt-unknown\0branch refs/heads/feature/unknown\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => ownerRunQueryResult([ownerRunAssessment('run-A', 'unknown')]),
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-unknown');
    expect(failed).toMatchObject({ disposition: 'do-not-touch', reason: 'dirty-worktree' });
    expect(failed?.sessionLiveness).toBeUndefined();
    expect(missing).toMatchObject({ disposition: 'do-not-touch', reason: 'dirty-worktree' });
    expect(missing?.sessionLiveness).toBeUndefined();
    expect(malformed).toMatchObject({ owner: 'other:run-A', disposition: 'do-not-touch', reason: 'dirty-worktree' });
    expect(malformed?.sessionLiveness).toBeUndefined();
    expect(unknownStatus).toMatchObject({
      sessionLiveness: 'unknown',
      disposition: 'unjudgeable',
      reason: 'owner-session-liveness-unavailable',
    });
    expect([failed, missing, malformed].every((item) => item?.disposition !== 'needs-human')).toBe(true);
  });

  it('does not enlarge the reclaim-safe set when owner-run liveness is supplied', () => {
    const extraWorktrees = [
      'worktree /wt-reclaim',
      'branch refs/heads/feature/reclaim',
      '',
      'worktree /wt-human-output',
      'branch refs/heads/feature/human-output',
      '',
      'worktree /wt-open',
      'branch refs/heads/feature/open',
      '',
      'worktree /wt-alive',
      'branch refs/heads/feature/alive',
      '',
      'worktree /wt-ended',
      'branch refs/heads/feature/ended',
      '',
    ].join('\0');
    const owners: Record<string, string> = {
      '/wt-reclaim': 'dev:run-reclaim',
      '/wt-human-output': 'dev:run-human',
      '/wt-open': 'dev:run-open',
      '/wt-alive': 'dev:run-A',
      '/wt-ended': 'dev:run-B',
    };
    const git = (args: string[]) => {
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: ['worktree /repo', 'branch refs/heads/main', '', extraWorktrees].join('\0'),
          stderr: '',
        };
      }
      const path = args[0] === '-C' ? args[1] : undefined;
      if (args.includes('config')) {
        const key = args.at(-1);
        if (key === 'extensions.worktreeConfig') return { status: 0, stdout: 'true\n', stderr: '' };
        if (key === 'monad.harness.owner' && path && owners[path]) {
          return { status: 0, stdout: `${owners[path]}\n`, stderr: '' };
        }
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${path}-oid\n`, stderr: '' };
      if (args.includes('rev-list')) {
        return { status: 0, stdout: path === '/wt-human-output' ? '2\n' : '0\n', stderr: '' };
      }
      if (args.includes('diff') && args.includes('--name-only')) {
        return { status: 0, stdout: path === '/wt-human-output' ? 'file.ts\0' : '', stderr: '' };
      }
      if (args.includes('status') && args.includes('--porcelain')) {
        return { status: 0, stdout: path === '/wt-ended' || path === '/wt-alive' ? ' M leftover.ts\n' : '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const runGh = () => ({
      status: 0,
      stdout: JSON.stringify([
        { headRefName: 'feature/reclaim', state: 'MERGED', headRefOid: '/wt-reclaim-oid' },
        { headRefName: 'feature/open', state: 'OPEN', headRefOid: '/wt-open-oid' },
      ]),
    });
    const before = execHarnessWorktrees({
      run: git,
      runGh,
      queryRunningRuns: () => { throw new Error('owner-run query withheld'); },
      ...isolatedSessionEnv,
    });
    const after = execHarnessWorktrees({
      run: git,
      runGh,
      queryRunningRuns: () => ownerRunQueryResult([
        ownerRunAssessment('run-reclaim', 'ended-unclosed'),
        ownerRunAssessment('run-human', 'ended-unclosed'),
        ownerRunAssessment('run-open', 'ended-unclosed'),
        ownerRunAssessment('run-A', 'running'),
        ownerRunAssessment('run-B', 'ended-unclosed'),
      ]),
      ...isolatedSessionEnv,
    });
    const reclaimPaths = (report: typeof before) => report.assessments
      .filter((item) => item.disposition === 'reclaim-safe')
      .map((item) => item.path)
      .sort();
    expect(reclaimPaths(after)).toEqual(reclaimPaths(before));
    expect(after.counts['reclaim-safe']).toBe(before.counts['reclaim-safe']);
    expect(after.assessments.find((item) => item.path === '/wt-alive')).toMatchObject({
      sessionLiveness: 'live',
      disposition: 'do-not-touch',
      reason: 'owner-session-alive',
    });
    expect(after.assessments.find((item) => item.path === '/wt-ended')).toMatchObject({
      sessionLiveness: 'stale',
      disposition: 'needs-human',
      reason: 'stale-owner-dirty-worktree',
    });
  });

  it('treats an incomplete query with error observations as unavailable, never ended', () => {
    const complete = ownerRunQueryResult([ownerRunAssessment('run-B', 'ended-unclosed')]);
    const incomplete: RunningRunsResult = {
      ...complete,
      ledger: { ...complete.ledger, unreadableLedgerCount: 1 },
      pty: { ...complete.pty, unreadable: ['prod'] },
    };
    const report = execHarnessWorktrees({
      run: gitWithOwners({ '/wt-incomplete': 'dev:run-B' }, 'worktree /wt-incomplete\0branch refs/heads/feature/incomplete\0\0'),
      runGh: () => ({ status: 0, stdout: '' }),
      queryRunningRuns: () => incomplete,
      ...isolatedSessionEnv,
    }).assessments.find((item) => item.path === '/wt-incomplete');
    expect(report).toMatchObject({
      owner: 'dev:run-B',
      disposition: 'do-not-touch',
      reason: 'dirty-worktree',
    });
    expect(report?.sessionLiveness).toBeUndefined();
    expect(report?.disposition).not.toBe('needs-human');
  });

  it('keeps live and unknown session protection when an ended owner run conflicts', () => {
    const extraWorktrees = [
      'worktree /wt-live',
      'branch refs/heads/feature/live',
      '',
      'worktree /wt-unknown',
      'branch refs/heads/feature/unknown',
      '',
    ].join('\0');
    const owners: Record<string, string> = {
      '/wt-live': 'dev:run-live',
      '/wt-unknown': 'dev:run-unknown',
    };
    const git = (args: string[]) => {
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: ['worktree /repo', 'branch refs/heads/main', '', extraWorktrees].join('\0'),
          stderr: '',
        };
      }
      const path = args[0] === '-C' ? args[1] : undefined;
      if (args.includes('config')) {
        const key = args.at(-1);
        if (key === 'extensions.worktreeConfig') return { status: 0, stdout: 'true\n', stderr: '' };
        if (key === 'monad.harness.owner' && path && owners[path]) {
          return { status: 0, stdout: `${owners[path]}\n`, stderr: '' };
        }
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${path}-oid\n`, stderr: '' };
      if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' };
      if (args.includes('diff') && args.includes('--name-only')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('status') && args.includes('--porcelain')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const runGh = () => ({
      status: 0,
      stdout: JSON.stringify([
        { headRefName: 'feature/live', state: 'MERGED', headRefOid: '/wt-live-oid' },
        { headRefName: 'feature/unknown', state: 'MERGED', headRefOid: '/wt-unknown-oid' },
      ]),
    });
    const sessionByPath: Record<string, WorktreeSessionLiveness> = {
      '/wt-live': 'live',
      '/wt-unknown': 'unknown',
    };
    const shared = {
      run: git,
      runGh,
      sessions: [worktreeSession('/wt-live', 'sess-live'), worktreeSession('/wt-unknown', 'sess-unknown')],
      sessionLiveness: (session: WorktreeSession): WorktreeSessionLiveness => sessionByPath[session.worktreePath] ?? 'stale',
      listPtyManifest: () => [],
    };
    const before = execHarnessWorktrees({
      ...shared,
      queryRunningRuns: () => { throw new Error('owner-run query withheld'); },
    });
    const after = execHarnessWorktrees({
      ...shared,
      queryRunningRuns: () => ownerRunQueryResult([
        ownerRunAssessment('run-live', 'ended-unclosed'),
        ownerRunAssessment('run-unknown', 'ended-unclosed'),
      ]),
    });
    const reclaimPaths = (report: typeof before) => report.assessments
      .filter((item) => item.disposition === 'reclaim-safe')
      .map((item) => item.path)
      .sort();
    expect(before.assessments.find((item) => item.path === '/wt-live')).toMatchObject({
      sessionLiveness: 'live',
      disposition: 'do-not-touch',
      reason: 'owner-session-alive',
    });
    expect(before.assessments.find((item) => item.path === '/wt-unknown')).toMatchObject({
      sessionLiveness: 'unknown',
      disposition: 'unjudgeable',
      reason: 'owner-session-liveness-unavailable',
    });
    expect(after.assessments.find((item) => item.path === '/wt-live')).toMatchObject({
      sessionLiveness: 'live',
      disposition: 'do-not-touch',
      reason: 'owner-session-alive',
    });
    expect(after.assessments.find((item) => item.path === '/wt-unknown')).toMatchObject({
      sessionLiveness: 'unknown',
      disposition: 'unjudgeable',
      reason: 'owner-session-liveness-unavailable',
    });
    expect(reclaimPaths(after)).toEqual(reclaimPaths(before));
    expect(after.counts['reclaim-safe']).toBe(before.counts['reclaim-safe']);
    expect(after.assessments.find((item) => item.path === '/wt-live')?.disposition).not.toBe('reclaim-safe');
    expect(after.assessments.find((item) => item.path === '/wt-unknown')?.disposition).not.toBe('reclaim-safe');
  });
});
