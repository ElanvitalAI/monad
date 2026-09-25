// ── HUD tests — segment ordering, overflow, purity ──

import { describe, test, expect } from 'bun:test';
import { createHud, setSegment, clearSegment, renderHud } from '../src/panes/hud.js';
import { stripAnsi } from '../src/tui.js';

describe('HUD', () => {
  test('empty state renders empty string', () => {
    expect(renderHud(createHud(), 80)).toBe('');
  });

  test('segments render in priority order then alphabetically', () => {
    const hud = createHud();
    setSegment(hud, 'zzz', 'Z', 10);   // low priority = left
    setSegment(hud, 'aaa', 'A', 90);   // high priority = right
    setSegment(hud, 'mmm', 'M', 50);
    const plain = stripAnsi(renderHud(hud, 80));
    expect(plain.indexOf('Z')).toBeLessThan(plain.indexOf('M'));
    expect(plain.indexOf('M')).toBeLessThan(plain.indexOf('A'));
  });

  test('tail-ellipsizes when content exceeds width', () => {
    const hud = createHud();
    setSegment(hud, 'a', 'hello world this segment is pretty long');
    setSegment(hud, 'b', 'and so is this one');
    const out = renderHud(hud, 20);
    expect(stripAnsi(out).length).toBeLessThanOrEqual(20);
  });

  test('clearSegment removes the entry', () => {
    const hud = createHud();
    setSegment(hud, 'mode', 'browse');
    setSegment(hud, 'tokens', '1.2k');
    clearSegment(hud, 'mode');
    const plain = stripAnsi(renderHud(hud, 80));
    expect(plain).not.toContain('browse');
    expect(plain).toContain('1.2k');
  });

  test('setSegment preserves priority if not re-specified', () => {
    const hud = createHud();
    setSegment(hud, 'a', 'first', 10);
    setSegment(hud, 'b', 'second', 90);
    setSegment(hud, 'a', 'updated');   // no priority → keep 10
    const plain = stripAnsi(renderHud(hud, 80));
    expect(plain.indexOf('updated')).toBeLessThan(plain.indexOf('second'));
  });

  test('is pure — same state renders identically', () => {
    const hud = createHud();
    setSegment(hud, 'mode', 'browse');
    setSegment(hud, 'tokens', '1.2k');
    expect(renderHud(hud, 80)).toEqual(renderHud(hud, 80));
  });
});
