import { describe, expect, test } from 'bun:test';

import { renderHandleStatusChip } from '../src/status/chip.js';

// ANSI strip — chalk emits escape sequences we want to ignore when
// checking width / glyph / word.
function strip(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('SRF-3 renderHandleStatusChip', () => {
  test('running + foreground share the same "▶ run" chip', () => {
    const a = strip(renderHandleStatusChip('running'));
    const b = strip(renderHandleStatusChip('foreground'));
    expect(a.trim()).toBe('▶ run');
    expect(b.trim()).toBe('▶ run');
    expect(a).toBe(b);
  });

  test('backgrounded + background share the same "⏸ bg" chip', () => {
    const a = strip(renderHandleStatusChip('backgrounded'));
    const b = strip(renderHandleStatusChip('background'));
    expect(a.trim()).toBe('⏸ bg');
    expect(b).toBe(a);
  });

  test('completed + exited share the same "✓ done" chip', () => {
    const a = strip(renderHandleStatusChip('completed'));
    const b = strip(renderHandleStatusChip('exited'));
    expect(a.trim()).toBe('✓ done');
    expect(b).toBe(a);
  });

  test('killed → "✗ killed"', () => {
    const chip = strip(renderHandleStatusChip('killed'));
    expect(chip.trim()).toBe('✗ killed');
  });

  test('ascii opt drops unicode glyph', () => {
    const chip = strip(renderHandleStatusChip('running', { ascii: true }));
    expect(chip.trim()).toBe('> run');
  });

  test('fixed width — all non-killed chips land at 7 visible cols', () => {
    const run = strip(renderHandleStatusChip('running'));
    const bg = strip(renderHandleStatusChip('backgrounded'));
    const done = strip(renderHandleStatusChip('completed'));
    expect(run.length).toBe(7);
    expect(bg.length).toBe(7);
    expect(done.length).toBe(7);
  });

  test('killed chip overflows rather than truncate (info preserved)', () => {
    const killed = strip(renderHandleStatusChip('killed'));
    expect(killed.length).toBeGreaterThanOrEqual(7);
    expect(killed).toContain('killed');
  });
});
