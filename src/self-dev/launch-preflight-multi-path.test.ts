import { describe, expect, test } from 'bun:test';
import { decideAskPreflight, type AskPreflightDeps } from './launch-preflight.js';

describe('decideAskPreflight multi-path terminal ledger scopes', () => {
  test('passes every declared ask target to completed and interrupted lookups', () => {
    const completedCalls: Array<string | readonly string[] | undefined> = [];
    const interruptedCalls: Array<string | readonly string[] | undefined> = [];
    const deps: AskPreflightDeps = {
      readGoalDocument: () => 'goal',
      tracedPaths: () => [],
      listOpenPrs: () => [],
      listUnfinishedRuns: () => [],
      queryRunningRuns: () => { throw new Error('not needed by multi-path lookup test'); },
      listCompletedRuns: (_limit, paths) => {
        completedCalls.push(paths);
        return {
          entries: [
            { runId: 'completed-a', plannedPaths: ['src/a.ts'], ledgerDirectory: '/ledger' },
            { runId: 'completed-b', plannedPaths: ['src/b.test.ts'], ledgerDirectory: '/ledger' },
          ],
          unreadableRuns: 0,
        };
      },
      listInterruptedRuns: (_limit, paths) => {
        interruptedCalls.push(paths);
        return {
          entries: [
            { runId: 'interrupted-a', plannedPaths: ['src/a.ts'], interruptionReason: 'failed', ledgerDirectory: '/ledger' },
            { runId: 'interrupted-b', plannedPaths: ['src/b.test.ts'], interruptionReason: 'failed', ledgerDirectory: '/ledger' },
          ],
          unreadableRuns: 0,
        };
      },
      countRecentChanges: () => ({ 'src/a.ts': 0, 'src/b.test.ts': 0 }),
      listPreexistingFailureTestFiles: () => ({ state: 'checked', files: [] }),
    };

    const decision = decideAskPreflight({
      goalFile: '',
      pathsOverride: ['src/a.ts', 'src/b.test.ts'],
      liveRunWindowMinutes: 30,
      recentChangeWindowDays: 7,
    }, deps, false);

    expect(completedCalls).toEqual([['src/a.ts', 'src/b.test.ts']]);
    expect(interruptedCalls).toEqual([['src/a.ts', 'src/b.test.ts']]);
    expect(decision.result.completedRunMatches.map(({ runId }) => runId)).toEqual(['completed-a', 'completed-b']);
    expect(decision.result.interruptedRunMatches.map(({ runId }) => runId)).toEqual(['interrupted-a', 'interrupted-b']);
  });
});
