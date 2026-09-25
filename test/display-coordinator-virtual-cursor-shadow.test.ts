import { describe, expect, test } from 'bun:test';

import { DisplayCoordinator } from '../src/display/coordinator.js';

describe('U4 · virtualCursorRegistryAPI()', () => {
  test('returns a stable handle across calls', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const a = coord.virtualCursorRegistryAPI();
    const b = coord.virtualCursorRegistryAPI();
    expect(a).toBe(b);
  });

  test('registry stays independent from physical cursor ownership', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    coord.setCursor({ row: 5, col: 9, visible: true });
    coord.virtualCursorRegistryAPI().upsert({
      id: 'inactive-caret',
      kind: 'caret',
      row: 7,
      col: 2,
      owner: 'workspace:left',
      scope: 'workspace',
    });
    expect(coord.virtualCursorRegistryAPI().list()).toEqual([{
      id: 'inactive-caret',
      kind: 'caret',
      row: 7,
      col: 2,
      owner: 'workspace:left',
      scope: 'workspace',
    }]);
    expect(coord.currentFocus()).toBeNull();
  });
});
