import { describe, expect, test } from 'bun:test';
import {
  filterPickerItemsByLabel,
  matchesPickerQuery,
  normalizePickerQuery,
} from '../../../src/ui/chrome/picker-query.js';

describe('picker query helpers', () => {
  test('normalizePickerQuery trims and lowercases input', () => {
    expect(normalizePickerQuery('  HeLLo  ')).toBe('hello');
  });

  test('matchesPickerQuery treats blank query as match-all', () => {
    expect(matchesPickerQuery('Anything', '   ')).toBe(true);
  });

  test('matchesPickerQuery matches case-insensitively', () => {
    expect(matchesPickerQuery('SSH mba MacBook Air', 'mba')).toBe(true);
    expect(matchesPickerQuery('SSH mba MacBook Air', 'AIR')).toBe(true);
    expect(matchesPickerQuery('SSH mba MacBook Air', 'node-b')).toBe(false);
  });

  test('filterPickerItemsByLabel keeps matching items only', () => {
    const items = [{ label: 'mba' }, { label: 'node-b' }, { label: 'node-c' }];
    expect(filterPickerItemsByLabel(items, 'c', (item) => item.label)).toEqual([
      { label: 'node-c' },
    ]);
  });
});
