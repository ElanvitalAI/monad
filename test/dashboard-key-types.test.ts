import { describe, expect, test } from 'bun:test';

import { toDashboardKeyEvent } from '../src/dashboard/input/key-types.js';

describe('toDashboardKeyEvent', () => {
  test('maps dashboard Key into plugin KeyEvent', () => {
    expect(toDashboardKeyEvent({
      name: 'x',
      ctrl: true,
      shift: false,
      alt: true,
      raw: '\u001bx',
    })).toEqual(expect.objectContaining({
      name: 'x',
      ctrl: true,
      shift: false,
      alt: true,
      sequence: '\u001bx',
    }));
  });

  test('normalizes optional booleans', () => {
    expect(toDashboardKeyEvent({
      name: 'enter',
      ctrl: false,
      shift: false,
    })).toEqual(expect.objectContaining({
      name: 'enter',
      ctrl: false,
      shift: false,
      alt: false,
      sequence: undefined,
    }));
  });
});
