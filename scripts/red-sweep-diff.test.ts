import { describe, expect, test } from 'bun:test';
import { diffLatestPerScope, parseSweepLog, renderDiff } from './red-sweep-diff.js';

const report = (at: string, axes: string[], red: string[], green: string[] = []) => JSON.stringify({
  createdAt: at, status: 'ok', scope: { axes },
  files: [...red.map((file) => ({ file, status: 'red' })), ...green.map((file) => ({ file, status: 'green' }))],
});

describe('red-sweep-diff', () => {
  test('compares the latest two reports of the same scope only, naming new reds and recoveries', () => {
    const log = [
      'cron-run: started',
      report('2026-09-23T22:20:00Z', ['src/a'], ['/r/monad-agent/src/a/x.test.ts', '/r/monad-agent/src/a/y.test.ts']),
      report('2026-09-24T16:30:00Z', ['src', 'test'], ['/r/monad-agent/test/z.test.ts']),
      report('2026-09-24T22:20:00Z', ['src/a'], ['/r/monad-agent/src/a/y.test.ts', '/r/monad-agent/src/a/w.test.ts'], ['/r/monad-agent/src/a/x.test.ts']),
      'not json',
    ].join('\n');
    const reports = parseSweepLog(log);
    expect(reports).toHaveLength(3);
    const diffs = diffLatestPerScope(reports);
    expect(diffs).toHaveLength(1);   // src,test 범위는 한 판뿐이라 비교 못 함
    expect(diffs[0]).toMatchObject({ newRed: ['/r/monad-agent/src/a/w.test.ts'], recovered: ['/r/monad-agent/src/a/x.test.ts'], stillRed: 1 });
    const text = renderDiff(diffs[0]!);
    expect(text).toContain('🔴 새로: src/a/w.test.ts');
    expect(text).toContain('🟢 회복: src/a/x.test.ts');
  });

  test('fewer than two reports of a scope yields no diff (the caller reports «못 쟀다»)', () => {
    expect(diffLatestPerScope(parseSweepLog(report('2026-09-24T01:00:00Z', ['src'], ['/a.test.ts'])))).toEqual([]);
  });
});
