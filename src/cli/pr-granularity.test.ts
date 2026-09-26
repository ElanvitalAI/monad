import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerPrCommands, runPrGranularity } from './pr-cli.js';
import {
  TOP_PREFIX_COUNT_LIMIT,
  TOP_REPEATED_FILE_LIMIT,
  UNEXTRACTABLE_COMMIT_TITLE_PREFIX,
  classifySingleFilePath,
  collectBaseLandingCommits,
  computeGranularityStats,
  countRecentLandings,
  countRecentLandingsByAuthor,
  extractCommitTitlePrefix,
  formatGranularityReport,
  formatOverlapAdvisory,
  formatRecentLandingRateAdvisory,
  landingHistoryLogArgs,
  overlapWithCurrentChanges,
  parseCommitNameLog,
  previousLandingSummary,
  computeLineageStats,
  formatLineageReport,
  type LandingCommit,
  type LineageGroup,
  type LineageStats,
} from './pr-granularity.js';

function lineageFixture(partial: {
  groups?: readonly LineageGroup[];
  groupedLandings?: number;
  goalGroups?: readonly LineageGroup[];
  pathGroups?: readonly LineageGroup[];
  goalGroupedLandings?: number;
  pathGroupedLandings?: number;
  branchUnknown?: number;
  noPrNumber?: number;
  outsideLookupWindow?: number;
  unmatchedPr?: number;
}): LineageStats {
  const goalGroups = partial.goalGroups ?? partial.groups ?? [];
  const pathGroups = partial.pathGroups ?? [];
  const goalGroupedLandings = partial.goalGroupedLandings ?? partial.groupedLandings ?? 0;
  return {
    goalGroups,
    pathGroups,
    groups: goalGroups,
    groupedLandings: goalGroupedLandings,
    goalGroupedLandings,
    pathGroupedLandings: partial.pathGroupedLandings ?? 0,
    branchUnknown: partial.branchUnknown ?? 0,
    noPrNumber: partial.noPrNumber ?? 0,
    outsideLookupWindow: partial.outsideLookupWindow ?? 0,
    unmatchedPr: partial.unmatchedPr ?? 0,
  };
}

function hashAt(index: number): string {
  return `${(index + 10).toString(16).padStart(2, '0')}`.repeat(20);
}

function landing(subject: string, path: string, index: number): string {
  return [`commit ${hashAt(index)} ${subject}`, path, ''].join('\n');
}

const sampleLog = [
  'commit aaa111bbb222ccc333ddd444eee555fff666aaa',
  'docs/topic.md',
  '',
  'commit bbb222ccc333ddd444eee555fff666aaa111bbb',
  'docs/topic.md',
  'src/cli/pr-cli.ts',
  '',
  'commit ccc333ddd444eee555fff666aaa111bbb222ccc',
  'docs/topic.md',
].join('\n');

describe('pr-granularity statistics', () => {
  it('counts landings, single-file ratio, and per-file frequencies', () => {
    const commits = parseCommitNameLog(sampleLog);
    const stats = computeGranularityStats(commits);
    expect(stats.landingCount).toBe(3);
    expect(stats.singleFileLandingCount).toBe(2);
    expect(stats.singleFileLandingRatio).toBeCloseTo(2 / 3);
    expect(stats.prefixFrequencies).toEqual([{ prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 3 }]);
    expect(stats.fileFrequencies).toEqual([
      { path: 'docs/topic.md', count: 3, prefixes: [{ prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 3 }] },
      { path: 'src/cli/pr-cli.ts', count: 1, prefixes: [] },
    ]);
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain('착지 수: 3');
    expect(report).toContain('단일 파일 착지: 2 (66.7%)');
    expect(report).toContain(`착지 앞머리: ${UNEXTRACTABLE_COMMIT_TITLE_PREFIX} 3`);
    expect(report).toContain('docs/topic.md  3');
  });

  it('says the empty window is unmeasurable instead of printing a 0 ratio', () => {
    const stats = computeGranularityStats([]);
    expect(stats.landingCount).toBe(0);
    expect(stats.singleFileLandingRatio).toBeNull();
    expect(stats.prefixFrequencies).toEqual([]);
    const lines = formatGranularityReport(stats, '1 day ago');
    const ratioLine = lines.find((line) => line.includes('비율') || line.startsWith('단일 파일 착지'));
    expect(ratioLine).toBe('단일 파일 착지 비율: 측정할 수 없음 — 이 창에 착지가 없습니다.');
    expect(ratioLine).not.toMatch(/\b0(\.0)?%?\b/);
    expect(lines.join('\n')).toContain('측정할 수 없음');
    expect(lines.join('\n')).not.toContain(UNEXTRACTABLE_COMMIT_TITLE_PREFIX);
    expect(lines.some((line) => line.includes('착지 앞머리'))).toBe(false);
    expect(lines.some((line) => line.includes('같은 파일을 여러 착지가 건드린 상위'))).toBe(false);
  });

  it('counts two title prefixes on a selected repeated file, higher count first', () => {
    const commits = parseCommitNameLog([
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa docs(🅢): first',
      'docs/topic.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb feat(cli): second',
      'docs/topic.md',
      '',
      'commit ccc333ddd444eee555fff666aaa111bbb222ccc docs(🅢): third',
      'docs/topic.md',
    ].join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.prefixFrequencies).toEqual([
      { prefix: 'docs(🅢)', count: 2 },
      { prefix: 'feat(cli)', count: 1 },
    ]);
    expect(stats.fileFrequencies[0]).toEqual({
      path: 'docs/topic.md',
      count: 3,
      prefixes: [
        { prefix: 'docs(🅢)', count: 2 },
        { prefix: 'feat(cli)', count: 1 },
      ],
    });
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain('착지 앞머리: docs(🅢) 2, feat(cli) 1');
    expect(report).toContain('docs/topic.md  3  docs(🅢) 2, feat(cli) 1');
    expect(report.indexOf('docs(🅢) 2')).toBeLessThan(report.indexOf('feat(cli) 1'));
  });

  it('prints a single shared prefix when every landing of a file uses it', () => {
    const commits = parseCommitNameLog([
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa docs(🅢): first',
      'docs/topic.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb docs(🅢): second',
      'docs/topic.md',
    ].join('\n'));
    const report = formatGranularityReport(computeGranularityStats(commits), '1 day ago').join('\n');
    expect(report).toContain('착지 앞머리: docs(🅢) 2');
    expect(report).toContain('docs/topic.md  2  docs(🅢) 2');
    expect(report).not.toContain(',');
  });

  it('keeps unextractable prefixes distinct from 해당 없음, zero, and empty', () => {
    expect(extractCommitTitlePrefix('plain landing')).toBeNull();
    expect(UNEXTRACTABLE_COMMIT_TITLE_PREFIX).not.toBe('해당 없음');
    expect(UNEXTRACTABLE_COMMIT_TITLE_PREFIX).not.toBe('0');
    expect(UNEXTRACTABLE_COMMIT_TITLE_PREFIX.length).toBeGreaterThan(0);
    const commits = parseCommitNameLog([
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa plain landing',
      'docs/topic.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb another prose title',
      'docs/topic.md',
    ].join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.prefixFrequencies).toEqual([
      { prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 2 },
    ]);
    expect(stats.fileFrequencies[0]?.prefixes).toEqual([
      { prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 2 },
    ]);
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain(`착지 앞머리: ${UNEXTRACTABLE_COMMIT_TITLE_PREFIX} 2`);
    expect(report).toContain(`docs/topic.md  2  ${UNEXTRACTABLE_COMMIT_TITLE_PREFIX} 2`);
    expect(report).not.toContain('해당 없음');
    expect(report).not.toMatch(/docs\/topic\.md  2\s*$/m);
    expect(report).not.toMatch(/docs\/topic\.md  2  0/);
  });

  it('extracts unscoped 타입: as the token before the colon and leaves the body out', () => {
    expect(extractCommitTitlePrefix('test: elanous-config-dir.test.ts (#13663)')).toBe('test');
    expect(extractCommitTitlePrefix('src/self-implement: gate-baseline.ts, … (#13665)')).toBe('src/self-implement');
    expect(extractCommitTitlePrefix('docs: no-scope')).toBe('docs');
  });

  it('does not extract colonless prose titles', () => {
    expect(extractCommitTitlePrefix('tsc 게이트가 「변경 파일」만 봐서 눈이 멀었다 (#13746)')).toBeNull();
    expect(extractCommitTitlePrefix('plain landing')).toBeNull();
  });

  it('keeps scoped 타입(범위) extraction identical to the previous string', () => {
    expect(extractCommitTitlePrefix('docs(🅢): first')).toBe('docs(🅢)');
    expect(extractCommitTitlePrefix('feat(cli): second')).toBe('feat(cli)');
  });

  it('separates scoped 타입(범위), unscoped 타입, and prose into three prefix buckets', () => {
    const commits = parseCommitNameLog([
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa docs(🅢): first',
      'docs/topic.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb test: elanous-config-dir.test.ts (#13663)',
      'docs/topic.md',
      '',
      'commit ccc333ddd444eee555fff666aaa111bbb222ccc tsc 게이트가 「변경 파일」만 봐서 눈이 멀었다 (#13746)',
      'docs/topic.md',
    ].join('\n'));
    const stats = computeGranularityStats(commits);
    expect(extractCommitTitlePrefix(commits[0]!.subject)).toBe('docs(🅢)');
    expect(extractCommitTitlePrefix(commits[1]!.subject)).toBe('test');
    expect(extractCommitTitlePrefix(commits[2]!.subject)).toBeNull();
    expect(stats.prefixFrequencies).toEqual([
      { prefix: 'docs(🅢)', count: 1 },
      { prefix: 'test', count: 1 },
      { prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 1 },
    ]);
    expect(stats.fileFrequencies[0]?.prefixes).toEqual([
      { prefix: 'docs(🅢)', count: 1 },
      { prefix: 'test', count: 1 },
      { prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 1 },
    ]);
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain('착지 앞머리: docs(🅢) 1, test 1, 앞머리 미추출 1');
    expect(report).toContain(`docs/topic.md  3  docs(🅢) 1, test 1, ${UNEXTRACTABLE_COMMIT_TITLE_PREFIX} 1`);
  });

  it('does not attach prefix counts to files outside the selected repeated list', () => {
    const commits = parseCommitNameLog([
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa docs(🅢): first',
      'docs/topic.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb feat(cli): once',
      'src/cli/pr-cli.ts',
      '',
      'commit ccc333ddd444eee555fff666aaa111bbb222ccc docs(🅢): third',
      'docs/topic.md',
    ].join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.prefixFrequencies).toEqual([
      { prefix: 'docs(🅢)', count: 2 },
      { prefix: 'feat(cli)', count: 1 },
    ]);
    expect(stats.fileFrequencies.map((entry) => entry.path)).toEqual(['docs/topic.md', 'src/cli/pr-cli.ts']);
    expect(stats.fileFrequencies[0]?.prefixes).toEqual([{ prefix: 'docs(🅢)', count: 2 }]);
    expect(stats.fileFrequencies[1]).toEqual({ path: 'src/cli/pr-cli.ts', count: 1, prefixes: [] });
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain('착지 앞머리: docs(🅢) 2, feat(cli) 1');
    expect(report).toContain('docs/topic.md  2  docs(🅢) 2');
    expect(report).not.toContain('src/cli/pr-cli.ts');
  });

  it('shows only the most frequent prefixes up to the code-level limit and appends showing N of M when truncated', () => {
    const kinds = Array.from({ length: TOP_PREFIX_COUNT_LIMIT + 2 }, (_, index) => `docs(kind${index})`);
    const subjects = kinds.flatMap((kind, index) => Array.from({ length: kinds.length - index }, () => `${kind}: landing`));
    const commits = parseCommitNameLog(subjects.map((subject, index) => landing(subject, 'docs/topic.md', index)).join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.fileFrequencies[0]?.prefixes).toHaveLength(kinds.length);
    expect(stats.fileFrequencies[0]?.prefixes.slice(0, TOP_PREFIX_COUNT_LIMIT).map((entry) => entry.prefix)).toEqual(
      kinds.slice(0, TOP_PREFIX_COUNT_LIMIT),
    );
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    const row = report.split('\n').find((line) => line.includes('docs/topic.md')) ?? '';
    expect(row).toContain(`showing ${TOP_PREFIX_COUNT_LIMIT} of ${kinds.length}`);
    for (const kind of kinds.slice(0, TOP_PREFIX_COUNT_LIMIT)) expect(row).toContain(`${kind} `);
    for (const kind of kinds.slice(TOP_PREFIX_COUNT_LIMIT)) expect(row).not.toContain(kind);
    expect(row).not.toContain('+2 more');
    expect(row).not.toContain('17종');
  });

  it('does not append showing N of M when the prefix kind count is at or below the limit', () => {
    const kinds = Array.from({ length: TOP_PREFIX_COUNT_LIMIT }, (_, index) => `docs(kind${index})`);
    const commits = parseCommitNameLog(kinds.map((kind, index) => landing(`${kind}: landing`, 'docs/topic.md', index)).join('\n'));
    const report = formatGranularityReport(computeGranularityStats(commits), '1 day ago').join('\n');
    const row = report.split('\n').find((line) => line.includes('docs/topic.md')) ?? '';
    expect(row).toContain(kinds.map((kind) => `${kind} 1`).join(', '));
    expect(row).not.toContain('showing ');
    expect(row).not.toMatch(/ of \d+/);
  });

  it('fails this check if truncation drops the total kind count from showing N of M', () => {
    const kinds = Array.from({ length: TOP_PREFIX_COUNT_LIMIT + 3 }, (_, index) => `feat(scope${index})`);
    const subjects = kinds.flatMap((kind, index) => Array.from({ length: kinds.length - index }, () => `${kind}: landing`));
    const commits = parseCommitNameLog(subjects.map((subject, index) => landing(subject, 'src/cli/pr-cli.ts', index)).join('\n'));
    const report = formatGranularityReport(computeGranularityStats(commits), '1 day ago').join('\n');
    const row = report.split('\n').find((line) => line.includes('src/cli/pr-cli.ts')) ?? '';
    const shownOfTotal = `, showing ${TOP_PREFIX_COUNT_LIMIT} of ${kinds.length}`;
    const restoredWithoutTotal = row.replace(shownOfTotal, `, showing ${TOP_PREFIX_COUNT_LIMIT}`);
    expect(row).toContain(shownOfTotal);
    expect(row).not.toBe(restoredWithoutTotal);
    expect(restoredWithoutTotal).not.toContain(` of ${kinds.length}`);
    expect(restoredWithoutTotal).not.toMatch(new RegExp(`showing ${TOP_PREFIX_COUNT_LIMIT} of ${kinds.length}`));
  });

  it('ranks whole-window prefixes 3 then 2 then 1 on the summary line', () => {
    const commits = parseCommitNameLog([
      landing('docs(🅢): a', 'docs/a.md', 0),
      landing('docs(🅢): b', 'docs/b.md', 1),
      landing('docs(🅢): c', 'docs/c.md', 2),
      landing('feat(cli): d', 'src/d.ts', 3),
      landing('feat(cli): e', 'src/e.ts', 4),
      landing('fix(cli): f', 'src/f.ts', 5),
    ].join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.prefixFrequencies).toEqual([
      { prefix: 'docs(🅢)', count: 3 },
      { prefix: 'feat(cli)', count: 2 },
      { prefix: 'fix(cli)', count: 1 },
    ]);
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    const summary = report.split('\n').find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(summary).toBe('착지 앞머리: docs(🅢) 3, feat(cli) 2, fix(cli) 1');
    expect(summary.indexOf('docs(🅢) 3')).toBeLessThan(summary.indexOf('feat(cli) 2'));
    expect(summary.indexOf('feat(cli) 2')).toBeLessThan(summary.indexOf('fix(cli) 1'));
    expect(report).not.toContain('같은 파일을 여러 착지가 건드린 상위');
  });

  it('truncates the whole-window prefix summary to the code-level limit and names shown of total', () => {
    const kinds = Array.from({ length: TOP_PREFIX_COUNT_LIMIT + 2 }, (_, index) => `docs(kind${index})`);
    const subjects = kinds.flatMap((kind, index) => Array.from({ length: kinds.length - index }, () => `${kind}: landing`));
    const commits = parseCommitNameLog(subjects.map((subject, index) => landing(subject, `docs/file-${index}.md`, index)).join('\n'));
    const stats = computeGranularityStats(commits);
    expect(stats.prefixFrequencies).toHaveLength(kinds.length);
    const summary = formatGranularityReport(stats, '1 day ago').find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(summary).toContain(`showing ${TOP_PREFIX_COUNT_LIMIT} of ${kinds.length}`);
    for (const kind of kinds.slice(0, TOP_PREFIX_COUNT_LIMIT)) expect(summary).toContain(`${kind} `);
    for (const kind of kinds.slice(TOP_PREFIX_COUNT_LIMIT)) expect(summary).not.toContain(kind);
  });

  it('omits the unextractable marker from the window summary when every title extracts', () => {
    const commits = parseCommitNameLog([
      landing('docs(🅢): a', 'docs/a.md', 0),
      landing('feat(cli): b', 'src/b.ts', 1),
    ].join('\n'));
    const report = formatGranularityReport(computeGranularityStats(commits), '1 day ago').join('\n');
    expect(report).toContain('착지 앞머리: docs(🅢) 1, feat(cli) 1');
    expect(report).not.toContain(UNEXTRACTABLE_COMMIT_TITLE_PREFIX);
  });

  it('fails this check if the window prefix summary is dropped from the report', () => {
    const commits = parseCommitNameLog([
      landing('docs(🅢): a', 'docs/a.md', 0),
      landing('docs(🅢): b', 'docs/b.md', 1),
      landing('docs(🅢): c', 'docs/c.md', 2),
      landing('feat(cli): d', 'src/d.ts', 3),
      landing('feat(cli): e', 'src/e.ts', 4),
      landing('fix(cli): f', 'src/f.ts', 5),
    ].join('\n'));
    const lines = formatGranularityReport(computeGranularityStats(commits), '1 day ago');
    const summary = '착지 앞머리: docs(🅢) 3, feat(cli) 2, fix(cli) 1';
    expect(lines.find((line) => line.startsWith('착지 앞머리:'))).toBe(summary);
    expect(lines).toContain(summary);
  });

  it('annotates only the window unextractable item with the harness count from classifyLandingSource', () => {
    const commits = parseCommitNameLog([
      landing('docs(원장 🅣): keep this wording (#10)', 'docs/ledger.md', 0),
      landing('하니스 골 제목 하나 (#11)', 'src/a.ts', 1),
      landing('하니스 골 제목 둘 (#12)', 'src/b.ts', 2),
      landing('사람이 접두를 안 쓴 제목 (#13)', 'src/c.ts', 3),
    ].join('\n'));
    const headRefByPrNumber = new Map<number, string>([
      [10, 't-docs'],
      [11, 'self-impl/one'],
      [12, 'self-impl/two'],
      [13, 'human-branch'],
    ]);
    const withoutMap = computeGranularityStats(commits);
    const withMap = computeGranularityStats(commits, headRefByPrNumber);
    expect(withoutMap.unextractableHarnessCount).toBe(0);
    expect(withMap.unextractableHarnessCount).toBe(2);
    expect(withMap.prefixFrequencies).toEqual(withoutMap.prefixFrequencies);
    expect(withMap.prefixFrequencies).toEqual([
      { prefix: UNEXTRACTABLE_COMMIT_TITLE_PREFIX, count: 3 },
      { prefix: 'docs(원장 🅣)', count: 1 },
    ]);
    expect(withMap.landingCount).toBe(withoutMap.landingCount);
    const annotated = formatGranularityReport(withMap, '1 day ago');
    const plain = formatGranularityReport(withoutMap, '1 day ago');
    const annotatedSummary = annotated.find((line) => line.startsWith('착지 앞머리:')) ?? '';
    const plainSummary = plain.find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(plainSummary).toBe('착지 앞머리: 앞머리 미추출 3, docs(원장 🅣) 1');
    expect(annotatedSummary).toBe('착지 앞머리: 앞머리 미추출 3 (하니스 2), docs(원장 🅣) 1');
    expect(annotatedSummary).toContain('앞머리 미추출 3');
    expect(annotatedSummary).toContain('하니스 2');
    expect(annotatedSummary).toContain('docs(원장 🅣) 1');
    expect(plain.filter((line) => !line.startsWith('착지 앞머리:'))).toEqual(
      annotated.filter((line) => !line.startsWith('착지 앞머리:')),
    );
  });

  it('keeps the unextractable window item unchanged when classifyLandingSource finds no harness landings', () => {
    const commits = parseCommitNameLog([
      landing('docs(🅢): scoped', 'docs/a.md', 0),
      landing('접두 없는 사람 착지 (#21)', 'src/a.ts', 1),
      landing('또 접두 없는 사람 착지 (#22)', 'src/b.ts', 2),
    ].join('\n'));
    const headRefByPrNumber = new Map<number, string>([
      [21, 'human-a'],
      [22, 'human-b'],
    ]);
    const stats = computeGranularityStats(commits, headRefByPrNumber);
    expect(stats.unextractableHarnessCount).toBe(0);
    const summary = formatGranularityReport(stats, '1 day ago').find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(summary).toBe('착지 앞머리: 앞머리 미추출 2, docs(🅢) 1');
    expect(summary).not.toContain('하니스');
    expect(summary).not.toContain('(하니스');
  });

  it('does not annotate repeated-file prefix rows even when the window unextractable item names harness', () => {
    const commits = parseCommitNameLog([
      landing('하니스 골 (#31)', 'docs/topic.md', 0),
      landing('하니스 골 둘 (#32)', 'docs/topic.md', 1),
      landing('사람 접두 없음 (#33)', 'docs/topic.md', 2),
    ].join('\n'));
    const stats = computeGranularityStats(commits, new Map([
      [31, 'self-impl/a'],
      [32, 'self-impl/b'],
      [33, 'human'],
    ]));
    expect(stats.unextractableHarnessCount).toBe(2);
    const lines = formatGranularityReport(stats, '1 day ago');
    expect(lines.find((line) => line.startsWith('착지 앞머리:'))).toBe(
      '착지 앞머리: 앞머리 미추출 3 (하니스 2)',
    );
    const repeated = lines.find((line) => line.includes('docs/topic.md')) ?? '';
    expect(repeated).toContain(`docs/topic.md  3  ${UNEXTRACTABLE_COMMIT_TITLE_PREFIX} 3`);
    expect(repeated).not.toContain('하니스');
  });
});

describe('pr-granularity overlap', () => {
  it('reports overlapping files with recent landing counts and stays empty on non-overlap', () => {
    const commits = parseCommitNameLog(sampleLog);
    expect(overlapWithCurrentChanges(commits, ['docs/topic.md', 'src/new.ts'])).toEqual([
      { path: 'docs/topic.md', recentLandingCount: 3 },
    ]);
    expect(overlapWithCurrentChanges(commits, ['src/new.ts'])).toEqual([]);
    expect(formatOverlapAdvisory(overlapWithCurrentChanges(commits, ['src/new.ts']))).toBeNull();
    const line = formatOverlapAdvisory(overlapWithCurrentChanges(commits, ['docs/topic.md', 'src/cli/pr-cli.ts']));
    expect(line).toContain('docs/topic.md (3회)');
    expect(line).toContain('src/cli/pr-cli.ts (1회)');
    expect(line).toContain('pr land --hold');
    expect(line?.includes('\n')).toBe(false);
  });

  it('keeps the overlap advisory wording unchanged', () => {
    expect(formatOverlapAdvisory([{ path: 'src/land.ts', recentLandingCount: 2 }])).toBe(
      '⚠ overlap: src/land.ts (2회) — 같은 파일을 최근 착지가 건드렸습니다. 쌓아 두려면 pr land --hold 를 쓰십시오.',
    );
  });
});

describe('formatRecentLandingRateAdvisory', () => {
  const unchangedWithoutPrevious =
    '⚠ recent-landings: 최근 30분에 이 저장소에 들어온 착지가 3건입니다 (저자 식별자가 하나뿐이라 세션별로 가르지 못합니다) — 같은 주제면 커밋하지 말고 다음 것과 함께 내십시오. 리뷰를 먼저 받아야 하면 pr land --hold.';
  const line = formatRecentLandingRateAdvisory({ recentCount: 3, windowMinutes: 30 });

  it('names repository landings and does not say 당신이', () => {
    expect(line).toBe(unchangedWithoutPrevious);
    expect(line).toContain('이 저장소에 들어온');
    expect(line).not.toContain('당신이');
  });

  it('states the session limitation and keeps hold as a secondary path', () => {
    expect(line).toContain('세션별로 가르지 못합니다');
    expect(line).toContain('커밋하지 말고');
    expect(line).toContain('--hold');
    expect(line!.indexOf('커밋하지 말고')).toBeLessThan(line!.indexOf('--hold'));
  });

  it('still returns null when recentCount is 0 or 1', () => {
    expect(formatRecentLandingRateAdvisory({ recentCount: 0, windowMinutes: 30 })).toBeNull();
    expect(formatRecentLandingRateAdvisory({ recentCount: 1, windowMinutes: 30 })).toBeNull();
  });

  it('keeps the first-line wording and omits 직전 착지: when previous is absent', () => {
    expect(line).toBe(unchangedWithoutPrevious);
    expect(line).not.toContain('직전 착지:');
    expect(line?.includes('\n')).toBe(false);
  });

  it('appends the previous landing as a second line when previous is given', () => {
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject: 'docs(roadmap): x', agoMinutes: 8 },
    });
    expect(withPrevious?.split('\n')).toEqual([
      unchangedWithoutPrevious,
      '   직전 착지: "docs(roadmap): x" (8분 전)',
    ]);
    expect(withPrevious).toContain('직전 착지: "docs(roadmap): x" (8분 전)');
  });

  it('truncates a previous subject longer than 60 characters to 57 plus ...', () => {
    const subject = 'a'.repeat(80);
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 2 },
    });
    const previousLine = withPrevious?.split('\n')[1];
    expect(previousLine).toBe(`   직전 착지: "${'a'.repeat(57)}..." (2분 전)`);
    expect(withPrevious).not.toContain(subject);
    expect(previousLine).toContain('...');
  });

  it('does not truncate a subject of exactly 60 code points', () => {
    const subject = 'a'.repeat(60);
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 2 },
    });
    expect(withPrevious?.split('\n')[1]).toBe(`   직전 착지: "${subject}" (2분 전)`);
    expect(withPrevious).not.toContain('...');
  });

  it('truncates a subject of 61 code points to 57 code points plus ...', () => {
    const subject = 'a'.repeat(61);
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 2 },
    });
    const previousLine = withPrevious?.split('\n')[1];
    expect(previousLine).toBe(`   직전 착지: "${'a'.repeat(57)}..." (2분 전)`);
    expect(Array.from(previousLine!.match(/"([^"]*)"/)![1]!.slice(0, -3)).length).toBe(57);
  });

  it('keeps a 60-code-point subject that contains an emoji even when UTF-16 length exceeds 60', () => {
    const subject = `${'a'.repeat(58)}🚀b`;
    expect(subject.length).toBe(61);
    expect(Array.from(subject).length).toBe(60);
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 1 },
    });
    expect(withPrevious?.split('\n')[1]).toBe(`   직전 착지: "${subject}" (1분 전)`);
    expect(withPrevious).toContain('🚀');
    expect(withPrevious?.split('\n')[1]).not.toContain('...');
  });

  it('truncates on a code-point boundary so an emoji at the 57th position stays whole', () => {
    const subject = `${'a'.repeat(56)}🚀${'b'.repeat(5)}`;
    expect(Array.from(subject).length).toBe(62);
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 4 },
    });
    const previousLine = withPrevious?.split('\n')[1];
    expect(previousLine).toBe(`   직전 착지: "${'a'.repeat(56)}🚀..." (4분 전)`);
    const quoted = previousLine!.match(/"([^"]*)"/)![1]!;
    expect(quoted.endsWith('...')).toBe(true);
    expect(Array.from(quoted.slice(0, -3)).length).toBe(57);
    expect(quoted).toContain('🚀');
    expect(quoted).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(withPrevious).not.toContain(subject);
  });

  it('drops an emoji that sits after the 57th code point', () => {
    const subject = `${'a'.repeat(57)}🚀${'b'.repeat(3)}`;
    const withPrevious = formatRecentLandingRateAdvisory({
      recentCount: 3,
      windowMinutes: 30,
      previous: { subject, agoMinutes: 4 },
    });
    const previousLine = withPrevious?.split('\n')[1];
    expect(previousLine).toBe(`   직전 착지: "${'a'.repeat(57)}..." (4분 전)`);
    expect(withPrevious).not.toContain('🚀');
  });
});

describe('previousLandingSummary', () => {
  const nowMs = 1_700_000_000_000;
  const min = 60_000;

  it('picks the latest non-future commit and floors elapsed minutes', () => {
    const commits = [
      { subject: 'docs(cli): forty', committedAtMs: nowMs - 40 * min },
      { subject: 'docs(cli): ten', committedAtMs: nowMs - 10 * min },
      { subject: 'docs(cli): future', committedAtMs: nowMs + 5 * min },
    ];
    expect(previousLandingSummary(commits, nowMs)).toEqual({
      subject: 'docs(cli): ten',
      agoMinutes: 10,
    });
  });

  it('floors partial minutes and returns undefined when every commit is in the future', () => {
    expect(previousLandingSummary(
      [{ subject: 'docs(cli): partial', committedAtMs: nowMs - (10 * min + 30_000) }],
      nowMs,
    )).toEqual({ subject: 'docs(cli): partial', agoMinutes: 10 });
    expect(previousLandingSummary(
      [{ subject: 'docs(cli): future', committedAtMs: nowMs + 5 * min }],
      nowMs,
    )).toBeUndefined();
    expect(previousLandingSummary([], nowMs)).toBeUndefined();
  });
});

describe('countRecentLandings compatibility wrapper', () => {
  const commits = [
    { authorEmail: 'me@example.com', committedAtMs: 1_700_000_000_000 - 10 * 60_000 },
    { authorEmail: 'other@example.com', committedAtMs: 1_700_000_000_000 - 10 * 60_000 },
    { authorEmail: 'me@example.com', committedAtMs: 1_700_000_000_000 - 90 * 60_000 },
  ] as const;
  const opts = { authorEmail: 'me@example.com', nowMs: 1_700_000_000_000, windowMinutes: 30 };

  it('returns the same count as countRecentLandingsByAuthor for the same arguments', () => {
    expect(countRecentLandings(commits, opts)).toBe(countRecentLandingsByAuthor(commits, opts));
  });
});

describe('pr-granularity base landing range', () => {
  it('scopes git log to the resolved base ref instead of HEAD', () => {
    expect(landingHistoryLogArgs('1 day ago', 'origin/main')).toEqual([
      'log',
      '--since=1 day ago',
      '--pretty=format:commit %H%x1e%ae %ct %s',
      '--name-only',
      '--no-merges',
      '--no-renames',
      'origin/main',
    ]);
    expect(landingHistoryLogArgs('1 day ago', 'origin/main')).not.toContain('HEAD');
  });

  it('collects only the base-ref log through the pr-manager landing-history seam', () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const commits = collectBaseLandingCommits((cmd, args) => {
      calls.push({ cmd, args });
      return { ok: true, out: sampleLog };
    }, '/wt', { since: '1 day ago', baseRef: 'origin/main' });
    expect(commits).toHaveLength(3);
    expect(calls).toEqual([{
      cmd: 'git',
      args: landingHistoryLogArgs('1 day ago', 'origin/main'),
    }]);
    expect(calls.some(({ cmd }) => cmd === 'gh')).toBe(false);
  });
});

describe('pr granularity --with-source wiring', () => {
  const sourceLog = [
    'commit aaa111bbb222ccc333ddd444eee555fff666aaa feat: harness (#1)',
    'src/cli/pr-cli.ts',
    '',
    'commit bbb222ccc333ddd444eee555fff666aaa111bbb feat: no number',
    'docs/topic.md',
  ].join('\n');
  const expectedBaseReport = formatGranularityReport(
    computeGranularityStats(parseCommitNameLog(sourceLog)),
    '1 day ago',
  );

  function capture() {
    const logs: string[] = [];
    const errors: string[] = [];
    return {
      logs,
      errors,
      out: {
        log: (message: string) => logs.push(message),
        error: (message: string) => errors.push(message),
      },
    };
  }

  it('keeps default output byte-identical and never calls gh without --with-source', async () => {
    const sink = capture();
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const program = new Command();
    program.exitOverride();
    registerPrCommands(program, {
      resolveBase: () => 'origin/main',
      out: sink.out,
      run: (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'git' && args[0] === 'log') return { ok: true, out: sourceLog };
        return { ok: false, out: 'must-not-call' };
      },
    });
    await program.parseAsync(['pr', 'granularity', '--since', '1 day ago'], { from: 'user' });
    expect(sink.logs).toEqual(expectedBaseReport);
    expect(calls.some(({ cmd }) => cmd === 'gh')).toBe(false);
    expect(sink.logs.some((line) => line.includes('harness:') || line.includes('source-no-pr-number') || line.includes('⚠ source:'))).toBe(false);
    const help = program.commands.find((cmd) => cmd.name() === 'pr')
      ?.commands.find((cmd) => cmd.name() === 'granularity')
      ?.options.find((option) => option.long === '--with-source');
    expect(help?.description).toBe('PR 번호로 브랜치를 조회해 하니스↔사람 갈래를 함께 낸다 (gh 필요)');
  });

  it('appends the source-split section after the unchanged base report when lookup succeeds', async () => {
    const sink = capture();
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const program = new Command();
    program.exitOverride();
    registerPrCommands(program, {
      resolveBase: () => 'origin/main',
      out: sink.out,
      run: (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'git' && args[0] === 'log') return { ok: true, out: sourceLog };
        if (
          cmd === 'gh'
          && args[0] === 'pr'
          && args[1] === 'list'
          && args.includes('--state')
          && args.includes('merged')
          && args.includes('--limit')
          && args.includes('1')
          && args.includes('--json')
          && args.includes('number,headRefName')
        ) {
          return { ok: true, out: JSON.stringify([{ number: 1, headRefName: 'self-impl/x' }]) };
        }
        return { ok: false, out: 'unexpected' };
      },
    });
    await program.parseAsync(['pr', 'granularity', '--since', '1 day ago', '--with-source'], { from: 'user' });
    expect(sink.logs.slice(0, expectedBaseReport.length)).toEqual(expectedBaseReport);
    expect(sink.logs.slice(expectedBaseReport.length)).toEqual([
      '⚠ source-no-pr-number: 착지 1건은 커밋 제목에 PR 번호가 없어 갈래를 판정하지 못했습니다.',
      'harness: 1 (100.0%)  단일 파일 1  파일 합 1',
      'human: 0 (0.0%)  단일 파일 0  파일 합 0',
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · PR 번호 없음 1',
    ]);
    expect(calls.filter(({ cmd }) => cmd === 'gh')).toHaveLength(1);
    expect(calls.find(({ cmd }) => cmd === 'gh')?.args).toEqual([
      'pr', 'list', '--state', 'merged', '--limit', '1', '--json', 'number,headRefName',
    ]);
  });

  it('annotates the unextractable window item from the existing --with-source head-ref map and leaves other prefix items unchanged', () => {
    const mixedLog = [
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa docs(원장 🅣): keep (#10)',
      'docs/ledger.md',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb 하니스 골 하나 (#11)',
      'src/a.ts',
      '',
      'commit ccc333ddd444eee555fff666aaa111bbb222ccc 하니스 골 둘 (#12)',
      'src/b.ts',
      '',
      'commit ddd444eee555fff666aaa111bbb222ccc333ddd 사람 접두 없음 (#13)',
      'src/c.ts',
    ].join('\n');
    const sink = capture();
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const code = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: sink.out,
        run: (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: mixedLog };
          if (cmd === 'gh') {
            return {
              ok: true,
              out: JSON.stringify([
                { number: 10, headRefName: 't-docs' },
                { number: 11, headRefName: 'self-impl/one' },
                { number: 12, headRefName: 'self-impl/two' },
                { number: 13, headRefName: 'human-branch' },
              ]),
            };
          }
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(code).toBe(0);
    expect(calls.filter(({ cmd }) => cmd === 'gh')).toHaveLength(1);
    const summary = sink.logs.find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(summary).toBe('착지 앞머리: 앞머리 미추출 3 (하니스 2), docs(원장 🅣) 1');
    const defaultSink = capture();
    runPrGranularity(
      { since: '1 day ago' },
      {
        resolveBase: () => 'origin/main',
        out: defaultSink.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: mixedLog };
          return { ok: false, out: 'must-not-call' };
        },
      },
    );
    const defaultSummary = defaultSink.logs.find((line) => line.startsWith('착지 앞머리:')) ?? '';
    expect(defaultSummary).toBe('착지 앞머리: 앞머리 미추출 3, docs(원장 🅣) 1');
    expect(defaultSink.logs.some((line) => line.includes('하니스'))).toBe(false);
    const withoutPrefix = (logs: string[]) => logs.filter((line) => !line.startsWith('착지 앞머리:') && !line.startsWith('harness:') && !line.startsWith('human:') && !line.startsWith('같은 골') && !line.startsWith('⚠ source'));
    expect(withoutPrefix(sink.logs)).toEqual(withoutPrefix(defaultSink.logs));
  });

  it('emits only the lookup-failure line after the base report and keeps exit 0', () => {
    const sink = capture();
    const failed = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: sink.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: sourceLog };
          if (cmd === 'gh') return { ok: false, out: '', err: 'gh unavailable' };
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    const succeeded = capture();
    const successCode = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: succeeded.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: sourceLog };
          if (cmd === 'gh') return { ok: true, out: JSON.stringify([{ number: 1, headRefName: 'self-impl/x' }]) };
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(failed).toBe(0);
    expect(successCode).toBe(0);
    expect(failed).toBe(successCode);
    expect(sink.logs.slice(0, expectedBaseReport.length)).toEqual(expectedBaseReport);
    expect(sink.logs.slice(expectedBaseReport.length)).toEqual([
      '⚠ source: 브랜치 조회에 실패해 갈래를 내지 못했습니다.',
    ]);
    expect(sink.logs.filter((line) => line.includes('⚠ source: 브랜치 조회에 실패'))).toHaveLength(1);
  });

  it('covers a below-cap window with a derived --limit and omits MAYBE_TRUNCATED even when count equals that limit', () => {
    const belowCapLog = [
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa feat: a (#1)',
      'src/cli/pr-cli.ts',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb feat: b (#2)',
      'src/cli/pr-cli.ts',
      '',
      'commit ccc333ddd444eee555fff666aaa111bbb222ccc feat: c (#3)',
      'src/cli/pr-cli.ts',
    ].join('\n');
    const ghCalls: Array<readonly string[]> = [];
    const below = capture();
    const belowCode = runPrGranularity(
      { since: '3 hours ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: below.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: belowCapLog };
          if (cmd === 'gh') {
            ghCalls.push(args);
            return {
              ok: true,
              out: JSON.stringify([
                { number: 1, headRefName: 'self-impl/x-1111aaaa' },
                { number: 2, headRefName: 'self-impl/x-2222bbbb' },
                { number: 3, headRefName: 'self-impl/y-3333cccc' },
              ]),
            };
          }
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(belowCode).toBe(0);
    expect(ghCalls).toEqual([
      ['pr', 'list', '--state', 'merged', '--limit', '3', '--json', 'number,headRefName'],
    ]);
    expect(below.logs.some((line) => line.includes('MAYBE_TRUNCATED'))).toBe(false);
    expect(below.logs.some((line) => line.includes('조회 창 밖'))).toBe(false);

    const miss = capture();
    const missCode = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: miss.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: sourceLog };
          if (cmd === 'gh') return { ok: true, out: JSON.stringify([{ number: 1, headRefName: 'self-impl/x' }]) };
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(missCode).toBe(0);
    expect(miss.logs.some((line) => line.includes('MAYBE_TRUNCATED'))).toBe(false);
    expect(miss.logs.slice(expectedBaseReport.length)).toEqual([
      '⚠ source-no-pr-number: 착지 1건은 커밋 제목에 PR 번호가 없어 갈래를 판정하지 못했습니다.',
      'harness: 1 (100.0%)  단일 파일 1  파일 합 1',
      'human: 0 (0.0%)  단일 파일 0  파일 합 0',
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · PR 번호 없음 1',
    ]);
  });

  it('emits MAYBE_TRUNCATED limit=N count=N only when the derived lookup hits the runaway cap', () => {
    const cap = 200;
    const truncatedLog = Array.from({ length: cap }, (_, i) => {
      const n = i === cap - 1 ? 999 : i + 1;
      return [`commit ${hashAt(i)} feat: n${n} (#${n})`, 'src/cli/pr-cli.ts', ''].join('\n');
    }).join('\n');
    const truncatedEntries = Array.from({ length: cap }, (_, i) => ({
      number: i + 1,
      headRefName: `self-impl/x-${(i + 1).toString(16).padStart(8, '0')}`,
    }));
    truncatedEntries[0] = { number: 1, headRefName: 'self-impl/x-1111aaaa' };
    truncatedEntries[1] = { number: 2, headRefName: 'self-impl/x-2222bbbb' };

    const ghCalls: Array<readonly string[]> = [];
    const hit = capture();
    const hitCode = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: hit.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: truncatedLog };
          if (cmd === 'gh') {
            ghCalls.push(args);
            return { ok: true, out: JSON.stringify(truncatedEntries) };
          }
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(hitCode).toBe(0);
    expect(ghCalls).toEqual([
      ['pr', 'list', '--state', 'merged', '--limit', '200', '--json', 'number,headRefName'],
    ]);
    expect(hit.logs.filter((line) => line.includes('MAYBE_TRUNCATED'))).toEqual([
      'MAYBE_TRUNCATED limit=200 count=200',
    ]);
    // ⛔ 「둘 중 하나라도 있으면 통과」는 일반 계보 행만 있어도 통과한다 — 창 밖 «수»를 직접 문다.
    const hitLineage = hit.logs.find((line) => line.startsWith('같은 골이 낸 착지(계보):'));
    expect(hitLineage).toBeDefined();
    expect(hitLineage).toContain('조회 창 밖 1');
    expect(hitLineage).not.toContain('조회에 없음');
  });
  it('유도 상한은 창이 200을 넘어도 «따라간다» — 폭주 천장은 그 «위»에 있다', () => {
    // 🚨 이 시험이 없으면 천장을 200으로 되돌려도 «아무도 모른다»(2026-08-28 실측: 52p/0f 그대로였다).
    const LANDINGS = 250;   // ⛔ 옛 상한 200보다 «크다» — 그래야 두 값이 갈린다
    const log = Array.from({ length: LANDINGS }, (_, i) => [
      `commit ${(i + 1).toString(16).padStart(40, '0')} feat: n (#${i + 1})`,
      'src/cli/pr-cli.ts',
    ].join('\n')).join('\n\n');
    const entries = Array.from({ length: LANDINGS }, (_, i) => ({
      number: i + 1,
      headRefName: `self-impl/x-${(i + 1).toString(16).padStart(8, '0')}`,
    }));
    const ghCalls: Array<readonly string[]> = [];
    const got = capture();
    const code = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: got.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: log };
          if (cmd === 'gh') { ghCalls.push(args); return { ok: true, out: JSON.stringify(entries) }; }
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(code).toBe(0);
    // 🔑 창(250)을 덮는다 — 옛 상한 200에 «눌리지 않는다».
    expect(ghCalls[0]?.[ghCalls[0].indexOf('--limit') + 1]).toBe(String(LANDINGS));
    const lineage = got.logs.find((l) => l.startsWith('같은 골이 낸 착지(계보):'));
    expect(lineage).toBeDefined();
    expect(lineage).not.toContain('조회 창 밖');
  });

  it('상한에 «닿아도» 못 본 착지가 없으면 MAYBE_TRUNCATED 를 «안 낸다»', () => {
    // 착지 2건이 전부 맵에 있다 ⇒ 유도 상한 2 · count 2 ⇒ truncated 는 참이지만 설명할 것이 «없다».
    const log = [
      'commit aaa111bbb222ccc333ddd444eee555fff666aaa feat: a (#1)',
      'src/cli/pr-cli.ts',
      '',
      'commit bbb222ccc333ddd444eee555fff666aaa111bbb feat: b (#2)',
      'src/cli/pr-cli.ts',
    ].join('\n');
    const entries = [
      { number: 1, headRefName: 'self-impl/x-1111aaaa' },
      { number: 2, headRefName: 'self-impl/x-2222bbbb' },
    ];
    const got = capture();
    const code = runPrGranularity(
      { since: '1 day ago', withSource: true },
      {
        resolveBase: () => 'origin/main',
        out: got.out,
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'log') return { ok: true, out: log };
          if (cmd === 'gh') return { ok: true, out: JSON.stringify(entries) };
          return { ok: false, out: 'unexpected' };
        },
      },
    );
    expect(code).toBe(0);
    // ⛔ 「닿았다」만으로 내면 읽는 사람이 「분모가 빠졌다」로 오독한다.
    expect(got.logs.filter((l) => l.includes('MAYBE_TRUNCATED'))).toEqual([]);
    const lineage = got.logs.find((l) => l.startsWith('같은 골이 낸 착지(계보):'));
    expect(lineage).toBeDefined();
    expect(lineage).not.toContain('조회 창 밖');
  });

});

// ⛔ 📏 2026-08-28 실측: 열린 self-impl PR 23건 중 ***10건(43%)***이 형제 무리였고 ***4개 골이 10개 PR***을 냈다.
//   그런데 그 수를 «내는 자리»가 없었다 — 사람이 「알갱이가 잘다」로 읽는 것의 상당 부분이
//   실은 「같은 일을 여러 번 쐈다」인데 둘을 가르는 수가 없었다.
//   ⭐ 계보 키는 «슬러그»다 — 해시는 골 «문면» 파생이라 같은 골의 다른 시도끼리도 갈린다.
describe('계보 — 같은 골이 낸 착지를 슬러그로 묶는다', () => {
  const c = (subject: string): LandingCommit =>
    ({ hash: 'h', subject, files: ['a.ts'], authorEmail: 'x@y', committedAtMs: 0 });

  it('슬러그가 같고 해시만 다르면 «한 무리»로 센다', () => {
    const stats = computeLineageStats(
      [c('x (#1)'), c('y (#2)'), c('z (#3)')],
      new Map([[1, 'self-impl/x-1111aaaa'], [2, 'self-impl/x-2222bbbb'], [3, 'self-impl/y-3333cccc']]),
    );
    expect(stats.pathGroups).toEqual([{ slug: 'x', landings: 2 }]);
    expect(stats.goalGroups).toEqual([]);
    expect(stats.groups).toEqual([]);
    expect(stats.pathGroupedLandings).toBe(2);
    expect(stats.groupedLandings).toBe(0);
  });

  it('슬러그가 전부 다르면 무리가 «없다» (과탐 방지)', () => {
    const stats = computeLineageStats(
      [c('x (#1)'), c('y (#2)')],
      new Map([[1, 'self-impl/x-1111aaaa'], [2, 'self-impl/y-2222bbbb']]),
    );
    expect(stats.groups).toEqual([]);
    expect(stats.pathGroups).toEqual([]);
    expect(formatLineageReport(stats)).toEqual([]);   // ⛔ 빈 절을 «안 낸다»
  });

  it('브랜치를 못 얻은 착지는 «형제 0»과 다른 값으로 센다', () => {
    // 상한에 «닿은» 조회를 전제한 케이스다 — 안 닿았으면 unmatchedPr 로 센다(아래 별도 시험).
    const stats = computeLineageStats([c('x (#1)'), c('앞머리 없음')], new Map(), true);
    expect(stats.noPrNumber).toBe(1);
    expect(stats.outsideLookupWindow).toBe(1);
    expect(stats.branchUnknown).toBe(2);
    expect(stats.groups).toEqual([]);
    expect(formatLineageReport(stats)).toEqual([
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · PR 번호 없음 1 · 조회 창 밖 1',
    ]);
  });

  it('하니스 브랜치가 «아닌» 것은 계보 대상이 아니다', () => {
    const stats = computeLineageStats(
      [c('x (#1)'), c('y (#2)')],
      new Map([[1, 'feat/land'], [2, 'feat/land']]),
    );
    expect(stats.groups).toEqual([]);
    expect(stats.noPrNumber).toBe(0);
    expect(stats.outsideLookupWindow).toBe(0);
    expect(stats.branchUnknown).toBe(0);   // ⛔ 「못 얻음」이 아니라 「대상 아님」이다
  });

  it('문면이 무리 수·착지 수·슬러그를 담는다', () => {
    const lines = formatLineageReport(lineageFixture({
      groups: [{ slug: 'src-a-ts', landings: 3 }],
      groupedLandings: 3,
      branchUnknown: 2,
      noPrNumber: 2,
      outsideLookupWindow: 0,
      unmatchedPr: 0,
    }));
    expect(lines[0]).toContain('무리 1');
    expect(lines[0]).toContain('착지 3');
    expect(lines[0]).toContain('PR 번호 없음 2');
    expect(lines[0]).not.toContain('브랜치 미상');
    expect(lines[1]).toContain('src-a-ts');
  });

  it('브랜치 미상이 0이면 그 칸을 «안 붙인다»', () => {
    const lines = formatLineageReport(lineageFixture({
      groups: [{ slug: 'src-a-ts', landings: 2 }],
      groupedLandings: 2,
      branchUnknown: 0,
      noPrNumber: 0,
      outsideLookupWindow: 0,
      unmatchedPr: 0,
    }));
    expect(lines[0]).not.toContain('브랜치 미상');
    expect(lines[0]).not.toContain('PR 번호 없음');
    expect(lines[0]).not.toContain('조회 창 밖');
  });

  it('상한에 «안 닿았으면» 맵에 없는 PR 을 「창 밖」이 아니라 「조회에 없음」으로 센다', () => {
    const commits = [c('mapped (#1)'), c('맵에 없음 (#99)'), c('번호 없음')];
    const map = new Map([[1, 'self-impl/x-1111aaaa']]);

    const notTruncated = computeLineageStats(commits, map, false);
    expect(notTruncated.outsideLookupWindow).toBe(0);   // ⛔ 전수를 봤으므로 「창 밖」일 수 없다
    expect(notTruncated.unmatchedPr).toBe(1);
    expect(notTruncated.branchUnknown).toBe(2);

    const truncated = computeLineageStats(commits, map, true);
    expect(truncated.outsideLookupWindow).toBe(1);
    expect(truncated.unmatchedPr).toBe(0);
    expect(truncated.branchUnknown).toBe(2);

    // 두 원인의 «이름»이 산출에서 갈린다.
    expect(formatLineageReport(notTruncated)[0]).toContain('조회에 없음 1');
    expect(formatLineageReport(notTruncated)[0]).not.toContain('조회 창 밖');
    expect(formatLineageReport(truncated)[0]).toContain('조회 창 밖 1');
    expect(formatLineageReport(truncated)[0]).not.toContain('조회에 없음');
  });

  it('PR 번호 없음과 조회 창 밖을 다른 수로 내고 합은 옛 branchUnknown 과 같다', () => {
    const stats = computeLineageStats(
      [c('mapped (#1)'), c('창 밖 (#99)'), c('번호 없음')],
      new Map([[1, 'self-impl/x-1111aaaa']]),
      true,
    );
    expect(stats.noPrNumber).toBe(1);
    expect(stats.outsideLookupWindow).toBe(1);
    expect(stats.noPrNumber).toBeGreaterThan(0);
    expect(stats.outsideLookupWindow).toBeGreaterThan(0);
    expect(stats.branchUnknown).toBe(stats.noPrNumber + stats.outsideLookupWindow);
    expect(formatLineageReport(lineageFixture({
      groups: [{ slug: 'x', landings: 2 }],
      groupedLandings: 2,
      branchUnknown: stats.branchUnknown,
      noPrNumber: stats.noPrNumber,
      outsideLookupWindow: stats.outsideLookupWindow,
      unmatchedPr: stats.unmatchedPr,
    }))[0]).toContain('PR 번호 없음 1 · 조회 창 밖 1');
  });

  it('상한 경고가 없는 기본 포맷은 계보 절만 낸다', () => {
    const lines = formatLineageReport(lineageFixture({
      groups: [{ slug: 'src-a-ts', landings: 2 }],
      groupedLandings: 2,
      branchUnknown: 0,
      noPrNumber: 0,
      outsideLookupWindow: 0,
      unmatchedPr: 0,
    }));
    expect(lines.join('\n')).not.toContain('MAYBE_TRUNCATED');
    expect(lines[0]).toBe('같은 골이 낸 착지(계보): 무리 1 · 그 무리의 착지 2');
    expect(lines.some((line) => line.startsWith('같은 «경로»가 낸 착지(계보):'))).toBe(false);
  });

  it('무리가 없어도 PR 번호 없음만 있으면 그 수를 낸다', () => {
    const lines = formatLineageReport(lineageFixture({
      groups: [],
      groupedLandings: 0,
      branchUnknown: 3,
      noPrNumber: 3,
      outsideLookupWindow: 0,
      unmatchedPr: 0,
    }));
    expect(lines).toEqual([
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · PR 번호 없음 3',
    ]);
    expect(lines.join('\n')).not.toContain('조회 창 밖');
  });

  it('formats from pre-split LineageStats fields when the new split fields are omitted', () => {
    const stats: LineageStats = {
      groups: [{ slug: 'src-a-ts', landings: 2 }],
      groupedLandings: 2,
      branchUnknown: 0,
      noPrNumber: 0,
      outsideLookupWindow: 0,
      unmatchedPr: 0,
    };
    expect(stats.goalGroups).toBeUndefined();
    expect(stats.pathGroups).toBeUndefined();
    expect(stats.goalGroupedLandings).toBeUndefined();
    expect(stats.pathGroupedLandings).toBeUndefined();
    expect(formatLineageReport(stats)).toEqual([
      '같은 골이 낸 착지(계보): 무리 1 · 그 무리의 착지 2',
      '  src-a-ts  2',
    ]);
  });

  it('does not treat a mygoalid-foo path slug as a goal-id lineage', () => {
    const stats = computeLineageStats(
      [c('a (#1)'), c('b (#2)')],
      new Map([
        [1, 'self-impl/src-cli-mygoalid-foo-c8cbedac'],
        [2, 'self-impl/src-cli-mygoalid-foo-10250bd2'],
      ]),
    );
    expect(stats.goalGroups).toEqual([]);
    expect(stats.pathGroups).toEqual([{ slug: 'src-cli-mygoalid-foo', landings: 2 }]);
    expect(stats.goalGroupedLandings).toBe(0);
    expect(stats.pathGroupedLandings).toBe(2);
    const lines = formatLineageReport(stats);
    expect(lines.some((line) => line.startsWith('같은 골이 낸 착지(계보): 무리 0'))).toBe(true);
    expect(lines).toContain('같은 «경로»가 낸 착지(계보): 무리 1 · 그 무리의 착지 2');
    expect(lines).toContain('  src-cli-mygoalid-foo  2');
  });

  it('골 id 무리와 경로 슬러그 무리를 다른 갈래·다른 줄로 내고 착지 합은 보존한다', () => {
    const stats = computeLineageStats(
      [c('g1 (#1)'), c('g2 (#2)'), c('p1 (#3)'), c('p2 (#4)'), c('p3 (#5)'), c('solo (#6)')],
      new Map([
        [1, 'self-impl/200-goalid-c969c242a28942b0-rootintent-s-1111aaaa'],
        [2, 'self-impl/200-goalid-c969c242a28942b0-rootintent-s-2222bbbb'],
        [3, 'self-impl/src-cli-pr-cli-ts-test-cli-pr-cli-test-t-c8cbedac'],
        [4, 'self-impl/src-cli-pr-cli-ts-test-cli-pr-cli-test-t-10250bd2'],
        [5, 'self-impl/src-cli-pr-cli-ts-test-cli-pr-cli-test-t-aabbccdd'],
        [6, 'self-impl/other-path-3333cccc'],
      ]),
    );
    expect(stats.goalGroups).toEqual([{ slug: 'c969c242a28942b0', landings: 2 }]);
    expect(stats.pathGroups).toEqual([{ slug: 'src-cli-pr-cli-ts-test-cli-pr-cli-test-t', landings: 3 }]);
    expect(stats.groups).toEqual(stats.goalGroups ?? []);
    expect(stats.groupedLandings).toBe(2);
    expect(stats.goalGroupedLandings).toBe(2);
    expect(stats.pathGroupedLandings).toBe(3);
    const formerGroupedLandings = 5;
    expect((stats.goalGroupedLandings ?? 0) + (stats.pathGroupedLandings ?? 0)).toBe(formerGroupedLandings);
    const goalKeys = new Set((stats.goalGroups ?? []).map((g) => g.slug));
    const pathKeys = new Set((stats.pathGroups ?? []).map((g) => g.slug));
    for (const key of goalKeys) expect(pathKeys.has(key)).toBe(false);
    const lines = formatLineageReport(stats);
    expect(lines[0]).toBe('같은 골이 낸 착지(계보): 무리 1 · 그 무리의 착지 2');
    expect(lines).toContain('  c969c242a28942b0  2');
    expect(lines).toContain('같은 «경로»가 낸 착지(계보): 무리 1 · 그 무리의 착지 3');
    expect(lines).toContain('  src-cli-pr-cli-ts-test-cli-pr-cli-test-t  3');
    expect(lines.filter((line) => line.startsWith('같은 골이 낸 착지(계보):'))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('같은 «경로»가 낸 착지(계보):'))).toHaveLength(1);
  });

  it('옛 세대만 있으면 「같은 골」 줄은 0으로 남고 「같은 «경로»」가 다른 줄로 난다', () => {
    const stats = computeLineageStats(
      [c('x (#1)'), c('y (#2)'), c('z (#3)')],
      new Map([[1, 'self-impl/x-1111aaaa'], [2, 'self-impl/x-2222bbbb'], [3, 'self-impl/y-3333cccc']]),
    );
    const lines = formatLineageReport(stats);
    expect(lines[0]).toBe('같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0');
    expect(lines).toContain('같은 «경로»가 낸 착지(계보): 무리 1 · 그 무리의 착지 2');
    expect(lines).toContain('  x  2');
  });

  it('무리가 없어도 조회 창 밖만 있으면 그 수를 낸다', () => {
    const lines = formatLineageReport(lineageFixture({
      groups: [],
      groupedLandings: 0,
      branchUnknown: 4,
      noPrNumber: 0,
      outsideLookupWindow: 4,
      unmatchedPr: 0,
    }));
    expect(lines).toEqual([
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · 조회 창 밖 4',
    ]);
    expect(lines.join('\n')).not.toContain('PR 번호 없음');
  });

  it('경로 줄에도 골 줄이 쓰는 unknownSuffix 를 붙인다 — 못 잰 수가 0이 아니고 경로 무리가 있을 때', () => {
    const lines = formatLineageReport(lineageFixture({
      pathGroups: [{ slug: 'src-cli-pr-granularity-ts', landings: 2 }],
      pathGroupedLandings: 2,
      noPrNumber: 1,
      unmatchedPr: 2,
      outsideLookupWindow: 1193,
    }));
    const pathLine = lines.find((line) => line.startsWith('같은 «경로»가 낸 착지(계보):'));
    expect(pathLine).toBe(
      '같은 «경로»가 낸 착지(계보): 무리 1 · 그 무리의 착지 2 · PR 번호 없음 1 · 조회에 없음 2 · 조회 창 밖 1193',
    );
    expect(lines[0]).toBe(
      '같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0 · PR 번호 없음 1 · 조회에 없음 2 · 조회 창 밖 1193',
    );
  });

  it('못 잰 수가 모두 0이면 경로 줄은 군더더기 없이 지금과 같은 문면을 유지한다', () => {
    const lines = formatLineageReport(lineageFixture({
      pathGroups: [{ slug: 'src-cli-pr-granularity-ts', landings: 2 }],
      pathGroupedLandings: 2,
      noPrNumber: 0,
      unmatchedPr: 0,
      outsideLookupWindow: 0,
    }));
    expect(lines).toContain('같은 «경로»가 낸 착지(계보): 무리 1 · 그 무리의 착지 2');
    const pathLine = lines.find((line) => line.startsWith('같은 «경로»가 낸 착지(계보):'));
    expect(pathLine).not.toContain('PR 번호 없음');
    expect(pathLine).not.toContain('조회에 없음');
    expect(pathLine).not.toContain('조회 창 밖');
    expect(lines[0]).toBe('같은 골이 낸 착지(계보): 무리 0 · 그 무리의 착지 0');
  });
});

describe('단일 파일 착지 성격 내역', () => {
  function kindsOf(paths: readonly string[]) {
    const commits = parseCommitNameLog(
      paths.map((path, index) => landing(`feat: ${path}`, path, index)).join('\n'),
    );
    return computeGranularityStats(commits);
  }

  it('classifies by path precedence: docs/ then .rules/ then *.test.ts then source', () => {
    expect(classifySingleFilePath('docs/topic.md')).toBe('docs');
    expect(classifySingleFilePath('docs/cli/pr-granularity.test.ts')).toBe('docs');
    expect(classifySingleFilePath('.rules/00-core/first-principle.md')).toBe('rules');
    expect(classifySingleFilePath('.rules/30-harness/testing-gates.test.ts')).toBe('rules');
    expect(classifySingleFilePath('src/cli/pr-granularity.test.ts')).toBe('tests');
    expect(classifySingleFilePath('test/cli/pr-cli.test.ts')).toBe('tests');
    expect(classifySingleFilePath('src/cli/pr-granularity.ts')).toBe('source');
    expect(classifySingleFilePath('README.md')).toBe('source');
  });

  it('counts each single-file landing in exactly one kind and the four kinds sum to N', () => {
    const stats = kindsOf([
      'docs/topic.md',
      'docs/cli/pr-granularity.test.ts',
      '.rules/00-core/first-principle.md',
      '.rules/x.test.ts',
      'src/cli/pr-granularity.test.ts',
      'src/cli/pr-granularity.ts',
      'README.md',
    ]);
    expect(stats.singleFileLandingCount).toBe(7);
    expect(stats.singleFileKindCounts).toEqual({ docs: 2, rules: 2, tests: 1, source: 2 });
    const { docs, rules, tests, source } = stats.singleFileKindCounts;
    expect(docs + rules + tests + source).toBe(stats.singleFileLandingCount);
  });

  it('does not count a multi-file landing in any kind', () => {
    const mixed: LandingCommit[] = [
      { hash: hashAt(0), subject: 'feat: docs', files: ['docs/topic.md'], authorEmail: '', committedAtMs: 0 },
      { hash: hashAt(1), subject: 'feat: mixed', files: ['docs/a.md', 'src/a.ts'], authorEmail: '', committedAtMs: 0 },
    ];
    const stats = computeGranularityStats(mixed);
    expect(stats.landingCount).toBe(2);
    expect(stats.singleFileLandingCount).toBe(1);
    expect(stats.singleFileKindCounts).toEqual({ docs: 1, rules: 0, tests: 0, source: 0 });
    const { docs, rules, tests, source } = stats.singleFileKindCounts;
    expect(docs + rules + tests + source).toBe(stats.singleFileLandingCount);
  });

  it('keeps the legacy 단일 파일 착지: N (X%) line byte-identical and adds the kind line immediately after', () => {
    const stats = computeGranularityStats(parseCommitNameLog(sampleLog));
    const lines = formatGranularityReport(stats, '1 day ago');
    const legacy = '단일 파일 착지: 2 (66.7%)';
    const kindIndex = lines.indexOf(legacy) + 1;
    expect(lines).toContain(legacy);
    expect(lines[kindIndex]).toBe('  문서 2 · 규칙 0 · 시험 0 (봐야 할 모양) · 소스 0');
    expect(lines.filter((line) => line.startsWith('단일 파일 착지:'))).toEqual([legacy]);
  });

  it('prints 문서·규칙·시험·소스 with counts at runtime and names 시험 as 봐야 할 모양, not a defect', () => {
    const stats = kindsOf([
      'docs/a.md',
      '.rules/a.md',
      'src/a.test.ts',
      'src/a.ts',
    ]);
    const report = formatGranularityReport(stats, '1 day ago').join('\n');
    expect(report).toContain('단일 파일 착지: 4 (100.0%)');
    expect(report).toContain('문서 1');
    expect(report).toContain('규칙 1');
    expect(report).toContain('시험 1');
    expect(report).toContain('소스 1');
    expect(report).toContain('봐야 할 모양');
    expect(report).not.toContain('결함');
    expect(report).not.toMatch(/임계|경고|낮춰야/);
  });

  it('prints 문서·규칙·시험·소스 zeros with the unmeasurable line when the window has 0 landings', () => {
    const stats = computeGranularityStats([]);
    expect(stats.landingCount).toBe(0);
    expect(stats.singleFileLandingCount).toBe(0);
    expect(stats.singleFileKindCounts).toEqual({ docs: 0, rules: 0, tests: 0, source: 0 });
    const lines = formatGranularityReport(stats, '1 day ago');
    const unmeasurable = '단일 파일 착지 비율: 측정할 수 없음 — 이 창에 착지가 없습니다.';
    const kinds = '  문서 0 · 규칙 0 · 시험 0 (봐야 할 모양) · 소스 0';
    expect(lines).toContain(unmeasurable);
    expect(lines).toContain(kinds);
    expect(lines.indexOf(kinds)).toBe(lines.indexOf(unmeasurable) + 1);
    expect(lines.some((line) => /^단일 파일 착지: /.test(line))).toBe(false);
  });

  it('reconstructs the 2026-08-28 census: 292 landings, 105 single-file; docs 75 is not the signal; source 14 + tests 7 = 21 (~7%) is', () => {
    const singlePaths = [
      ...Array.from({ length: 75 }, (_, i) => `docs/n-${i}.md`),
      ...Array.from({ length: 9 }, (_, i) => `.rules/n-${i}.md`),
      ...Array.from({ length: 7 }, (_, i) => `src/n-${i}.test.ts`),
      ...Array.from({ length: 14 }, (_, i) => `src/n-${i}.ts`),
    ];
    const multiCount = 292 - 105;
    const commits: LandingCommit[] = [
      ...singlePaths.map((path, i) => ({
        hash: hashAt(i),
        subject: `feat: ${path}`,
        files: [path],
        authorEmail: '',
        committedAtMs: 0,
      })),
      ...Array.from({ length: multiCount }, (_, i) => ({
        hash: hashAt(105 + i),
        subject: `feat: multi-${i}`,
        files: [`src/multi-${i}.ts`, `docs/multi-${i}.md`],
        authorEmail: '',
        committedAtMs: 0,
      })),
    ];
    const stats = computeGranularityStats(commits);
    expect(stats.landingCount).toBe(292);
    expect(stats.singleFileLandingCount).toBe(105);
    expect(stats.singleFileLandingRatio).toBeCloseTo(105 / 292);
    expect(stats.singleFileKindCounts).toEqual({ docs: 75, rules: 9, tests: 7, source: 14 });
    const { docs, rules, tests, source } = stats.singleFileKindCounts;
    expect(docs + rules + tests + source).toBe(stats.singleFileLandingCount);
    expect(source + tests).toBe(21);
    expect(Math.round(((source + tests) / stats.landingCount) * 100)).toBe(7);
    expect(docs).toBeGreaterThan(rules + tests + source);
    const lines = formatGranularityReport(stats, '1 day ago');
    expect(lines).toContain('단일 파일 착지: 105 (36.0%)');
    expect(lines).toContain('  문서 75 · 규칙 9 · 시험 7 (봐야 할 모양) · 소스 14');
    expect(lines).not.toContain('단일 파일 착지: 105 (100.0%)');
  });
});

const REPEATED_KIND_LABEL: Record<ReturnType<typeof classifySingleFilePath>, string> = {
  docs: '문서',
  rules: '규칙',
  tests: '시험',
  source: '소스',
};

function repeatedRowMatch(line: string): { label: string; path: string; count: number } | null {
  const match = /^ {2}\[([^\]]+)\] (\S+) {2}(\d+)(?: |$)/.exec(line);
  if (!match) return null;
  return { label: match[1]!, path: match[2]!, count: Number(match[3]) };
}

describe('반복 목록 성격 라벨', () => {
  function mixedKindRepeatedCommits(): LandingCommit[] {
    const files: Array<{ path: string; n: number }> = [
      { path: 'docs/RFC-example.md', n: 5 },
      { path: '.rules/INDEX.md', n: 4 },
      { path: 'docs/goals/example.md', n: 3 },
      { path: 'src/cli/foo.test.ts', n: 2 },
      { path: 'src/cli/foo.ts', n: 2 },
    ];
    const commits: LandingCommit[] = [];
    for (const { path, n } of files) {
      for (let i = 0; i < n; i++) {
        commits.push({
          hash: hashAt(commits.length),
          subject: `feat: ${path} ${i}`,
          files: [path],
          authorEmail: '',
          committedAtMs: 0,
        });
      }
    }
    return commits;
  }

  it('labels every repeated-file row with classifySingleFilePath, keeps the file set, and splits source+tests from docs+rules', () => {
    expect(classifySingleFilePath('docs/goals/example.md')).toBe('docs');
    expect(classifySingleFilePath('docs/goals/any-goal.md')).toBe('docs');

    const commits = mixedKindRepeatedCommits();
    const stats = computeGranularityStats(commits);
    const expectedRepeated = stats.fileFrequencies.filter((entry) => entry.count >= 2);
    expect(expectedRepeated.map((entry) => entry.path)).toEqual([
      'docs/RFC-example.md',
      '.rules/INDEX.md',
      'docs/goals/example.md',
      'src/cli/foo.test.ts',
      'src/cli/foo.ts',
    ]);

    const lines = formatGranularityReport(stats, '1 day ago');
    const header = lines.indexOf('같은 파일을 여러 착지가 건드린 상위:');
    expect(header).toBeGreaterThanOrEqual(0);
    const rows: Array<{ label: string; path: string; count: number }> = [];
    for (let i = header + 1; i < lines.length; i++) {
      const parsed = repeatedRowMatch(lines[i] ?? '');
      if (!parsed) break;
      rows.push(parsed);
    }

    expect(rows).toHaveLength(expectedRepeated.length);
    expect(rows.map((row) => row.path)).toEqual(expectedRepeated.map((entry) => entry.path));
    expect(rows.map((row) => row.count)).toEqual(expectedRepeated.map((entry) => entry.count));
    for (const row of rows) {
      const kind = classifySingleFilePath(row.path);
      expect(row.label).toBe(REPEATED_KIND_LABEL[kind]);
    }
    expect(rows.every((row) => row.label.length > 0)).toBe(true);

    const kindTotals = { docs: 0, rules: 0, tests: 0, source: 0 };
    for (const row of rows) kindTotals[classifySingleFilePath(row.path)] += row.count;
    expect(lines).toContain(
      `  문서 ${kindTotals.docs} · 규칙 ${kindTotals.rules} · 시험 ${kindTotals.tests} · 소스 ${kindTotals.source}`,
    );
    expect(lines).toContain(`  소스·시험 합 ${kindTotals.source + kindTotals.tests}`);
    expect(kindTotals).toEqual({ docs: 8, rules: 4, tests: 2, source: 2 });
    expect(kindTotals.source + kindTotals.tests).toBe(4);
    expect(kindTotals.docs + kindTotals.rules).toBe(12);

    const totalsLine = lines.find((line) => /^ {2}문서 \d+ · 규칙 \d+ · 시험 \d+ · 소스 \d+$/.test(line));
    const sourceTestsLine = lines.find((line) => line.startsWith('  소스·시험 합 '));
    expect(totalsLine).toBeDefined();
    expect(sourceTestsLine).toBeDefined();
    expect(lines.indexOf(sourceTestsLine!)).toBeGreaterThan(lines.indexOf(totalsLine!));
    expect(sourceTestsLine).not.toEqual(totalsLine);
    expect(totalsLine).not.toContain('목록에 안 보이는');
    expect(sourceTestsLine).not.toContain('목록에 안 보이는');

    const legacy = '단일 파일 착지: 16 (100.0%)';
    const legacyKinds = '  문서 8 · 규칙 4 · 시험 2 (봐야 할 모양) · 소스 2';
    expect(lines).toContain(legacy);
    expect(lines).toContain(legacyKinds);
    expect(lines.indexOf(legacyKinds)).toBe(lines.indexOf(legacy) + 1);
    expect(lines.filter((line) => line.startsWith('단일 파일 착지:'))).toEqual([legacy]);
  });

  it('does not drop a mixed-kind file from the repeated list when labeling', () => {
    const commits = mixedKindRepeatedCommits();
    const stats = computeGranularityStats(commits);
    const expectedNames = new Set(
      stats.fileFrequencies.filter((entry) => entry.count >= 2).map((entry) => entry.path),
    );
    const reportNames = new Set(
      formatGranularityReport(stats, '1 day ago')
        .map(repeatedRowMatch)
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => row.path),
    );
    expect(reportNames).toEqual(expectedNames);
    expect(reportNames.size).toBe(5);
  });

  it('totals every repeated file while the visible list stays capped, and names the omitted count', () => {
    const extra = 5;
    const files: Array<{ path: string; n: number }> = [
      ...Array.from({ length: 10 }, (_, i) => ({ path: `docs/top-${String(i).padStart(2, '0')}.md`, n: 20 - i })),
      ...Array.from({ length: 6 }, (_, i) => ({ path: `.rules/top-${String(i).padStart(2, '0')}.md`, n: 10 - i })),
      ...Array.from({ length: 4 }, (_, i) => ({ path: `src/top-${String(i).padStart(2, '0')}.test.ts`, n: 4 })),
      ...Array.from({ length: extra }, (_, i) => ({ path: `src/omitted-${String(i).padStart(2, '0')}.ts`, n: 2 })),
    ];
    expect(files).toHaveLength(TOP_REPEATED_FILE_LIMIT + extra);
    const commits: LandingCommit[] = [];
    for (const { path, n } of files) {
      for (let i = 0; i < n; i++) {
        commits.push({
          hash: hashAt(commits.length),
          subject: `feat: ${path} ${i}`,
          files: [path],
          authorEmail: '',
          committedAtMs: 0,
        });
      }
    }

    const stats = computeGranularityStats(commits);
    expect(stats.fileFrequencies).toHaveLength(files.length);
    const repeated = stats.fileFrequencies.filter((entry) => entry.count >= 2);
    expect(repeated).toHaveLength(files.length);
    expect(repeated.map((entry) => entry.path)).toEqual(files.map((entry) => entry.path));

    const shown = repeated.slice(0, TOP_REPEATED_FILE_LIMIT);
    const omitted = repeated.slice(TOP_REPEATED_FILE_LIMIT);
    expect(shown).toHaveLength(TOP_REPEATED_FILE_LIMIT);
    expect(omitted).toHaveLength(extra);
    expect(omitted.every((entry) => entry.path.startsWith('src/omitted-'))).toBe(true);

    const shownKindTotals = { docs: 0, rules: 0, tests: 0, source: 0 };
    const allKindTotals = { docs: 0, rules: 0, tests: 0, source: 0 };
    for (const entry of shown) shownKindTotals[classifySingleFilePath(entry.path)] += entry.count;
    for (const entry of repeated) allKindTotals[classifySingleFilePath(entry.path)] += entry.count;
    expect(shownKindTotals.source + shownKindTotals.tests).not.toBe(allKindTotals.source + allKindTotals.tests);
    expect(allKindTotals.source).toBe(extra * 2);
    expect(shownKindTotals.source).toBe(0);

    const lines = formatGranularityReport(stats, '1 day ago');
    const header = lines.indexOf('같은 파일을 여러 착지가 건드린 상위:');
    expect(header).toBeGreaterThanOrEqual(0);
    const rows: Array<{ label: string; path: string; count: number }> = [];
    for (let i = header + 1; i < lines.length; i++) {
      const parsed = repeatedRowMatch(lines[i] ?? '');
      if (!parsed) break;
      rows.push(parsed);
    }
    expect(rows).toHaveLength(TOP_REPEATED_FILE_LIMIT);
    expect(rows.map((row) => row.path)).toEqual(shown.map((entry) => entry.path));
    expect(rows.map((row) => row.count)).toEqual(shown.map((entry) => entry.count));
    for (const row of rows) {
      expect(row.label).toBe(REPEATED_KIND_LABEL[classifySingleFilePath(row.path)]);
    }
    expect(rows.some((row) => row.path.startsWith('src/omitted-'))).toBe(false);

    const omittedNote = `목록에 안 보이는 ${extra}개 파일이 이 합에 들어 있다`;
    expect(lines).toContain(
      `  문서 ${allKindTotals.docs} · 규칙 ${allKindTotals.rules} · 시험 ${allKindTotals.tests} · 소스 ${allKindTotals.source} · ${omittedNote}`,
    );
    expect(lines).toContain(`  소스·시험 합 ${allKindTotals.source + allKindTotals.tests} · ${omittedNote}`);
    expect(lines).not.toContain(
      `  문서 ${shownKindTotals.docs} · 규칙 ${shownKindTotals.rules} · 시험 ${shownKindTotals.tests} · 소스 ${shownKindTotals.source}`,
    );
    expect(lines).not.toContain(`  소스·시험 합 ${shownKindTotals.source + shownKindTotals.tests}`);
    expect(lines.filter((line) => line.includes('목록에 안 보이는')).every((line) => line.includes(`${extra}개`))).toBe(true);

    const { docs, rules, tests, source } = stats.singleFileKindCounts;
    expect(docs + rules + tests + source).toBe(stats.singleFileLandingCount);
    const legacy = `단일 파일 착지: ${stats.singleFileLandingCount} (100.0%)`;
    const legacyKinds = `  문서 ${docs} · 규칙 ${rules} · 시험 ${tests} (봐야 할 모양) · 소스 ${source}`;
    expect(lines).toContain(legacy);
    expect(lines).toContain(legacyKinds);
    expect(lines.indexOf(legacyKinds)).toBe(lines.indexOf(legacy) + 1);
  });

  it('does not claim omitted files when the repeated list fits in the visible cap', () => {
    const commits = mixedKindRepeatedCommits();
    const stats = computeGranularityStats(commits);
    const repeated = stats.fileFrequencies.filter((entry) => entry.count >= 2);
    expect(repeated.length).toBeLessThanOrEqual(TOP_REPEATED_FILE_LIMIT);
    const lines = formatGranularityReport(stats, '1 day ago');
    expect(lines.some((line) => line.includes('목록에 안 보이는'))).toBe(false);
    expect(lines).toContain('  문서 8 · 규칙 4 · 시험 2 · 소스 2');
    expect(lines).toContain('  소스·시험 합 4');
  });
});
