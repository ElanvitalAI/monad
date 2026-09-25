import { describe, expect, test } from 'bun:test';
import {
  cycleCursor,
  moveCursorBy,
  moveCursorByPage,
  moveCursorToEdge,
} from '../../../src/ui/widgets/selection-cursor.js';

describe('selection cursor helpers', () => {
  test('clamps single-step movement within bounds', () => {
    expect(moveCursorBy(0, 4, -1)).toBe(0);
    expect(moveCursorBy(1, 4, 1)).toBe(2);
    expect(moveCursorBy(3, 4, 1)).toBe(3);
  });

  test('treats empty collections as cursor 0', () => {
    expect(moveCursorBy(4, 0, 1)).toBe(0);
    expect(moveCursorByPage(4, 0, 5, 1)).toBe(0);
    expect(moveCursorToEdge(0, 'end')).toBe(0);
  });

  test('applies page jumps and edge moves consistently', () => {
    expect(moveCursorByPage(5, 12, 4, -1)).toBe(1);
    expect(moveCursorByPage(5, 12, 4, 1)).toBe(9);
    expect(moveCursorToEdge(12, 'start')).toBe(0);
    expect(moveCursorToEdge(12, 'end')).toBe(11);
  });

  test('cycles selection indexes for tab/button-bar style navigation', () => {
    expect(cycleCursor(0, 4, -1)).toBe(3);
    expect(cycleCursor(3, 4, 1)).toBe(0);
    expect(cycleCursor(1, 4, 2)).toBe(3);
    expect(cycleCursor(1, 0, 2)).toBe(0);
  });
});
