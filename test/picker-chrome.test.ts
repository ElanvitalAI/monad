import { describe, expect, test } from 'bun:test';

import { resolvePickerChromeSpec } from '../src/ui/chrome/picker-chrome.js';

describe('picker chrome defaults', () => {
  test('defaults chooser titles to centered alignment', () => {
    expect(resolvePickerChromeSpec({
      title: 'Windows',
      primaryAction: 'switch',
    })).toMatchObject({
      variant: 'window',
      title: 'Windows',
      titleAlign: 'center',
      showClose: true,
    });
  });

  test('honors explicit titleAlign overrides', () => {
    expect(resolvePickerChromeSpec({
      title: 'Windows',
      primaryAction: 'switch',
      chromeSpec: { titleAlign: 'left' },
    }).titleAlign).toBe('left');
  });
});
