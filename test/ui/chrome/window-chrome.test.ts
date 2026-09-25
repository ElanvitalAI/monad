import { describe, expect, test } from 'bun:test';

import {
  resolveModalWindowChromeSpec,
  resolvePickerWindowChromeSpec,
  resolveWindowChromeSpec,
} from '../../../src/ui/chrome/window-chrome.js';

describe('resolveWindowChromeSpec', () => {
  test('applies window defaults', () => {
    expect(resolveWindowChromeSpec({ title: 'Recent files' })).toEqual({
      variant: 'window',
      title: 'Recent files',
      titleAlign: 'left',
      showClose: true,
    });
  });

  test('allows caller overrides through chromeSpec', () => {
    expect(resolveWindowChromeSpec({
      title: 'Artifacts',
      defaultShowClose: false,
      chromeSpec: {
        titleAlign: 'center',
        showClose: true,
      },
    })).toEqual({
      variant: 'window',
      title: 'Artifacts',
      titleAlign: 'center',
      showClose: true,
    });
  });
});

describe('window chrome semantic helpers', () => {
  test('resolveModalWindowChromeSpec preserves modal window defaults', () => {
    expect(resolveModalWindowChromeSpec('Save artifact')).toEqual({
      variant: 'window',
      title: 'Save artifact',
      titleAlign: 'left',
      showClose: true,
    });
  });

  test('resolvePickerWindowChromeSpec hides the close button for picker windows', () => {
    expect(resolvePickerWindowChromeSpec('Window picker')).toEqual({
      variant: 'window',
      title: 'Window picker',
      titleAlign: 'left',
      showClose: false,
    });
  });
});
