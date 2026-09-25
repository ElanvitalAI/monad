import { describe, expect, test } from 'bun:test';
import { resolveTooltipChromeSpec } from '../../../src/ui/chrome/tooltip-chrome.js';

describe('tooltip chrome helper', () => {
  test('uses tooltip variant with close hidden by default', () => {
    expect(resolveTooltipChromeSpec({ title: 'Hint' })).toMatchObject({
      variant: 'tooltip',
      title: 'Hint',
      showClose: false,
    });
  });

  test('allows caller overrides via chromeSpec', () => {
    expect(resolveTooltipChromeSpec({
      title: 'Hint',
      chromeSpec: { showBorder: true },
    })).toMatchObject({
      variant: 'tooltip',
      title: 'Hint',
      showClose: false,
      showBorder: true,
    });
  });
});
