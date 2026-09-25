export function normalizeInputQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesInputSubstring(value: string, query: string): boolean {
  const needle = normalizeInputQuery(query);
  if (!needle) return true;
  return value.toLowerCase().includes(needle);
}

export function matchesInputPrefix(value: string, query: string): boolean {
  const needle = normalizeInputQuery(query);
  if (!needle) return true;
  return value.toLowerCase().startsWith(needle);
}

export function filterInputMatches<T>(
  items: readonly T[],
  query: string,
  getValue: (item: T) => string,
  mode: 'substring' | 'prefix' = 'substring',
): T[] {
  const matcher = mode === 'prefix' ? matchesInputPrefix : matchesInputSubstring;
  return items.filter((item) => matcher(getValue(item), query));
}

export function rankInputMatchesByPrefix<T>(
  items: readonly T[],
  query: string,
  getPrimary: (item: T) => string,
  compare: (a: T, b: T) => number,
): T[] {
  const needle = normalizeInputQuery(query);
  return [...items].sort((a, b) => {
    const aStarts = needle && getPrimary(a).toLowerCase().startsWith(needle) ? 1 : 0;
    const bStarts = needle && getPrimary(b).toLowerCase().startsWith(needle) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    return compare(a, b);
  });
}
