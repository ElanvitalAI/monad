// IDX-F5d — validateModalBounds + inputZoneStart.

import { describe, expect, test } from 'bun:test';

import {
  inputZoneStart,
  validateModalBounds,
  type PickerLayout,
} from '../src/display/bounds-validate.js';

const termRows = 24;

describe('inputZoneStart', () => {
  test('2-row input zone on a 24-row terminal starts at row 23', () => {
    expect(inputZoneStart(24, 2)).toBe(23);
  });

  test('1-row input zone starts at the last row', () => {
    expect(inputZoneStart(24, 1)).toBe(24);
  });

  test('0-height input zone returns sentinel past the last row', () => {
    expect(inputZoneStart(24, 0)).toBe(25);
  });

  test('clamped to row 1 when input zone larger than the terminal', () => {
    expect(inputZoneStart(5, 10)).toBe(1);
  });
});

describe('validateModalBounds', () => {
  test('picker tier bypasses the check even when it overlaps the zone', () => {
    const r = validateModalBounds({
      bounds: { row: 20, col: 1, width: 40, height: 5 },  // ends at 24
      tier: 'picker',
      termRows,
      inputZoneHeight: 2,                                 // zone starts at 23
    });
    expect(r.shifted).toBe(false);
    expect(r.warning).toBeNull();
    expect(r.bounds.row).toBe(20);
  });

  test('dialog tier fully above the zone → no shift', () => {
    const r = validateModalBounds({
      bounds: { row: 5, col: 1, width: 40, height: 10 },  // ends at 14
      tier: 'dialog',
      termRows,
      inputZoneHeight: 2,                                 // zone starts at 23
    });
    expect(r.shifted).toBe(false);
    expect(r.bounds.row).toBe(5);
  });

  test('dialog tier straddling the zone is shifted up by the overlap distance', () => {
    const r = validateModalBounds({
      bounds: { row: 22, col: 1, width: 40, height: 4 },  // ends at 25 > 23
      tier: 'dialog',
      termRows,
      inputZoneHeight: 2,                                 // zone starts at 23
    });
    // overlap = 25 - 23 + 1 = 3 → shifted to row 22-3 = 19
    expect(r.shifted).toBe(true);
    expect(r.bounds.row).toBe(19);
    expect(r.warning).toContain('tier=dialog');
    expect(r.warning).toContain('overlaps input zone');
  });

  test('popup tier too tall clamps at row 1', () => {
    const r = validateModalBounds({
      bounds: { row: 2, col: 1, width: 40, height: 30 },  // ends at 31
      tier: 'popup',
      termRows,
      inputZoneHeight: 2,                                 // zone starts at 23
    });
    expect(r.shifted).toBe(true);
    expect(r.bounds.row).toBe(1);   // clamped
  });

  test('inputZoneHeight 0 disables the check', () => {
    const r = validateModalBounds({
      bounds: { row: 20, col: 1, width: 40, height: 10 },
      tier: 'dialog',
      termRows,
      inputZoneHeight: 0,
    });
    expect(r.shifted).toBe(false);
    expect(r.bounds.row).toBe(20);
  });

  test('modal whose bottom edge exactly equals zoneStart-1 does NOT shift', () => {
    // zone starts at 23 → modal ending at 22 is safe
    const r = validateModalBounds({
      bounds: { row: 15, col: 1, width: 10, height: 8 },  // ends at 22
      tier: 'popup',
      termRows,
      inputZoneHeight: 2,
    });
    expect(r.shifted).toBe(false);
    expect(r.bounds.row).toBe(15);
  });

  test('modal whose bottom edge equals zoneStart IS shifted (overlap=1)', () => {
    const r = validateModalBounds({
      bounds: { row: 16, col: 1, width: 10, height: 8 },  // ends at 23
      tier: 'popup',
      termRows,
      inputZoneHeight: 2,                                 // zone starts at 23
    });
    expect(r.shifted).toBe(true);
    expect(r.bounds.row).toBe(15);  // overlap 1
  });

  test('terminal tier (PTY modal) is subject to the shift rule', () => {
    const r = validateModalBounds({
      bounds: { row: 22, col: 1, width: 40, height: 5 },  // ends at 26
      tier: 'terminal',
      termRows,
      inputZoneHeight: 2,
    });
    expect(r.shifted).toBe(true);
    expect(r.warning).toContain('tier=terminal');
  });
});

// PickerLayout exists as a forward-declared interface; adoption is
// incremental but the type should be referenceable today.
describe('PickerLayout type', () => {
  test('can be implemented and inputZoneHeight() queried', () => {
    const picker: PickerLayout = { inputZoneHeight: () => 2 };
    expect(picker.inputZoneHeight()).toBe(2);
  });
});
