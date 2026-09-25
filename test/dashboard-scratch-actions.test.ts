import { describe, expect, test } from 'bun:test';

import { runScratchListNavigation } from '../src/dashboard/input/scratch-actions.js';

describe('dashboard scratch actions', () => {
  test('navigates bounded scratch lists', () => {
    expect(runScratchListNavigation({ name: 'down', raw: '' } as any, 1, 4)).toEqual({
      handled: true,
      cursor: 2,
    });
    expect(runScratchListNavigation({ name: 'up', raw: '' } as any, 1, 4)).toEqual({
      handled: true,
      cursor: 0,
    });
    expect(runScratchListNavigation({ name: 'end', raw: '' } as any, 1, 4)).toEqual({
      handled: true,
      cursor: 3,
    });
  });

  test('home still resolves on empty scratch lists', () => {
    expect(runScratchListNavigation({ name: 'home', raw: '' } as any, 3, 0)).toEqual({
      handled: true,
      cursor: 0,
    });
    expect(runScratchListNavigation({ name: 'enter', raw: '' } as any, 3, 0)).toEqual({
      handled: false,
      cursor: 3,
    });
  });
});
