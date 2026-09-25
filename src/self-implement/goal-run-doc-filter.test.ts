import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoalRunStore, parseGoalRunDocFilter, parseGoalRunDocPath } from './goal-run-store.js';
import type { GoalExecutionRecord } from './orchestrator.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function freshStore(): { store: GoalRunStore; goalFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'goal-run-doc-filter-'));
  dirs.push(directory);
  const goalFile = join(directory, 'GOAL-test.txt');
  writeFileSync(goalFile, 'Test goal\n- GoalId: 0123456789abcdef\n');
  return { store: new GoalRunStore(join(directory, 'self-implement', 'goal-runs.db')), goalFile };
}

describe('parseGoalRunDocFilter — 순수 파서', () => {
  it('`$.` 를 안 써도 붙여 준다', () => {
    expect(parseGoalRunDocFilter('completionIntent=auto-merge')).toEqual({ path: '$.completionIntent', value: 'auto-merge' });
  });

  it('중첩 경로와 배열 첨자를 읽는다', () => {
    expect(parseGoalRunDocFilter('$.quotaAccountAvailability.to=team').path).toBe('$.quotaAccountAvailability.to');
    expect(parseGoalRunDocFilter('siblingShardIds[0]=task:a').path).toBe('$.siblingShardIds[0]');
  });

  it('⭐ true/false 를 SQLite 표현(1/0)으로 바꾼다 — 안 그러면 «조용히 0건»이 된다', () => {
    expect(parseGoalRunDocFilter('ok=true').value).toBe('1');
    expect(parseGoalRunDocFilter('ok=false').value).toBe('0');
  });

  it('⛔ 그 밖의 값은 «안 건드린다»', () => {
    expect(parseGoalRunDocFilter('outcome=completed').value).toBe('completed');
    expect(parseGoalRunDocFilter('rounds=2').value).toBe('2');
    expect(parseGoalRunDocFilter('note=a=b').value).toBe('a=b');   // 첫 `=` 만 가른다
  });

  it('⛔ 못 읽으면 «던진다» — 조용히 무시하면 사용자가 「걸었다」고 믿고 전수를 본다', () => {
    expect(() => parseGoalRunDocFilter('completionIntent')).toThrow();
    expect(() => parseGoalRunDocFilter('=x')).toThrow();
    expect(() => parseGoalRunDocFilter('bad path=x')).toThrow();
    expect(() => parseGoalRunDocFilter("a'; DROP TABLE goal_run; --=x")).toThrow();
  });
});

describe('doc 필터가 실제 질의에 걸린다 (배선)', () => {
  const rec = (runId: string, over: Partial<GoalExecutionRecord> = {}): GoalExecutionRecord => ({
    runId, stage: 'pr-opened', outcome: 'completed', ok: true,
    startedAt: '2026-08-08T00:00:00.000Z', rounds: 1, model: 'test-model', ...over,
  });

  it('⭐ 생성 컬럼이 «아닌» 칸으로 센다', () => {
    const { store, goalFile } = freshStore();
    store.insert(goalFile, rec('run-a', { completionIntent: 'auto-merge' }));
    store.insert(goalFile, rec('run-b', { completionIntent: 'not-auto-merge' }));
    store.insert(goalFile, rec('run-c', { completionIntent: 'auto-merge' }));
    store.insert(goalFile, rec('run-d'));                            // 칸 자체가 없다

    const hit = store.query({ docFilters: [parseGoalRunDocFilter('completionIntent=auto-merge')], limit: 50 });
    expect(hit?.total).toBe(2);
    expect(hit?.records.map((r) => r.record.runId).sort()).toEqual(['run-a', 'run-c']);
    // ⛔ 칸이 «없는» 레코드는 어느 값에도 안 걸린다 — 「모른다」를 「아니다」로 세지 않는다
    expect(store.query({ docFilters: [parseGoalRunDocFilter('completionIntent=not-auto-merge')], limit: 50 })?.total).toBe(1);
    store.close();
  });

  it('중첩 칸과 «수» 칸도 걸린다 — 텍스트 캐스팅이 그것을 가능케 한다', () => {
    const { store, goalFile } = freshStore();
    store.insert(goalFile, rec('run-x', { rounds: 3, quotaAccountAvailability: { reason: 'rotated', candidateCount: 2, to: 'team' } }));
    store.insert(goalFile, rec('run-y', { rounds: 3, quotaAccountAvailability: { reason: 'no-candidate', candidateCount: 0 } }));
    expect(store.query({ docFilters: [parseGoalRunDocFilter('quotaAccountAvailability.to=team')], limit: 50 })?.total).toBe(1);
    expect(store.query({ docFilters: [parseGoalRunDocFilter('rounds=3')], limit: 50 })?.total).toBe(2);
    store.close();
  });

  it('여럿 주면 AND 로 좁힌다 ⊕ 기존 필터와 «같이» 걸린다', () => {
    const { store, goalFile } = freshStore();
    store.insert(goalFile, rec('run-1', { completionIntent: 'auto-merge', rounds: 1 }));
    store.insert(goalFile, rec('run-2', { completionIntent: 'auto-merge', rounds: 2 }));
    store.insert(goalFile, rec('run-3', { completionIntent: 'auto-merge', rounds: 2, outcome: 'abandoned', ok: false }));
    const both = store.query({
      docFilters: [parseGoalRunDocFilter('completionIntent=auto-merge'), parseGoalRunDocFilter('rounds=2')],
      outcome: 'completed', limit: 50,
    });
    expect(both?.total).toBe(1);
    expect(both?.records[0]?.record.runId).toBe('run-2');
    store.close();
  });
});

describe('docPresent — 「그 칸이 «있나»」', () => {
  const rec = (runId: string, over: Partial<GoalExecutionRecord> = {}): GoalExecutionRecord => ({
    runId, stage: 'pr-opened', outcome: 'completed', ok: true,
    startedAt: '2026-08-08T00:00:00.000Z', rounds: 1, model: 'test-model', ...over,
  });

  it('⭐ 값을 모르고도 «흐르는지»를 센다 — 이것이 `F12` 탐지의 자다', () => {
    const { store, goalFile } = freshStore();
    store.insert(goalFile, rec('run-a', { orchestrationId: 'orch-1' }));
    store.insert(goalFile, rec('run-b', { orchestrationId: 'orch-2' }));
    store.insert(goalFile, rec('run-c'));
    expect(store.query({ docPresent: [parseGoalRunDocPath('orchestrationId')], limit: 50 })?.total).toBe(2);
    expect(store.query({ docPresent: [parseGoalRunDocPath('completionIntent')], limit: 50 })?.total).toBe(0);
    store.close();
  });

  it('여럿이면 AND ⊕ 값 필터·기존 필터와 «같이» 걸린다', () => {
    const { store, goalFile } = freshStore();
    store.insert(goalFile, rec('run-1', { orchestrationId: 'o', completionIntent: 'auto-merge' }));
    store.insert(goalFile, rec('run-2', { orchestrationId: 'o' }));
    expect(store.query({
      docPresent: [parseGoalRunDocPath('orchestrationId'), parseGoalRunDocPath('completionIntent')],
      docFilters: [parseGoalRunDocFilter('completionIntent=auto-merge')],
      outcome: 'completed', limit: 50,
    })?.total).toBe(1);
    store.close();
  });

  it('⛔ 경로 해석은 값 필터와 «같은 자»를 쓴다 — 둘로 갈리면 한쪽만 고쳐 조용히 어긋난다', () => {
    expect(parseGoalRunDocPath('quotaAccountAvailability.to')).toBe('$.quotaAccountAvailability.to');
    expect(parseGoalRunDocPath('quotaAccountAvailability.to')).toBe(parseGoalRunDocFilter('quotaAccountAvailability.to=x').path);
    expect(() => parseGoalRunDocPath('bad path')).toThrow();
  });
});
