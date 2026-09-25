import { expect, test } from 'bun:test';
import { collectTags, otherTags, tagRows, type Result } from './goal-lint-ab.js';

const finding = (tag: string) => ({ level: 'warn', tag, message: `${tag} message` });

test('collectTags includes tags outside the former list once, in stable lexical order', () => {
  const before: Result = {
    'a.md': [finding('traced-path'), finding('blanket-invariant')],
    'b.md': [finding('blanket-invariant')],
  };
  const after: Result = {
    'a.md': [finding('canonical-structure'), finding('traced-path')],
  };

  expect(collectTags(before, after)).toEqual(['blanket-invariant', 'canonical-structure', 'traced-path']);
  expect(collectTags(before, after)).toEqual(collectTags(before, after));
});

test('tagRows shows a one-sided observed tag with zero for the missing tree', () => {
  const files = ['a.md', 'b.md'];
  const before: Result = { 'a.md': [finding('blanket-invariant')] };
  const after: Result = { 'b.md': [finding('canonical-structure')] };
  const tags = collectTags(before, after);

  expect(tagRows(files, before, after, tags)).toEqual([
    { tag: 'blanket-invariant', beforeCount: 1, afterCount: 0 },
    { tag: 'canonical-structure', beforeCount: 0, afterCount: 1 },
  ]);
});

test('observed one-sided tags enter the drift scope unless they are changed checks', () => {
  const before: Result = { 'a.md': [finding('blanket-invariant')] };
  const after: Result = {};
  const tags = collectTags(before, after);

  expect(otherTags(tags, new Set(['shell-damage']))).toEqual(['blanket-invariant']);
  expect(otherTags(['blanket-invariant', 'shell-damage'], new Set(['shell-damage']))).toEqual(['blanket-invariant']);
});

test('empty results produce no tags or table rows without throwing', () => {
  const tags = collectTags({}, {});

  expect(tags).toEqual([]);
  expect(tagRows([], {}, {}, tags)).toEqual([]);
  expect(otherTags(tags, new Set(['shell-damage']))).toEqual([]);
});
