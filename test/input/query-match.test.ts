import { describe, expect, test } from 'bun:test';
import {
  filterInputMatches,
  matchesInputPrefix,
  matchesInputSubstring,
  normalizeInputQuery,
  rankInputMatchesByPrefix,
} from '../../src/input/query-match.js';

describe('input query match helpers', () => {
  test('normalizeInputQuery trims and lowercases input', () => {
    expect(normalizeInputQuery('  HeLLo  ')).toBe('hello');
  });

  test('matchesInputSubstring matches case-insensitively and blank query matches all', () => {
    expect(matchesInputSubstring('README.md', 'read')).toBe(true);
    expect(matchesInputSubstring('README.md', '   ')).toBe(true);
    expect(matchesInputSubstring('README.md', 'src')).toBe(false);
  });

  test('matchesInputPrefix matches case-insensitively', () => {
    expect(matchesInputPrefix('activate', 'ac')).toBe(true);
    expect(matchesInputPrefix('activate', 'CT')).toBe(false);
  });

  test('filterInputMatches filters by substring or prefix mode', () => {
    const items = [{ value: 'activate' }, { value: 'list' }, { value: 'clear' }];
    expect(filterInputMatches(items, 'a', (item) => item.value, 'substring')).toEqual([
      { value: 'activate' },
      { value: 'clear' },
    ]);
    expect(filterInputMatches(items, 'a', (item) => item.value, 'prefix')).toEqual([
      { value: 'activate' },
    ]);
  });

  test('rankInputMatchesByPrefix promotes prefix hits before fallback compare', () => {
    const items = [{ value: 'beta-tool' }, { value: 'alpha-skill' }, { value: 'tool-alpha' }];
    expect(rankInputMatchesByPrefix(
      items,
      'al',
      (item) => item.value,
      (a, b) => a.value.localeCompare(b.value),
    )).toEqual([
      { value: 'alpha-skill' },
      { value: 'beta-tool' },
      { value: 'tool-alpha' },
    ]);
  });
});
