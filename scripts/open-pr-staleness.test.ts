import { describe, expect, test } from 'bun:test';
import { auditOpenPullRequests, classifyOpenPullRequests, DEFAULT_STALENESS_DAYS, openPullRequestListArgs, parseThresholdDays, report, runCli, type OpenPullRequest } from './open-pr-staleness.js';

const clock = new Date('2026-09-13T12:00:00Z');
const pr = (number: number, title: string, updatedAt: string, labels: string[] = [], isDraft = false, headRefName = 'feature/topic'): OpenPullRequest => ({ number, title, updatedAt, labels, isDraft, headRefName });

describe('open-pr-staleness', () => {
  test('실물 네 세대 상설 조율 채널과 영어 제어는 나이보다 먼저 의도적 상설로 분류한다', () => {
    const rows = classifyOpenPullRequests([
      pr(5730, '⛔ 상설 조율 채널 (머지 금지 · S 리딩) — 세 지표: NL 성숙도 · ReAct 수준 · 수렴화', '2026-08-01T12:00:00Z'),
      pr(8328, '⛔ 머지 금지 — 상설 조율 채널 «2» (#5730 코멘트 2500 상한 후속)', '2026-08-01T12:00:00Z'),
      pr(12577, '⛔ 머지 금지 — 상설 조율 채널 «3» (#8328 코멘트 2500 상한 후속)', '2026-08-01T12:00:00Z'),
      pr(16815, '⛔ 머지 금지 — 상설 조율 채널 «4» (#12577 코멘트 2500 상한 후속)', '2026-08-01T12:00:00Z'),
      pr(4, 'DO NOT MERGE — english control', '2026-08-01T12:00:00Z'),
      pr(5, 'ordinary stale work', '2026-08-01T12:00:00Z'),
      pr(6, 'recent', '2026-09-12T12:00:00Z', ['unrelated']),
    ], DEFAULT_STALENESS_DAYS, clock);
    expect(rows.map(row => row.classification)).toEqual(['intentional-permanent', 'intentional-permanent', 'intentional-permanent', 'intentional-permanent', 'intentional-permanent', 'stale', 'recent']);
    expect(rows.filter(row => row.classification === 'intentional-permanent').map(row => row.pullRequest.number)).toEqual([5730, 8328, 12577, 16815, 4]);
  });

  test('제목 또는 라벨의 조건부 보류는 나이보다 먼저 별도 갈래로 분류하고 네 갈래 이름을 보고한다', () => {
    const rows = classifyOpenPullRequests([
      pr(11263, '⏸️ [보류·조건부] preexisting-red-query — CLI 노출과 «한 판»으로 올릴 때 되살린다 (\u{1F451} 2026-08-22)', '2026-08-01T12:00:00Z'),
      pr(7, 'label hold', '2026-08-01T12:00:00Z', ['[보류·조건부]']),
      pr(8, 'archive', '2026-08-01T12:00:00Z', ['never merge']),
      pr(9, 'recent', '2026-09-12T12:00:00Z'),
      pr(10, 'ordinary stale work', '2026-08-01T12:00:00Z'),
    ], 14, clock);
    const lines: string[] = [];
    report(rows, 14, line => lines.push(line));
    expect(rows.map(row => row.classification)).toEqual(['conditional-hold', 'conditional-hold', 'intentional-permanent', 'recent', 'stale']);
    expect(lines).toEqual([
      'open-pr-staleness · 임계 14일 · 의도적 상설 1 · 조건부 보류 2 · 최근 1 · ⚠️ 정지 1',
      '의도적 상설 PR · #8 archive',
      '조건부 보류 PR · #11263 ⏸️ [보류·조건부] preexisting-red-query — CLI 노출과 «한 판»으로 올릴 때 되살린다 (\u{1F451} 2026-08-22) · #7 label hold',
      '최근 PR · #9 recent',
      '⚠️ 정지 PR · #10 ordinary stale work',
    ]);
  });

  test('임계는 기본 14일이며 인자로 바꿀 수 있다', () => {
    expect(parseThresholdDays([])).toBe(14);
    expect(parseThresholdDays(['--days=3'])).toBe(3);
    expect(() => parseThresholdDays(['--days=-1'])).toThrow('--days must be a non-negative integer');
    expect(classifyOpenPullRequests([pr(8, 'four days', '2026-09-09T12:00:00Z')], 3, clock)[0]?.classification).toBe('stale');
  });

  test('gh 실행기를 주입하고 전체 open-PR 조회 명령만 사용한다', () => {
    const calls: string[][] = [];
    const rows = auditOpenPullRequests(args => {
      calls.push([...args]);
      return { status: 0, stdout: JSON.stringify([pr(9, 'outside prefix stale', '2026-08-01T00:00:00Z', [], false, 'ordinary-branch')]), stderr: '' };
    }, 14, clock);
    expect(calls).toEqual([openPullRequestListArgs()]);
    expect(calls[0]).not.toContain('--draft');
    expect(calls[0]).not.toContain('--label');
    expect(rows[0]?.classification).toBe('stale');
  });

  test('gh 조회 실패는 0건 대신 못 셌다와 비영 종료 코드를 낸다', () => {
    const lines: string[] = [];
    expect(runCli([], () => ({ status: 1, stdout: '', stderr: 'network unavailable' }), line => lines.push(line), clock)).toBe(1);
    expect(lines).toEqual(['⛔ open-pr-staleness · 못 셌다 · network unavailable']);
  });
});
