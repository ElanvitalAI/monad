import { describe, expect, test } from 'bun:test';
import { fuzzyMatch, fuzzyRank } from '../src/expression/index.js';

describe('expression/fuzzy · fuzzyMatch', () => {
  test('empty query → score 0, no indices', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  test('empty target with non-empty query → null', () => {
    expect(fuzzyMatch('q', '')).toBeNull();
  });

  test('exact substring fast-path scores highest', () => {
    const m = fuzzyMatch('foo', 'foobar');
    expect(m).not.toBeNull();
    // base 200 + length 3 + prefix 50 + word boundary 30 (index 0)
    expect(m!.score).toBe(200 + 3 + 50 + 30);
    expect(m!.indices).toEqual([0, 1, 2]);
  });

  test('case-insensitive matching', () => {
    expect(fuzzyMatch('FOO', 'foobar')).not.toBeNull();
    expect(fuzzyMatch('Foo', 'FOOBAR')).not.toBeNull();
  });

  test('subsequence match returns indices in order', () => {
    const m = fuzzyMatch('abc', 'aXbYc');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([0, 2, 4]);
    expect(m!.score).toBeGreaterThan(0);
  });

  test('contiguous chars score higher than scattered', () => {
    const tight = fuzzyMatch('abc', 'abcXYZ');
    const loose = fuzzyMatch('abc', 'aXbYcZ');
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight!.score).toBeGreaterThan(loose!.score);
  });

  test('word-boundary match scores higher than mid-word', () => {
    const boundary = fuzzyMatch('p', 'foo bar');
    // p doesn't appear — pick another that does
    const wbMatch = fuzzyMatch('b', 'foo bar');
    const midMatch = fuzzyMatch('o', 'foo');
    expect(boundary).toBeNull();
    expect(wbMatch).not.toBeNull();
    expect(midMatch).not.toBeNull();
    // 'b' lands at index 4 after space → word boundary bonus
    // 'o' lands at index 1 → no boundary
    expect(wbMatch!.score).toBeGreaterThan(midMatch!.score);
  });

  test('prefix bonus when first match is at index 0', () => {
    const a = fuzzyMatch('a', 'apple');
    const b = fuzzyMatch('p', 'apple'); // first match at index 1
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  test('returns null when query characters not all in target order', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull();
    expect(fuzzyMatch('abc', 'cba')).toBeNull();
    expect(fuzzyMatch('foo', 'fo')).toBeNull(); // not enough chars
  });

  test('longer match scores higher than shorter (more matched chars)', () => {
    const longer = fuzzyMatch('abcd', 'abcdef');
    const shorter = fuzzyMatch('abc', 'abcdef');
    expect(longer).not.toBeNull();
    expect(shorter).not.toBeNull();
    expect(longer!.score).toBeGreaterThan(shorter!.score);
  });

  test('substring at non-zero index still matches with word-boundary bonus', () => {
    const m = fuzzyMatch('bar', 'foo-bar');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([4, 5, 6]);
    expect(m!.score).toBeGreaterThanOrEqual(200);
  });

  test('indices only include matched positions', () => {
    const m = fuzzyMatch('abc', 'aXbYcZ');
    expect(m).not.toBeNull();
    for (const i of m!.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan('aXbYcZ'.length);
    }
  });
});

describe('expression/fuzzy · fuzzyRank', () => {
  const items = [
    { id: 'a', label: 'apple' },
    { id: 'b', label: 'banana' },
    { id: 'c', label: 'cherry' },
    { id: 'p', label: 'pineapple' },
    { id: 'g', label: 'grape' },
  ];

  test('empty query returns all items in original order with score 0', () => {
    const out = fuzzyRank(items, '', (it) => it.label);
    expect(out.length).toBe(items.length);
    expect(out[0]!.item.id).toBe('a');
    expect(out[4]!.item.id).toBe('g');
    for (const r of out) {
      expect(r.match.score).toBe(0);
    }
  });

  test('exact match wins', () => {
    const out = fuzzyRank(items, 'apple', (it) => it.label);
    expect(out[0]!.item.id).toBe('a');
  });

  test('substring match in middle of label still ranks', () => {
    const out = fuzzyRank(items, 'apple', (it) => it.label);
    const ids = out.map((r) => r.item.id);
    expect(ids).toContain('p'); // pineapple has substring "apple"
  });

  test('non-matching items are filtered out', () => {
    const out = fuzzyRank(items, 'apl', (it) => it.label);
    const ids = out.map((r) => r.item.id);
    expect(ids).toContain('a');
    expect(ids).toContain('p');
    // banana and cherry don't contain a-p-l in order
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('g');
  });

  test('stable ordering on tie scores', () => {
    const tied = [
      { id: 'a', label: 'foo' },
      { id: 'b', label: 'foo' },
      { id: 'c', label: 'foo' },
    ];
    const out = fuzzyRank(tied, 'foo', (it) => it.label);
    expect(out.map((r) => r.item.id)).toEqual(['a', 'b', 'c']);
  });

  test('higher-scoring match comes first', () => {
    const list = [
      { id: 'mid', label: 'foobar' }, // matches at index 0 (prefix)
      { id: 'late', label: 'xxx-foobar' }, // matches at index 4 (word boundary)
      { id: 'scatter', label: 'fXoXoXbXaXr' }, // subsequence
    ];
    const out = fuzzyRank(list, 'foobar', (it) => it.label);
    // Prefix gets the prefix bonus on top of substring bonus.
    expect(out[0]!.item.id).toBe('mid');
    // Scatter ranks below since it doesn't get the substring base.
    expect(out[out.length - 1]!.item.id).toBe('scatter');
  });

  test('returns empty for query with no matches', () => {
    const out = fuzzyRank(items, 'zzz', (it) => it.label);
    expect(out.length).toBe(0);
  });
});
