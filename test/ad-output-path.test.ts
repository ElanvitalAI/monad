import { expect, test } from 'bun:test';
import { adMasterName, adProjectDir, adSubDir } from '../src/ad-pipeline/output-path.js';

const input = { home: '/Users/x', slug: 'umbrella', date: '2026-09-11' };

test('builds the documented project hierarchy from caller-provided home', () => {
  expect(adProjectDir(input)).toBe('/Users/x/Movies/monad-ad/2026-09-11-umbrella');
});

test('builds the documented master filename', () => {
  expect(adMasterName('umbrella', 3, '9x16')).toBe('umbrella_v3_9x16.mp4');
});

test('builds clips and frames below the project directory', () => {
  expect(adSubDir(input, 'clips')).toBe('/Users/x/Movies/monad-ad/2026-09-11-umbrella/clips');
  expect(adSubDir(input, 'frames')).toBe('/Users/x/Movies/monad-ad/2026-09-11-umbrella/frames');
});

test('returns reason-bearing error objects for empty, traversal, and separator slugs without throwing', () => {
  for (const slug of ['', '..', 'nested/project', 'nested\\project']) {
    expect(() => adProjectDir({ ...input, slug })).not.toThrow();
    expect(adProjectDir({ ...input, slug })).toEqual({ error: expect.stringContaining('slug') });
  }
});

test('returns reason-bearing error objects for empty, separator, malformed, and calendar-invalid dates without throwing', () => {
  for (const date of ['', '..', '2026/09/11', '2026-02-30']) {
    expect(() => adProjectDir({ ...input, date })).not.toThrow();
    expect(adProjectDir({ ...input, date })).toEqual({ error: expect.stringContaining('date') });
  }
});

test('returns error objects for invalid master filename inputs', () => {
  expect(adMasterName('../umbrella', 3, '9x16')).toEqual({ error: expect.stringContaining('slug') });
  expect(adMasterName('umbrella', 0, '9x16')).toEqual({ error: expect.stringContaining('version') });
  expect(adMasterName('umbrella', 3, '9/16')).toEqual({ error: expect.stringContaining('aspect') });
});

test('does not introduce filesystem or homedir dependencies', async () => {
  const source = await Bun.file(new URL('../src/ad-pipeline/output-path.ts', import.meta.url)).text();
  expect(source).not.toMatch(/from ['"]node:(?:fs|os)['"]|homedir\(|mkdir(?:Sync)?\(/);
});
