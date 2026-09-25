import { describe, expect, test } from 'bun:test';

import {
  resolveEmbeddedDialogChromeSpec,
  resolveModalDialogChromeSpec,
} from '../../../src/ui/chrome/dialog-chrome.js';

describe('dialog chrome semantic helpers', () => {
  test('resolveModalDialogChromeSpec applies modal dialog defaults', () => {
    expect(resolveModalDialogChromeSpec('Confirm removal')).toEqual({
      variant: 'dialog',
      title: 'Confirm removal',
      titleAlign: 'left',
      showClose: true,
    });
  });

  test('resolveEmbeddedDialogChromeSpec hides the close button by default', () => {
    expect(resolveEmbeddedDialogChromeSpec('Inline form')).toEqual({
      variant: 'dialog',
      title: 'Inline form',
      titleAlign: 'left',
      showClose: false,
    });
  });
});
