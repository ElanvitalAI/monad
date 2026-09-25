import { describe, expect, test } from 'bun:test';

import { createFinderModal, rankFinderItems } from '../src/finder/finder-modal.js';
import type { FinderItem } from '../src/finder/finder-modal.js';

const ITEMS: FinderItem[] = [
  { relPath: 'button/docs/readme.md', absPath: '/repo/button/docs/readme.md' },
  { relPath: 'src/components/Button.tsx', absPath: '/repo/src/components/Button.tsx' },
  { relPath: 'src/app.ts', absPath: '/repo/src/app.ts' },
];

function bounds() {
  return { row: 5, col: 5, width: 72, height: 10 };
}

describe('rankFinderItems', () => {
  test('ranks basename matches before directory path matches', () => {
    const ranked = rankFinderItems(ITEMS, 'button');
    expect(ranked.map(i => i.relPath)).toEqual([
      'src/components/Button.tsx',
      'button/docs/readme.md',
    ]);
  });

  test('empty query preserves original order', () => {
    expect(rankFinderItems(ITEMS, '').map(i => i.relPath))
      .toEqual(ITEMS.map(i => i.relPath));
  });
});

describe('createFinderModal', () => {
  test('query uses basename-first ranking', () => {
    const modal = createFinderModal({
      items: ITEMS,
      bounds: bounds(),
      width: 72,
      onAccept: () => {},
    });
    for (const ch of 'button') modal.type(ch);
    expect(modal.state().items.map(i => String(i.payload))).toEqual([
      '/repo/src/components/Button.tsx',
      '/repo/button/docs/readme.md',
    ]);
  });

  test('accept returns the ranked selection', () => {
    let picked: FinderItem | null = null;
    const modal = createFinderModal({
      items: ITEMS,
      bounds: bounds(),
      width: 72,
      onAccept: (item) => { picked = item; },
    });
    for (const ch of 'button') modal.type(ch);
    modal.accept();
    expect(picked?.relPath).toBe('src/components/Button.tsx');
  });

  test('onHover fires with FinderItem on initial mount + selection change', () => {
    const hovered: Array<FinderItem | null> = [];
    const modal = createFinderModal({
      items: ITEMS,
      bounds: bounds(),
      width: 72,
      onAccept: () => {},
      onHover: (item) => { hovered.push(item); },
    });
    // Initial mount primes the hook with the first item.
    expect(hovered).toHaveLength(1);
    expect(hovered[0]?.relPath).toBe('button/docs/readme.md');
    modal.down();
    expect(hovered.at(-1)?.relPath).toBe('src/components/Button.tsx');
    modal.up();
    expect(hovered.at(-1)?.relPath).toBe('button/docs/readme.md');
  });

  test('onHover fires null when filter empties the list', () => {
    const hovered: Array<FinderItem | null> = [];
    const modal = createFinderModal({
      items: ITEMS,
      bounds: bounds(),
      width: 72,
      onAccept: () => {},
      onHover: (item) => { hovered.push(item); },
    });
    for (const ch of 'zzz') modal.type(ch);
    expect(hovered.at(-1)).toBeNull();
  });

  test('onHover unset is still a valid spec', () => {
    const modal = createFinderModal({
      items: ITEMS,
      bounds: bounds(),
      width: 72,
      onAccept: () => {},
    });
    expect(() => modal.down()).not.toThrow();
  });
});
