import { describe, expect, test } from 'bun:test';
import {
  buildPickerFooterHint,
  resolvePickerChromePresentation,
} from '../../../src/ui/chrome/picker-chrome.js';

describe('buildPickerFooterHint', () => {
  test('renders the regular vocabulary by default', () => {
    expect(buildPickerFooterHint({
      title: 'Switch model',
      primaryAction: 'switch',
      browseMode: true,
      filterable: true,
    })).toBe('↑↓ move · type filter · Click select · Double-click/Enter switch · Esc cancel');
  });

  test('switches to compact vocabulary for narrow widths', () => {
    expect(buildPickerFooterHint({
      title: 'Switch model',
      primaryAction: 'switch',
      browseMode: true,
      filterable: true,
      maxWidth: 40,
    })).toBe('↑↓ · type · Click · Dbl/↵ switch · Esc');
  });
});

describe('resolvePickerChromePresentation', () => {
  test('returns footer and chrome from the same picker vocabulary', () => {
    const presentation = resolvePickerChromePresentation({
      title: 'Switch model',
      primaryAction: 'switch',
      browseMode: true,
      filterable: true,
      maxWidth: 40,
    });
    expect(presentation.footerHint).toBe('↑↓ · type · Click · Dbl/↵ switch · Esc');
    expect(presentation.chromeSpec.footer).toBe(presentation.footerHint);
    expect(presentation.chromeSpec).toMatchObject({
      variant: 'window',
      title: 'Switch model',
      showClose: true,
    });
  });
});
