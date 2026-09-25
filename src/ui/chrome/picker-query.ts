import {
  filterInputMatches,
  matchesInputSubstring,
  normalizeInputQuery,
} from '../../input/query-match.js';

export function normalizePickerQuery(query: string): string {
  return normalizeInputQuery(query);
}

export function matchesPickerQuery(label: string, query: string): boolean {
  return matchesInputSubstring(label, query);
}

export function filterPickerItemsByLabel<T>(
  items: readonly T[],
  query: string,
  getLabel: (item: T) => string,
): T[] {
  return filterInputMatches(items, query, getLabel, 'substring');
}
