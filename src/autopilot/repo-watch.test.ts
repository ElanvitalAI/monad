// Autopilot repo-watch(P1.3) 단위테스트 — 주입 gh/db(무네트워크·인메모리).
import { describe, test, expect } from 'bun:test';
import {
  diffNewCommits, absorptionScore, renderAbsorptionReport,
  openRepoWatchDb, getLastSha, setRepoState, runRepoWatchCycle,
  FIRST_POLL_CAP, WATCHED_REPOS, type CommitInfo, type RunGh,
} from './repo-watch.js';

const C = (sha: string, msg: string): CommitInfo => ({ sha, date: '2026-07-08T00:00:00Z', msg });

describe('diffNewCommits', () => {
  const commits = [C('aaa1', 'newest'), C('bbb2', 'mid'), C('ccc3', 'old')];
  test('last_sha 만나면 그 이전 제외', () => {
    const r = diffNewCommits(commits, 'bbb2');
    expect(r.map(c => c.sha)).toEqual(['aaa1']);
  });
  test('last_sha 없음(첫 폴링) → 상위 CAP', () => {
    const many = Array.from({ length: 10 }, (_, i) => C(`s${i}`, `m${i}`));
    expect(diffNewCommits(many, null).length).toBe(FIRST_POLL_CAP);
  });
  test('모두 새 커밋', () => {
    expect(diffNewCommits(commits, 'zzz9').length).toBe(3);
  });
});

describe('absorptionScore', () => {
  test('관심 키워드 매칭', () => {
    expect(absorptionScore('feat: new agent memory loop')).toBeGreaterThanOrEqual(3);
    expect(absorptionScore('fix typo in readme')).toBe(0);
  });
  test('상한 5', () => {
    expect(absorptionScore('agent loop memory tool plan goal schedule orchestrate reason')).toBe(5);
  });
});

describe('renderAbsorptionReport', () => {
  test('빈 커밋 → null', () => {
    expect(renderAbsorptionReport('codex', 'openai/codex', [])).toBeNull();
  });
  test('흡수 후보 강조', () => {
    const r = renderAbsorptionReport('codex', 'openai/codex', [
      C('a1', 'feat: agent memory loop orchestration'),
      C('b2', 'fix readme'),
    ])!;
    expect(r).toContain('openai/codex');
    expect(r).toContain('흡수');
    expect(r).toContain('a1');
  });
});

describe('상태 db', () => {
  test('setRepoState / getLastSha 왕복', () => {
    const db = openRepoWatchDb(':memory:');
    expect(getLastSha(db, 'openai/codex')).toBeNull();
    setRepoState(db, 'openai/codex', 'abc123', 2, '2026-07-08T00:00:00Z');
    expect(getLastSha(db, 'openai/codex')).toBe('abc123');
    setRepoState(db, 'openai/codex', 'def456', 1, '2026-07-08T01:00:00Z');
    expect(getLastSha(db, 'openai/codex')).toBe('def456'); // upsert
    db.close();
  });
});

describe('runRepoWatchCycle — 주입 gh/db', () => {
  test('전 repo 폴링 + 새 커밋 리포트 + 기록', () => {
    const db = openRepoWatchDb(':memory:');
    const reports: string[] = [];
    const records: any[] = [];
    // 모든 repo 에 대해 동일 커밋 반환하는 mock gh.
    const runGh: RunGh = () => [
      JSON.stringify({ sha: 'head01', date: '2026-07-08T00:00:00Z', msg: 'feat: new agent loop memory' }),
      JSON.stringify({ sha: 'prev02', date: '2026-07-07T00:00:00Z', msg: 'fix bug' }),
    ].join('\n');

    const results = runRepoWatchCycle({
      db, runGh,
      now: () => '2026-07-08T00:00:00Z',
      notify: (r) => reports.push(r),
      record: (r) => records.push(r),
    });

    expect(results.length).toBe(WATCHED_REPOS.length);
    // 첫 폴링이라 모든 repo 에서 새 커밋(2건).
    expect(results.every(r => r.newCommits === 2)).toBe(true);
    expect(reports.length).toBe(WATCHED_REPOS.length);
    expect(records.length).toBe(WATCHED_REPOS.length);
    expect(records[0].outcome).toContain('흡수 후보');

    // 재폴링(동일 head) → 새 커밋 0.
    const again = runRepoWatchCycle({ db, runGh, now: () => '2026-07-08T01:00:00Z' });
    expect(again.every(r => r.newCommits === 0)).toBe(true);
    db.close();
  });

  test('gh 실패(빈 출력) → 새 커밋 0·리포트 없음', () => {
    const db = openRepoWatchDb(':memory:');
    const runGh: RunGh = () => { throw new Error('gh not found'); };
    const results = runRepoWatchCycle({ db, runGh });
    expect(results.every(r => r.newCommits === 0 && r.report === null)).toBe(true);
    db.close();
  });
});
