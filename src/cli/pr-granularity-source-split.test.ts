import { describe, expect, it } from 'bun:test';
import {
  classifyLandingSource,
  computeSourceSplit,
  extractPrNumberFromSubject,
  formatSourceSplitReport,
  type LandingCommit,
  type SourceSplit,
  type SourceSplitBucket,
} from './pr-granularity.js';

function commit(subject: string, files: string[]): LandingCommit {
  return {
    hash: 'abc1234',
    subject,
    files,
    authorEmail: 'dev@example.com',
    committedAtMs: 0,
  };
}

function bucket(count: number, singleFileCount = 0, totalFiles = 0): SourceSplitBucket {
  return { count, singleFileCount, totalFiles };
}

function splitOf(partial: Partial<SourceSplit>): SourceSplit {
  return {
    'no-pr-number': bucket(0),
    unmapped: bucket(0),
    harness: bucket(0),
    human: bucket(0),
    ...partial,
  };
}

describe('extractPrNumberFromSubject', () => {
  it('reads only a trailing (#12345) form and returns null when that shape is absent', () => {
    expect(extractPrNumberFromSubject('pr-cli.ts, pr-cli.test.ts (#13425)')).toBe(13425);
    expect(extractPrNumberFromSubject('괄호 없는 제목')).toBeNull();
  });

  it('does not treat a mid-title (#N) or a title-shaped guess as a PR number', () => {
    expect(extractPrNumberFromSubject('fix (#13425) follow-up')).toBeNull();
    expect(extractPrNumberFromSubject('self-impl/foo: landing')).toBeNull();
    expect(extractPrNumberFromSubject('PR #13425')).toBeNull();
    expect(extractPrNumberFromSubject('feat: foo(13425)')).toBeNull();
  });
});

describe('classifyLandingSource', () => {
  it('returns harness only when the mapped head ref starts with self-impl/', () => {
    expect(
      classifyLandingSource(13425, new Map([[13425, 'self-impl/foo-1234abcd']])),
    ).toBe('harness');
  });

  it('returns human when the mapped head ref is not a self-impl/ prefix', () => {
    expect(classifyLandingSource(13429, new Map([[13429, 't131-docs']]))).toBe('human');
    expect(classifyLandingSource(1, new Map([[1, 'self-impl']]))).toBe('human');
    expect(classifyLandingSource(1, new Map([[1, 'feat/self-impl/foo']]))).toBe('human');
  });

  it('returns no-pr-number when the PR number is missing, even if the map has other entries', () => {
    expect(classifyLandingSource(null, new Map([[1, 'x']]))).toBe('no-pr-number');
  });

  it('returns unmapped, not no-pr-number, when the number is present but absent from the map', () => {
    const source = classifyLandingSource(999, new Map([[1, 'x']]));
    expect(source).toBe('unmapped');
    expect(source).not.toBe('no-pr-number');
  });
});

describe('computeSourceSplit', () => {
  const commits = [
    commit('no number here', ['a.ts']),
    commit('also none', ['b.ts', 'c.ts']),
    commit('plain', ['d.ts']),
    commit('mapped missing (#10)', ['e.ts']),
    commit('mapped missing too (#11)', ['f.ts', 'g.ts']),
    commit('harness one (#20)', ['h.ts']),
    commit('harness two (#21)', ['i.ts', 'j.ts', 'j.ts']),
    commit('human one (#30)', ['k.ts', 'l.ts']),
  ];
  const headRefByPrNumber = new Map<number, string>([
    [20, 'self-impl/foo-1234abcd'],
    [21, 'self-impl/bar'],
    [30, 't131-docs'],
  ]);

  it('aggregates raw count, singleFileCount, and totalFiles independently for all four categories', () => {
    const split = computeSourceSplit(commits, headRefByPrNumber);
    expect(split['no-pr-number']).toEqual({ count: 3, singleFileCount: 2, totalFiles: 4 });
    expect(split.unmapped).toEqual({ count: 2, singleFileCount: 1, totalFiles: 3 });
    expect(split.harness).toEqual({ count: 2, singleFileCount: 1, totalFiles: 3 });
    expect(split.human).toEqual({ count: 1, singleFileCount: 0, totalFiles: 2 });
    for (const bucketValue of Object.values(split)) {
      expect(Object.keys(bucketValue).sort()).toEqual(['count', 'singleFileCount', 'totalFiles']);
    }
  });

  it('does not classify by commit-title shape; only the caller-supplied head-ref map decides harness', () => {
    const split = computeSourceSplit(
      [commit('self-impl/foo: looks like harness but has no PR', ['x.ts'])],
      new Map([[1, 'self-impl/foo']]),
    );
    expect(split['no-pr-number'].count).toBe(1);
    expect(split.harness.count).toBe(0);
    expect(split.human.count).toBe(0);
  });

  it('sends every numbered landing to unmapped when the caller map is empty', () => {
    const split = computeSourceSplit(
      [commit('has a number (#42)', ['a.ts']), commit('no number', ['b.ts'])],
      new Map(),
    );
    expect(split.unmapped.count).toBe(1);
    expect(split['no-pr-number'].count).toBe(1);
    expect(split.harness.count).toBe(0);
    expect(split.human.count).toBe(0);
  });
});

describe('formatSourceSplitReport', () => {
  it('emits the two unclassified causes on separate exact Korean warning lines', () => {
    const lines = formatSourceSplitReport(splitOf({
      'no-pr-number': bucket(3),
      unmapped: bucket(2),
    }));
    const noPrLine = lines.find((line) => line.includes('source-no-pr-number'));
    const unmappedLine = lines.find((line) => line.includes('source-unmapped'));
    expect(noPrLine).toBe(
      '⚠ source-no-pr-number: 착지 3건은 커밋 제목에 PR 번호가 없어 갈래를 판정하지 못했습니다.',
    );
    expect(unmappedLine).toBe(
      '⚠ source-unmapped: 착지 2건은 PR 번호를 읽었으나 그 번호의 브랜치를 조회하지 못했습니다.',
    );
    expect(noPrLine).not.toBe(unmappedLine);
    expect(lines.filter((line) => line.includes('source-no-pr-number'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('source-unmapped'))).toHaveLength(1);
  });

  it('emits only the no-data line without percentages when both classified counts are zero', () => {
    const lines = formatSourceSplitReport(splitOf({
      'no-pr-number': bucket(1),
      unmapped: bucket(1),
    }));
    expect(lines).toContain('판정 불가 — 갈래를 가를 자료가 없습니다.');
    expect(lines.join('\n')).not.toMatch(/%/);
    expect(lines.filter((line) => line.includes('판정 불가'))).toHaveLength(1);
  });

  it('keeps the empty-map path on the no-data rule', () => {
    const split = computeSourceSplit(
      [commit('numbered (#7)', ['a.ts']), commit('unnumbered', ['b.ts'])],
      new Map(),
    );
    const lines = formatSourceSplitReport(split);
    expect(split.harness.count).toBe(0);
    expect(split.human.count).toBe(0);
    expect(lines).toContain(
      '⚠ source-no-pr-number: 착지 1건은 커밋 제목에 PR 번호가 없어 갈래를 판정하지 못했습니다.',
    );
    expect(lines).toContain(
      '⚠ source-unmapped: 착지 1건은 PR 번호를 읽었으나 그 번호의 브랜치를 조회하지 못했습니다.',
    );
    expect(lines).toContain('판정 불가 — 갈래를 가를 자료가 없습니다.');
    expect(lines.join('\n')).not.toMatch(/%/);
  });

  it('emits raw classified sums with percentages when a classified branch exists', () => {
    const lines = formatSourceSplitReport(splitOf({ harness: bucket(1, 1, 1) }));
    expect(lines.some((line) => line.includes('판정 불가'))).toBe(false);
    expect(lines).toContain('harness: 1 (100.0%)  단일 파일 1  파일 합 1');
    expect(lines).toContain('human: 0 (0.0%)  단일 파일 0  파일 합 0');
    expect(lines.join('\n')).toMatch(/%/);
  });

  it('computes classified percentages from harness and human raw counts together', () => {
    const lines = formatSourceSplitReport(splitOf({
      harness: bucket(2, 1, 3),
      human: bucket(1, 0, 4),
    }));
    expect(lines).toContain('harness: 2 (66.7%)  단일 파일 1  파일 합 3');
    expect(lines).toContain('human: 1 (33.3%)  단일 파일 0  파일 합 4');
    expect(lines.some((line) => line.includes('판정 불가'))).toBe(false);
  });

  it('keeps cause warnings beside classified ratio rows and does not emit the no-data line', () => {
    const lines = formatSourceSplitReport(splitOf({
      'no-pr-number': bucket(3),
      unmapped: bucket(2),
      harness: bucket(1, 1, 1),
      human: bucket(1, 0, 2),
    }));
    expect(lines).toContain(
      '⚠ source-no-pr-number: 착지 3건은 커밋 제목에 PR 번호가 없어 갈래를 판정하지 못했습니다.',
    );
    expect(lines).toContain(
      '⚠ source-unmapped: 착지 2건은 PR 번호를 읽었으나 그 번호의 브랜치를 조회하지 못했습니다.',
    );
    expect(lines).toContain('harness: 1 (50.0%)  단일 파일 1  파일 합 1');
    expect(lines).toContain('human: 1 (50.0%)  단일 파일 0  파일 합 2');
    expect(lines.some((line) => line.includes('판정 불가'))).toBe(false);
  });
});
