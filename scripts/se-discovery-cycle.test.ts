import { describe, expect, test } from 'bun:test';
import { collectPreexistingRedObservations, planDiscoveryProposals } from './se-discovery-cycle.js';
import { scanPreexistingRed } from '../src/autopilot/discovery/preexisting-red-scan.js';

const target = (dbPath: string) => ({ dbPath });
const baseline = (file: string) => ({ failures: [{ attribution: 'preexisting', file }], baselineFiles: [file], baselineStatus: 'test-fail' });

function collectionFrom(
  rowsByPath: Record<string, readonly { readonly data: unknown; readonly ts: string }[]>,
  failingPaths: readonly string[] = [],
) {
  return collectPreexistingRedObservations({
    resolveTargets: () => ({ targets: Object.keys(rowsByPath).map(target) }),
    pathExists: () => true,
    openStore: (dbPath) => {
      if (failingPaths.includes(dbPath)) throw new Error(`cannot open ${dbPath}`);
      return { query: () => rowsByPath[dbPath]!, close: () => {} };
    },
  });
}

describe('se-discovery-cycle preexisting-red wiring', () => {
  test('반복 접촉 행을 observedAt과 함께 scanner 및 proposal로 전달한다', () => {
    const file = 'src/repeated.test.ts';
    const collected = collectionFrom({
      '/one.db': [{ data: baseline(file), ts: '2026-09-13T00:00:00.000Z' }],
      '/two.db': [{ data: JSON.stringify(baseline(file)), ts: '2026-09-13T01:00:00.000Z' }],
    });
    expect(collected.readableTargets).toBe(2);
    expect(collected.unreadableTargets).toBe(0);
    expect(collected.observations).toEqual([
      { ...baseline(file), observedAt: '2026-09-13T00:00:00.000Z', ts: '2026-09-13T00:00:00.000Z' },
      { ...baseline(file), observedAt: '2026-09-13T01:00:00.000Z', ts: '2026-09-13T01:00:00.000Z' },
    ]);
    const plans = planDiscoveryProposals([], [], scanPreexistingRed(collected.observations));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.seed.source).toBe('preexisting-red');
    expect(plans[0]!.seed.title).toContain('접촉 2');
  });

  test('한 로그 우주가 실패해도 나머지 관측과 읽지 못한 수를 보존한다', () => {
    const collected = collectionFrom({
      '/readable.db': [{ data: baseline('src/survives.test.ts'), ts: '2026-09-13T00:00:00.000Z' }],
      '/broken.db': [],
    }, ['/broken.db']);
    expect(collected.readableTargets).toBe(1);
    expect(collected.unreadableTargets).toBe(1);
    expect(collected.observations).toHaveLength(1);
    expect((collected.observations[0] as { observedAt: string }).observedAt).toBe('2026-09-13T00:00:00.000Z');
  });

  test('후보가 없으면 기존 내부 및 외부 proposal과 3/2 cap이 보존된다', () => {
    const plans = planDiscoveryProposals([
      { path: 'docs/a.md', filename: 'a.md', topic: 'a', date: '2026-01-01', openBoxes: 1, doneBoxes: 0, completionRatio: 0, staleScore: 1, priorityScore: 1, reasons: [] },
      { path: 'docs/b.md', filename: 'b.md', topic: 'b', date: '2026-01-01', openBoxes: 1, doneBoxes: 0, completionRatio: 0, staleScore: 1, priorityScore: 1, reasons: [] },
      { path: 'docs/c.md', filename: 'c.md', topic: 'c', date: '2026-01-01', openBoxes: 1, doneBoxes: 0, completionRatio: 0, staleScore: 1, priorityScore: 1, reasons: [] },
      { path: 'docs/d.md', filename: 'd.md', topic: 'd', date: '2026-01-01', openBoxes: 1, doneBoxes: 0, completionRatio: 0, staleScore: 1, priorityScore: 1, reasons: [] },
    ], [
      { repoKey: 'ref', area: 'one', commits: 1, files: 1, whatChanged: [], score: 2 },
      { repoKey: 'ref', area: 'two', commits: 1, files: 1, whatChanged: [], score: 1 },
      { repoKey: 'ref', area: 'three', commits: 1, files: 1, whatChanged: [], score: 0 },
    ], []);
    expect(plans).toHaveLength(5);
    expect(plans.map(plan => plan.seed.source)).toEqual(['internal-roadmap', 'internal-roadmap', 'internal-roadmap', 'external-repo', 'external-repo']);
  });
});
