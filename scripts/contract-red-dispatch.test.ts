import { describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchContractRed, eligibilityFromState, executeContractRedDev, exitCodeFor, openContractRedPullRequests, openPullRequestListArgs, OPEN_PULL_REQUEST_LIST_LIMIT, parseDispatchState, pullRequestMarkerFor, readDispatchState, runContractRedDispatchCli, writeDispatchState, type ExecutorRequest } from './contract-red-dispatch.js';
import type { ContractRedFreshnessReport } from './contract-red-freshness.js';

const freshness = (files: ContractRedFreshnessReport['files'], status: ContractRedFreshnessReport['status'] = 'ok'): ContractRedFreshnessReport => ({ status, createdAt: '2026-08-15T00:00:00.000Z', files, candidates: files.length, stillRed: files.filter((file) => file.status === 'still-red').length, nowGreen: files.filter((file) => file.status === 'now-green').length, unmeasurable: files.filter((file) => file.status === 'unmeasurable').length });
const red = (file: string) => ({ file, status: 'still-red' as const, storedFail: 2, currentFail: 1, pass: 3 });
const green = (file: string) => ({ file, status: 'now-green' as const, storedFail: 2, currentFail: 0, pass: 4 });
const unknown = (file: string) => ({ file, status: 'unmeasurable' as const, storedFail: 2, currentFail: null, pass: null, reason: 'remeasurement-failed' as const });
const noOpenPullRequests = async (): Promise<string[]> => [];

async function temporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'contract-red-dispatch-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('contract red dispatch', () => {
  test('calls an injected executor once with literal PR creation enabled and automatic merge disabled', async () => {
    const calls: ExecutorRequest[] = [];
    const result = await dispatchContractRed(freshness([red('z.test.ts')]), { execute: async (request) => { calls.push(request); return { exitCode: 0, stdout: 'opened PR #7', stderr: '' }; } });
    expect(calls).toEqual([{ file: 'z.test.ts', task: 'Fix the currently red contract test file z.test.ts. Open a pull request for the fix, but do not enable automatic merge. Include this exact marker in the pull request body: <!-- contract-red-dispatch:file=z.test.ts -->', pullRequestMarker: '<!-- contract-red-dispatch:file=z.test.ts -->', openPullRequest: true, autoMerge: false }]);
    expect(result).toMatchObject({ status: 'dispatched', failureSource: null, selected: 'z.test.ts', limitReached: false, counts: { candidates: 1, stillRed: 1, nowGreen: 0, unmeasurable: 0, selected: 1, leftBehind: 0, executorCalls: 1 } });
  });

  test('selects the first sorted red candidate, calls once, and records literal left-behind count', async () => {
    const calls: ExecutorRequest[] = [];
    const result = await dispatchContractRed(freshness([red('z.test.ts'), red('a.test.ts'), red('m.test.ts')]), { execute: async (request) => { calls.push(request); return { exitCode: 0, stdout: '', stderr: '' }; } });
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('a.test.ts');
    expect(result).toMatchObject({ status: 'dispatched', selected: 'a.test.ts', limitReached: true, counts: { stillRed: 3, selected: 1, leftBehind: 2, executorCalls: 1 } });
  });

  test('reports a measured zero as no-candidates rather than a failure', async () => {
    let calls = 0;
    const result = await dispatchContractRed(freshness([green('fixed.test.ts')]), { execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; } });
    expect(calls).toBe(0);
    expect(result).toEqual({ status: 'no-candidates', failureSource: null, selected: null, counts: { candidates: 1, stillRed: 0, nowGreen: 1, unmeasurable: 0, selected: 0, leftBehind: 0, executorCalls: 0 }, limitReached: false, executor: null, suppression: null, error: null });
  });

  test('CLI returns measured zero before PR lookup, state reads or writes, and executor invocation', async () => {
    let pullRequestLookups = 0;
    let stateReads = 0;
    let stateWrites = 0;
    let executorCalls = 0;
    const result = await runContractRedDispatchCli('report.json', {
      readFreshness: async () => freshness([green('fixed.test.ts')]),
      openPullRequests: async () => { pullRequestLookups += 1; throw new Error('gh unavailable'); },
      readState: async () => { stateReads += 1; throw new Error('state unavailable'); },
      writeState: async () => { stateWrites += 1; throw new Error('state unavailable'); },
      execute: async () => { executorCalls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
      log: () => {},
    });
    expect(result).toEqual({ status: 'no-candidates', failureSource: null, selected: null, counts: { candidates: 1, stillRed: 0, nowGreen: 1, unmeasurable: 0, selected: 0, leftBehind: 0, executorCalls: 0 }, limitReached: false, executor: null, suppression: null, error: null });
    expect({ pullRequestLookups, stateReads, stateWrites, executorCalls }).toEqual({ pullRequestLookups: 0, stateReads: 0, stateWrites: 0, executorCalls: 0 });
  });

  test('keeps malformed or unmeasurable input separate from executor failure', async () => {
    let calls = 0;
    const preflight = await dispatchContractRed(freshness([red('red.test.ts'), unknown('unknown.test.ts')], 'unmeasurable'), { execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; } });
    const executor = await dispatchContractRed(freshness([red('red.test.ts')]), { execute: async () => ({ exitCode: 1, stdout: '', stderr: 'runner failed' }) });
    expect(calls).toBe(0);
    expect(preflight).toMatchObject({ status: 'preflight-failed', failureSource: 'preflight', counts: { unmeasurable: 1, executorCalls: 0 } });
    expect(executor).toMatchObject({ status: 'executor-failed', failureSource: 'executor', counts: { executorCalls: 1 }, error: 'runner failed' });
  });

  test('CLI converts a thrown freshness read into a preflight result without PR lookup or executor invocation', async () => {
    let pullRequestLookups = 0;
    let executorCalls = 0;
    const result = await runContractRedDispatchCli('report.json', {
      readFreshness: async () => { throw new Error('freshness read failed'); },
      openPullRequests: async () => { pullRequestLookups += 1; return []; },
      execute: async () => { executorCalls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
      log: () => {},
    });
    // ⛔ 신선도를 «못 읽었으면» 그 네 수는 0 이 아니라 null 이다 — 「후보 0개였다」와 구별되어야 한다.
    expect(result).toEqual({ status: 'preflight-failed', failureSource: 'preflight', selected: null, counts: { candidates: null, stillRed: null, nowGreen: null, unmeasurable: null, selected: 0, leftBehind: 0, executorCalls: 0 }, limitReached: false, executor: null, suppression: null, error: 'freshness read failed' });
    expect({ pullRequestLookups, executorCalls }).toEqual({ pullRequestLookups: 0, executorCalls: 0 });
  });

  test('default development adapter waits for its injected process and forces PR without auto-merge flags', async () => {
    const commands: string[][] = [];
    const result = await executeContractRedDev({ file: 'red.test.ts', task: 'task', pullRequestMarker: '<!-- contract-red-dispatch:file=red.test.ts -->', openPullRequest: true, autoMerge: false }, async (command) => { commands.push(command); return { exitCode: 0, stdout: 'completed', stderr: '' }; });
    expect(commands).toHaveLength(1);
    expect(commands[0].slice(1)).toEqual(['bin/monad.mjs', '--test', 'dev', '--open-pr', '--no-auto-merge', '--no-auto-review', 'task']);
    expect(commands[0]).not.toContain('--auto-merge');
    expect(result).toEqual({ exitCode: 0, stdout: 'completed', stderr: '' });
  });

  test.each(['active-run', 'open-pull-request', 'recent-executor-failure'] as const)('CLI derives %s suppression from persisted state and never calls executor', async (reason) => {
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      const statePath = `${reportPath}.dispatch-state.json`;
      const state: { activeFiles: string[]; openPullRequestFiles: string[]; recentExecutorFailureFiles: Record<string, string> } = { activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} };
      if (reason === 'active-run') state.activeFiles = ['red.test.ts'];
      if (reason === 'open-pull-request') state.openPullRequestFiles = ['red.test.ts'];
      if (reason === 'recent-executor-failure') state.recentExecutorFailureFiles = { 'red.test.ts': '2026-08-15T00:00:00.000Z' };
      await writeFile(statePath, JSON.stringify(state));
      let calls = 0;
      const result = await runContractRedDispatchCli(reportPath, { readFreshness: async () => freshness([red('red.test.ts')]), openPullRequests: async (files) => files.filter((file) => state.openPullRequestFiles.includes(file)), execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }, now: () => new Date('2026-08-15T01:00:00.000Z'), log: () => {} });
      expect(calls).toBe(0);
      expect(result).toMatchObject({ status: 'suppressed', selected: 'red.test.ts', suppression: reason, counts: { executorCalls: 0 } });
    });
  });

  test('active-state persistence failure is preflight failure and does not invoke executor', async () => {
    let calls = 0;
    const result = await runContractRedDispatchCli('report.json', {
      readFreshness: async () => freshness([red('red.test.ts')]),
      openPullRequests: noOpenPullRequests,
      readState: async () => ({ activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} }),
      writeState: async () => { throw new Error('state unavailable'); },
      execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
      log: () => {},
    });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: 'preflight-failed', failureSource: 'preflight', counts: { executorCalls: 0 }, error: 'state unavailable' });
  });

  test('CLI persists active-run before invocation then records an open PR after successful single dispatch', async () => {
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      const statePath = `${reportPath}.dispatch-state.json`;
      const observed: string[] = [];
      const result = await runContractRedDispatchCli(reportPath, {
        readFreshness: async () => freshness([red('red.test.ts')]),
        openPullRequests: async () => [],
        execute: async () => { observed.push((parseDispatchState(JSON.parse(await readFile(statePath, 'utf8')))?.activeFiles ?? []).join(',')); return { exitCode: 0, stdout: 'opened', stderr: '' }; },
        log: () => {},
      });
      expect(observed).toEqual(['red.test.ts']);
      expect(result).toMatchObject({ status: 'dispatched', counts: { executorCalls: 1 } });
      expect(parseDispatchState(JSON.parse(await readFile(statePath, 'utf8')))).toEqual({ activeFiles: [], openPullRequestFiles: ['red.test.ts'], recentExecutorFailureFiles: {} });
    });
  });

  test('post-executor persistence failure preserves the executor result and is not preflight', async () => {
    let writes = 0;
    const result = await runContractRedDispatchCli('report.json', {
      readFreshness: async () => freshness([red('red.test.ts')]),
      openPullRequests: noOpenPullRequests,
      readState: async () => ({ activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} }),
      writeState: async () => { writes += 1; if (writes === 3) throw new Error('final state unavailable'); },
      execute: async () => ({ exitCode: 0, stdout: 'opened PR #8', stderr: '' }),
      log: () => {},
    });
    expect(result).toMatchObject({ status: 'state-persist-failed', failureSource: 'postflight', counts: { executorCalls: 1 }, executor: { result: { exitCode: 0, stdout: 'opened PR #8' } }, error: 'final state unavailable' });
  });

  test('recent executor failure expires at the configured cooldown boundary', async () => {
    const state = { activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: { 'red.test.ts': '2026-08-15T00:00:00.000Z' } };
    expect(eligibilityFromState(state, 'red.test.ts', new Date('2026-08-15T00:59:59.999Z'), 3_600_000)).toEqual({ status: 'suppressed', reason: 'recent-executor-failure' });
    expect(eligibilityFromState(state, 'red.test.ts', new Date('2026-08-15T01:00:00.000Z'), 3_600_000)).toEqual({ status: 'eligible' });
  });

  test('CLI records a timestamped executor failure, suppresses it during cooldown, then retries after expiry', async () => {
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      let calls = 0;
      const first = await runContractRedDispatchCli(reportPath, { readFreshness: async () => freshness([red('red.test.ts')]), openPullRequests: noOpenPullRequests, execute: async () => { calls += 1; return { exitCode: 1, stdout: '', stderr: 'failed' }; }, now: () => new Date('2026-08-15T00:00:00.000Z'), cooldownMs: 3_600_000, log: () => {} });
      const second = await runContractRedDispatchCli(reportPath, { readFreshness: async () => freshness([red('red.test.ts')]), openPullRequests: noOpenPullRequests, execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }, now: () => new Date('2026-08-15T00:30:00.000Z'), cooldownMs: 3_600_000, log: () => {} });
      const third = await runContractRedDispatchCli(reportPath, { readFreshness: async () => freshness([red('red.test.ts')]), openPullRequests: noOpenPullRequests, execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }, now: () => new Date('2026-08-15T01:00:00.000Z'), cooldownMs: 3_600_000, log: () => {} });
      expect(calls).toBe(2);
      expect(first).toMatchObject({ status: 'executor-failed', failureSource: 'executor', counts: { executorCalls: 1 } });
      expect(second).toMatchObject({ status: 'suppressed', suppression: 'recent-executor-failure', counts: { executorCalls: 0 } });
      expect(third).toMatchObject({ status: 'dispatched', counts: { executorCalls: 1 } });
    });
  });

  test('default open-PR adapter identifies only OPEN PRs by the stable body marker, not title text', async () => {
    const commands: string[][] = [];
    const open = await openContractRedPullRequests(['open.test.ts', 'closed.test.ts', 'merged.test.ts'], async (command) => {
      commands.push(command);
      return { exitCode: 0, stdout: JSON.stringify([
        { title: 'An unrelated generated title', body: `details\n${pullRequestMarkerFor('open.test.ts')}`, state: 'OPEN' },
        { title: 'Another title', body: pullRequestMarkerFor('closed.test.ts'), state: 'CLOSED' },
        { title: 'Third title', body: pullRequestMarkerFor('merged.test.ts'), state: 'MERGED' },
      ]), stderr: '' };
    });
    expect(commands).toEqual([openPullRequestListArgs()]);
    expect(open).toEqual(['open.test.ts']);
    await expect(openContractRedPullRequests(['open.test.ts'], async () => ({ exitCode: 0, stdout: '{', stderr: '' }))).rejects.toThrow('gh pr list returned malformed JSON');
  });

  test('default open-PR adapter asks gh for a complete snapshot and retains a marker beyond the first 100 rows', async () => {
    const commands: string[][] = [];
    const rows = Array.from({ length: 101 }, (_, index) => ({ body: index === 100 ? pullRequestMarkerFor('late.test.ts') : `unrelated ${index}`, state: 'OPEN' }));
    const open = await openContractRedPullRequests(['late.test.ts'], async (command) => {
      commands.push(command);
      return { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' };
    });
    expect(commands).toEqual([['gh', 'pr', 'list', '--state', 'open', '--limit', String(OPEN_PULL_REQUEST_LIST_LIMIT), '--json', 'body,state']]);
    expect(open).toEqual(['late.test.ts']);
  });

  test('exit code separates the three non-failures from the four failures so a scheduled run cannot record a failure as success', () => {
    expect((['dispatched', 'no-candidates', 'suppressed'] as const).map(exitCodeFor)).toEqual([0, 0, 0]);
    expect((['preflight-failed', 'executor-failed', 'state-persist-failed'] as const).map(exitCodeFor)).toEqual([1, 1, 1]);
  });

  test('an interrupted state write leaves the previous state file intact instead of a half-written one', async () => {
    // ⛔ 이 검사가 무는 것은 「경로에 쓰나」가 «아니라» 「도중에 죽으면 실제 경로가 온전한가」다.
    //   제자리 덮어쓰기면 잘린 본문이 실제 경로에 내려앉아 다음 기동이 malformed 로 읽고 억제를 통째로 잃는다.
    const directory = await mkdtemp(join(tmpdir(), 'contract-red-dispatch-atomic-'));
    try {
      const statePath = join(directory, 'state.json');
      const original = { activeFiles: ['kept.test.ts'], openPullRequestFiles: [], recentExecutorFailureFiles: {} };
      await writeDispatchState(statePath, original);
      expect(await readDispatchState(statePath)).toEqual(original);

      // 「다 쓰기 전에 죽었다」 — 본문을 잘라 쓰고 던진다.
      const interrupted = { activeFiles: ['replaced.test.ts'], openPullRequestFiles: [], recentExecutorFailureFiles: {} };
      await expect(writeDispatchState(statePath, interrupted, async (path, body) => {
        await writeFile(path, body.slice(0, 12));
        throw new Error('interrupted mid-write');
      })).rejects.toThrow('interrupted mid-write');

      // ⭐ 실제 경로는 «옛 내용 그대로»여야 한다 — 읽기가 malformed 로 던지지도 않는다.
      expect(await readDispatchState(statePath)).toEqual(original);
      // ⭐ 그리고 잔해도 «안 남는다» — 임시 경로에 남기면 「반쯤 쓴 파일이 없다」가 실제 경로에서만 참이 된다.
      expect(await access(`${statePath}.writing`).then(() => 'present', () => 'absent')).toBe('absent');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('open-PR adapter treats a row count at the requested limit as truncation instead of a complete snapshot', async () => {
    // 「상한과 같은 수」는 「마침 그만큼」과 「더 있는데 잘렸다」를 구별할 수 없다.
    // ⛔ 상한을 «키우는» 것으로는 이 물음에 답할 수 없다 — 어느 값이든 같은 모호함이 남는다.
    const rows = Array.from({ length: 4 }, (_, index) => ({ body: `unrelated ${index}`, state: 'OPEN' }));
    await expect(openContractRedPullRequests(['late.test.ts'], async () => ({ exitCode: 0, stdout: JSON.stringify(rows), stderr: '' }), 4))
      .rejects.toThrow('gh pr list returned 4 rows at its 4 row limit, so the open pull request snapshot may be truncated');
  });

  test('a truncated open-PR snapshot fails preflight rather than being trusted as an empty suppression set', async () => {
    // 잘린 목록을 「전부」로 읽으면 이미 PR 이 열린 파일에 «또» 발화한다 ⇒ 억제 판정을 안 믿고 멈춘다.
    let executorCalls = 0;
    const rows = Array.from({ length: 2 }, (_, index) => ({ body: `unrelated ${index}`, state: 'OPEN' }));
    const result = await runContractRedDispatchCli('report.json', {
      readFreshness: async () => freshness([red('red.test.ts')]),
      openPullRequests: async (files) => openContractRedPullRequests(files, async () => ({ exitCode: 0, stdout: JSON.stringify(rows), stderr: '' }), 2),
      execute: async () => { executorCalls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
      readState: async () => ({ activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} }),
      writeState: async () => {},
      log: () => {},
    });
    expect(result.status).toBe('preflight-failed');
    expect(result.failureSource).toBe('preflight');
    expect(result.error).toContain('may be truncated');
    expect(executorCalls).toBe(0);
  });

  test('CLI queries open PRs from fresh candidates even with missing state and suppresses a marker-matched PR', async () => {
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      const statePath = `${reportPath}.dispatch-state.json`;
      const commands: string[][] = [];
      let calls = 0;
      const result = await runContractRedDispatchCli(reportPath, {
        readFreshness: async () => freshness([red('red.test.ts')]),
        processRunner: async (command) => {
          commands.push(command);
          return { exitCode: 0, stdout: JSON.stringify([{ title: 'Title can change without losing the dispatch identity', body: `proof ${pullRequestMarkerFor('red.test.ts')}`, state: 'OPEN' }]), stderr: '' };
        },
        execute: async () => { calls += 1; return { exitCode: 0, stdout: 'opened duplicate', stderr: '' }; },
        log: () => {},
      });
      expect(commands).toEqual([openPullRequestListArgs()]);
      expect(calls).toBe(0);
      expect(result).toMatchObject({ status: 'suppressed', selected: 'red.test.ts', suppression: 'open-pull-request', counts: { executorCalls: 0 } });
      expect(parseDispatchState(JSON.parse(await readFile(statePath, 'utf8')))).toEqual({ activeFiles: [], openPullRequestFiles: ['red.test.ts'], recentExecutorFailureFiles: {} });
    });
  });

  test('CLI default PR-state adapter clears closed and merged marker records then dispatches the eligible file once', async () => {
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      const statePath = `${reportPath}.dispatch-state.json`;
      await writeFile(statePath, JSON.stringify({ activeFiles: [], openPullRequestFiles: ['closed.test.ts', 'merged.test.ts'], recentExecutorFailureFiles: {} }));
      const commands: string[][] = [];
      let calls = 0;
      const result = await runContractRedDispatchCli(reportPath, {
        readFreshness: async () => freshness([red('closed.test.ts')]),
        processRunner: async (command) => {
          commands.push(command);
          return { exitCode: 0, stdout: JSON.stringify([
            { title: 'Closed title varies', body: pullRequestMarkerFor('closed.test.ts'), state: 'CLOSED' },
            { title: 'Merged title varies', body: pullRequestMarkerFor('merged.test.ts'), state: 'MERGED' },
          ]), stderr: '' };
        },
        execute: async () => { calls += 1; return { exitCode: 0, stdout: 'opened replacement', stderr: '' }; },
        log: () => {},
      });
      expect(commands).toEqual([openPullRequestListArgs()]);
      expect(calls).toBe(1);
      expect(result).toMatchObject({ status: 'dispatched', selected: 'closed.test.ts', counts: { executorCalls: 1 } });
      expect(parseDispatchState(JSON.parse(await readFile(statePath, 'utf8')))).toEqual({ activeFiles: [], openPullRequestFiles: ['closed.test.ts'], recentExecutorFailureFiles: {} });
    });
  });

  test('state eligibility and malformed state distinguish eligible, suppression, and unavailable preflight', async () => {
    expect(eligibilityFromState({ activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} }, 'red.test.ts')).toEqual({ status: 'eligible' });
    expect(parseDispatchState({ activeFiles: ['red.test.ts'], openPullRequestFiles: [], recentExecutorFailureFiles: {} })).toEqual({ activeFiles: ['red.test.ts'], openPullRequestFiles: [], recentExecutorFailureFiles: {} });
    await temporaryDirectory(async (directory) => {
      const reportPath = join(directory, 'report.json');
      await writeFile(`${reportPath}.dispatch-state.json`, '{}');
      let calls = 0;
      const result = await runContractRedDispatchCli(reportPath, { readFreshness: async () => freshness([red('red.test.ts')]), openPullRequests: noOpenPullRequests, execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }, log: () => {} });
      expect(calls).toBe(0);
      expect(result).toMatchObject({ status: 'preflight-failed', failureSource: 'preflight', counts: { executorCalls: 0 }, error: 'dispatch state is malformed' });
    });
  });
});
