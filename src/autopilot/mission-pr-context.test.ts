// PR -> revise context 순수함수 단위테스트(대표 2026-07-16 · PR 자동 분해).
import { test, expect, describe } from 'bun:test';
import {
  extractDocPaths, buildPrContextString, fetchPrContext, parsePrArg, type PrInfo,
} from './mission-pr-context.js';

describe('parsePrArg', () => {
  test('숫자·문자·쉼표·# 파싱', () => {
    expect(parsePrArg(4307)).toEqual([4307]);
    expect(parsePrArg('4307')).toEqual([4307]);
    expect(parsePrArg('4306,4307')).toEqual([4306, 4307]);
    expect(parsePrArg('#4306 4307')).toEqual([4306, 4307]);
    expect(parsePrArg('')).toEqual([]);
    expect(parsePrArg(null)).toEqual([]);
    expect(parsePrArg('abc')).toEqual([]);
  });
});

describe('extractDocPaths', () => {
  test('변경파일 중 RFC/PLAN 문서 + body 언급 docs 경로 추출', () => {
    const prs: PrInfo[] = [{
      number: 4307, title: 't',
      body: '설계는 docs/RFC-defcon-market-alertness-regime-loop-2026-07-16.md 참조.',
      files: ['docs/RFC-defcon-market-alertness-regime-loop-2026-07-16.md', 'src/foo.ts'],
    }];
    const paths = extractDocPaths(prs);
    expect(paths).toContain('docs/RFC-defcon-market-alertness-regime-loop-2026-07-16.md');
    expect(paths).not.toContain('src/foo.ts');   // 코드파일 제외
  });
  test('일반 md(README 등 non-RFC)는 변경파일에서 제외', () => {
    const prs: PrInfo[] = [{ number: 1, title: 't', body: '', files: ['README.md'] }];
    expect(extractDocPaths(prs)).toEqual([]);
  });
});

describe('buildPrContextString', () => {
  test('PR 제목·본문·코드파일·문서발췌 합성', () => {
    const s = buildPrContextString(
      [{ number: 4307, title: 'DEFCON RFC v2', body: '국면 감시 루프', files: ['src/a.ts', 'docs/RFC-x.md'] }],
      { 'docs/RFC-x.md': '# RFC\n국면 공용화 설계' },
    );
    expect(s).toContain('PR #4307: DEFCON RFC v2');
    expect(s).toContain('국면 감시 루프');
    expect(s).toContain('변경 코드파일(1): src/a.ts');
    expect(s).toContain('연관 설계문서 docs/RFC-x.md');
    expect(s).toContain('국면 공용화 설계');
    expect(s).toContain('재분해');   // 정정 지시 헤더
  });
});

describe('fetchPrContext — IO seam 주입', () => {
  const deps = {
    ghView: (n: number): PrInfo | null => n === 4307
      ? { number: 4307, title: 'DEFCON RFC', body: 'docs/RFC-defcon.md 설계', files: ['docs/RFC-defcon.md'] }
      : null,
    readDoc: (p: string): string | null => p === 'docs/RFC-defcon.md' ? '# DEFCON\n국면 감시 루프 에이전트' : null,
  };
  test('PR 번호 -> 제목+본문+문서발췌 context', () => {
    const ctx = fetchPrContext([4307], deps);
    expect(ctx).toContain('PR #4307: DEFCON RFC');
    expect(ctx).toContain('국면 감시 루프 에이전트');
  });
  test('없는 PR -> 빈 문자열(fail-soft)', () => {
    expect(fetchPrContext([9999], deps)).toBe('');
  });
  test('빈 입력 -> 빈 문자열', () => {
    expect(fetchPrContext([], deps)).toBe('');
  });
});
