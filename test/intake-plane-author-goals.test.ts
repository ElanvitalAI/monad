import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorIntakeGoals, renderIntakeAuthorOutcomes, type IntakeAuthorDeps } from '../src/intake-plane/author-goals.js';
import type { IntakeCheckItem, IntakeCheckVerdict } from '../src/intake-plane/check.js';

// Names are assembled at run time so this file never matches a repository search for them.
const name = (tag: string) => ['sample', 'gap', tag, 'k4'].join('-');

function item(tag: string, verdict: IntakeCheckVerdict = '없음'): IntakeCheckItem {
  return {
    fact: `monad 에 \`${name(tag)}\` 가 있다`,
    quotes: ['external quote'],
    verdict,
    line: '',
    current: '전수 탐색 0건',
    evidence: [],
    patterns: [`rg -F -e ${name(tag)}`],
    failures: [],
  };
}

function deps(over: Partial<IntakeAuthorDeps> = {}): IntakeAuthorDeps & { asks: string[] } {
  const asks: string[] = [];
  return {
    asks,
    root: '/repo-root-unused',
    listGoalDocs: () => [],
    author: async (ask) => {
      asks.push(ask);
      return { path: `docs/goals/GOAL-${asks.length}.md`, document: `goal ${asks.length}` };
    },
    lintErrors: () => 0,
    log: () => {},
    ...over,
  };
}

test('a gap with no existing goal is authored with its path and lint error count', async () => {
  const d = deps({ lintErrors: () => 2 });
  const outcomes = await authorIntakeGoals([item('a')], d, { source: 'note.md' });
  expect(outcomes).toEqual([{ fact: item('a').fact, status: 'authored', goalPath: 'docs/goals/GOAL-1.md', lintErrors: 2 }]);
  expect(d.asks[0]?.split('\n')[0]).toBe(item('a').fact);
  expect(d.asks[0]?.split('\n')[1]).toBe(`제목: ${item('a').fact}`);
  expect(d.asks[0]).toContain('external quote');
  expect(d.asks[0]).toContain('그 문자열이 저장소에 생기는 것을 판정 신호로 삼지 말고');
});

test('a gap whose names are all in an existing goal is already planned and not authored', async () => {
  const d = deps({ listGoalDocs: () => [{ path: 'docs/goals/ASK-existing.md', text: `plans ${name('a')} already` }] });
  const outcomes = await authorIntakeGoals([item('a')], d, { source: 'note.md' });
  expect(outcomes).toEqual([{ fact: item('a').fact, status: 'already-planned', goalPath: 'docs/goals/ASK-existing.md' }]);
  expect(d.asks).toEqual([]);
});

test('gaps beyond the cap are reported over-cap instead of authored', async () => {
  const d = deps();
  const outcomes = await authorIntakeGoals([item('a'), item('b'), item('c')], d, { source: 'note.md', max: 2 });
  expect(outcomes.map((row) => row.status)).toEqual(['authored', 'authored', 'over-cap']);
  expect(d.asks).toHaveLength(2);
});

test('only 없음 items reach the author', async () => {
  const d = deps();
  const outcomes = await authorIntakeGoals([item('a', '있음'), item('b', '판단 필요'), item('c', '못 쟀다')], d, { source: 'note.md' });
  expect(outcomes).toEqual([]);
  expect(d.asks).toEqual([]);
});

test('an author failure is recorded for that gap and the rest continue', async () => {
  let calls = 0;
  const d = deps({
    author: async () => {
      calls++;
      if (calls === 1) throw new Error('author exploded');
      return { path: 'docs/goals/GOAL-ok.md', document: 'ok' };
    },
  });
  const outcomes = await authorIntakeGoals([item('a'), item('b')], d, { source: 'note.md' });
  expect(outcomes.map((row) => row.status)).toEqual(['author-failed', 'authored']);
  expect(outcomes[0]?.reason).toBe('author exploded');
  expect(renderIntakeAuthorOutcomes(outcomes)).toContain('저작 실패');
  expect(renderIntakeAuthorOutcomes(outcomes)).toContain('lint ERROR 0 (발사 가능)');
});

test('the default duplicate lookup reads the same goal directory the author writes to', async () => {
  // A repository without docs/goals keeps goals under the gitignored .monad/goals (resolveGoalDocumentsDir).
  const root = mkdtempSync(join(tmpdir(), 'intake-author-dir-'));
  try {
    mkdirSync(join(root, '.monad', 'goals'), { recursive: true });
    writeFileSync(join(root, '.monad', 'goals', 'ASK-existing.md'), `plans ${name('a')} already\n`);
    const d = deps({ root });
    delete (d as { listGoalDocs?: unknown }).listGoalDocs;
    const outcomes = await authorIntakeGoals([item('a')], d, { source: 'note.md' });
    expect(outcomes[0]?.status).toBe('already-planned');
    expect(outcomes[0]?.goalPath).toBe(join('.monad', 'goals', 'ASK-existing.md'));
    expect(d.asks).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
