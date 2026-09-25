import { describe, expect, test } from 'bun:test';

import { createPreviewPaneModel } from '../src/preview-pane/model.js';
import { clonePreviewPaneModel, PreviewPaneRegistry } from '../src/preview-pane/registry.js';

describe('PreviewPaneRegistry', () => {
  test('register + get round-trips', () => {
    const reg = new PreviewPaneRegistry();
    const preview = createPreviewPaneModel('wd-preview');
    reg.register('wd-preview', preview);
    expect(reg.get('wd-preview')).toBe(preview);
    expect(reg.get('missing')).toBeNull();
  });

  test('ensure allocates a default preview model', () => {
    const reg = new PreviewPaneRegistry();
    const preview = reg.ensure('wd-preview');
    expect(preview.id).toBe('wd-preview');
    expect(preview.sourceMode).toBe('smart');
    expect(reg.ensure('wd-preview')).toBe(preview);
  });

  test('delete removes registered preview models', () => {
    const reg = new PreviewPaneRegistry();
    reg.ensure('wd-preview');
    expect(reg.delete('wd-preview')).toBe(true);
    expect(reg.get('wd-preview')).toBeNull();
    expect(reg.delete('wd-preview')).toBe(false);
  });

  test('cloneInto produces an isolated preview model', () => {
    const reg = new PreviewPaneRegistry();
    const preview = createPreviewPaneModel('wd-preview');
    preview.previewLines = ['alpha'];
    reg.register('wd-preview', preview);

    const clone = reg.cloneInto('wd-preview', 'vw-preview:test');
    clone.previewLines.push('beta');

    expect(reg.get('wd-preview')?.previewLines).toEqual(['alpha']);
    expect(clonePreviewPaneModel(preview).previewLines).toEqual(['alpha']);
    expect(clone.previewLines).toEqual(['alpha', 'beta']);
  });
});
