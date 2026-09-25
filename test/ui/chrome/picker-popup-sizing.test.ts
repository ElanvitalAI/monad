import { describe, expect, test } from 'bun:test';
import { resolvePickerPopupSize, widestPickerOptionWidth } from '../../../src/ui/chrome/picker-popup-sizing.js';

describe('picker popup sizing helpers', () => {
  test('widestPickerOptionWidth includes description text', () => {
    expect(widestPickerOptionWidth([
      { value: 1, label: 'short' },
      { value: 2, label: 'alpha', description: 'beta' },
    ])).toBe('alpha  beta'.length);
  });

  test('resolvePickerPopupSize clamps width and adds shell rows', () => {
    expect(resolvePickerPopupSize([
      { value: 1, label: 'short' },
      { value: 2, label: 'alpha', description: 'beta' },
    ], {
      minWidth: 20,
      maxWidth: 24,
      widthPadding: 6,
      visibleRows: 8,
      shellRows: 5,
    })).toEqual({
      width: 20,
      height: 7,
    });
  });

  test('resolvePickerPopupSize respects max width and visible row cap', () => {
    expect(resolvePickerPopupSize(
      Array.from({ length: 12 }, (_, i) => ({ value: i, label: 'row-' + i + '-'.repeat(24) })),
      {
        minWidth: 20,
        maxWidth: 30,
        widthPadding: 10,
        visibleRows: 6,
        shellRows: 5,
      },
    )).toEqual({
      width: 30,
      height: 11,
    });
  });
});
