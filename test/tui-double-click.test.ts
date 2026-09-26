// MD1 — SGR 1006 double-click synthesis tests.
//
// The parser should:
//   - emit `click` on the 1st primary press
//   - emit `double-click` on the 2nd primary press when it arrives
//     within ELANOUS_DOUBLE_CLICK_MS (default 300) at the exact same
//     (row, col)
//   - fall back to `click` when the 2nd press lands too late / at
//     a different cell
//   - respect ELANOUS_DOUBLE_CLICK_MS env override
//   - drop back to a single `click` after a completed pair (no
//     triple-click cascade)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { splitKeys, __resetDoubleClickState } from '../src/tui.js';

/** Helper — synth a primary-button press SGR at (row, col). */
function press(row: number, col: number): string {
  return `\x1b[<0;${col};${row}M`;
}
/** Helper — same for release. */
function release(row: number, col: number): string {
  return `\x1b[<0;${col};${row}m`;
}

function mouseEvent(bytes: string) {
  const keys = splitKeys(bytes);
  const k = keys[0];
  return k?.mouse ?? null;
}

describe('MD1 — SGR double-click synthesis', () => {
  beforeEach(() => __resetDoubleClickState());
  afterEach(() => __resetDoubleClickState());

  test('1st press emits click', () => {
    const ev = mouseEvent(press(5, 10));
    expect(ev).toMatchObject({ type: 'click', row: 5, col: 10 });
  });

  test('release emits release', () => {
    mouseEvent(press(5, 10));
    const ev = mouseEvent(release(5, 10));
    expect(ev?.type).toBe('release');
  });

  test('2nd press at same cell immediately → double-click', () => {
    mouseEvent(press(5, 10));
    mouseEvent(release(5, 10));
    const ev = mouseEvent(press(5, 10));
    expect(ev).toMatchObject({ type: 'double-click', row: 5, col: 10 });
  });

  test('2nd press at different cell → click (not double)', () => {
    mouseEvent(press(5, 10));
    mouseEvent(release(5, 10));
    const ev = mouseEvent(press(5, 11));
    expect(ev?.type).toBe('click');
  });

  test('2nd press at same cell after threshold → click (not double)', async () => {
    // The real detector uses Date.now(); stash + restore.
    const origEnv = process.env.ELANOUS_DOUBLE_CLICK_MS;
    process.env.ELANOUS_DOUBLE_CLICK_MS = '50';
    try {
      __resetDoubleClickState();
      mouseEvent(press(5, 10));
      mouseEvent(release(5, 10));
      await new Promise(r => setTimeout(r, 80));
      const ev = mouseEvent(press(5, 10));
      expect(ev?.type).toBe('click');
    } finally {
      if (origEnv === undefined) delete process.env.ELANOUS_DOUBLE_CLICK_MS;
      else process.env.ELANOUS_DOUBLE_CLICK_MS = origEnv;
    }
  });

  test('triple press: click, double-click, click (no triple cascade)', () => {
    const a = mouseEvent(press(3, 7));
    mouseEvent(release(3, 7));
    const b = mouseEvent(press(3, 7));
    mouseEvent(release(3, 7));
    const c = mouseEvent(press(3, 7));
    expect(a?.type).toBe('click');
    expect(b?.type).toBe('double-click');
    expect(c?.type).toBe('click');
  });

  test('right-click press does not arm double-click detector for primary', () => {
    // Right-click = baseBtn=2. Shouldn't interfere with primary timing.
    mouseEvent('\x1b[<2;10;5M');   // right press
    const ev = mouseEvent(press(5, 10));
    expect(ev?.type).toBe('click');   // NOT double-click
  });

  test('drag events do not interfere', () => {
    mouseEvent(press(5, 10));
    // Motion-with-button-down = baseBtn=32.
    mouseEvent('\x1b[<32;10;5M');
    mouseEvent(release(5, 10));
    const ev = mouseEvent(press(5, 10));
    expect(ev?.type).toBe('double-click');
  });

  test('scroll events do not interfere', () => {
    mouseEvent(press(5, 10));
    mouseEvent('\x1b[<64;10;5M');   // scroll-up
    const ev = mouseEvent(press(5, 10));
    expect(ev?.type).toBe('double-click');
  });

  test('env override invalid string falls back to 300', () => {
    const origEnv = process.env.ELANOUS_DOUBLE_CLICK_MS;
    process.env.ELANOUS_DOUBLE_CLICK_MS = 'not-a-number';
    try {
      __resetDoubleClickState();
      mouseEvent(press(5, 10));
      mouseEvent(release(5, 10));
      const ev = mouseEvent(press(5, 10));
      expect(ev?.type).toBe('double-click');
    } finally {
      if (origEnv === undefined) delete process.env.ELANOUS_DOUBLE_CLICK_MS;
      else process.env.ELANOUS_DOUBLE_CLICK_MS = origEnv;
    }
  });

  test('__resetDoubleClickState forgets previous press', () => {
    mouseEvent(press(5, 10));
    __resetDoubleClickState();
    const ev = mouseEvent(press(5, 10));
    expect(ev?.type).toBe('click');       // fresh start, no double
  });

  test('shift-modifier press still produces click (shift flag recorded)', () => {
    const keys = splitKeys('\x1b[<4;10;5M');   // 4 = shift bit only on primary
    expect(keys[0]?.mouse?.type).toBe('click');
    expect(keys[0]?.shift).toBe(true);
  });

  test('double-click inherits same-cell row + col', () => {
    mouseEvent(press(12, 44));
    mouseEvent(release(12, 44));
    const ev = mouseEvent(press(12, 44));
    expect(ev).toMatchObject({ type: 'double-click', row: 12, col: 44 });
  });
});
