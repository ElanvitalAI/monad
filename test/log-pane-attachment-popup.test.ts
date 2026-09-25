// Attachment popup — option-building logic. The mount path
// (mountViewAsModalSurface) is exercised by the surrounding dashboard
// integration; this test pins the option set so future PRs don't
// silently remove/reorder the actions users come to expect.

import { describe, expect, test } from 'bun:test';
import { buildAttachmentPopupOptions, createAttachmentPopup } from '../src/log-pane/attachment-popup.js';
import type { Attachment } from '../src/context.js';

function fakeAttachment(partial: Partial<Attachment> = {}): Attachment {
  return {
    id: 3,
    kind: 'md',
    token: '[Md #3]',
    sourcePath: '/Users/demo/docs/SMOKE.md',
    filename: 'SMOKE.md',
    sizeBytes: 42_912,
    mtime: Date.now(),
    pastedAt: Date.now(),
    loaded: false,
    ...partial,
  };
}

describe('buildAttachmentPopupOptions', () => {
  test('returns the three canonical actions in order', () => {
    const options = buildAttachmentPopupOptions(fakeAttachment());
    expect(options.map(o => o.value)).toEqual(['drop', 'copy-token', 'copy-path']);
  });

  test('drop is the first action with a descriptive label', () => {
    const options = buildAttachmentPopupOptions(fakeAttachment());
    const drop = options[0]!;
    expect(drop.value).toBe('drop');
    expect(drop.label).toContain('Drop');
    expect(drop.description).toContain('[Md #3]');
  });

  test('copy-token description shows the bracket token', () => {
    const options = buildAttachmentPopupOptions(fakeAttachment({ token: '[Md #42]' }));
    const copy = options.find(o => o.value === 'copy-token')!;
    expect(copy.description).toBe('[Md #42]');
  });

  test('copy-path description shortens very long paths', () => {
    const longPath = '/Users/demo/very/deep/nested/structure/that/keeps/going/on/and/on/SMOKE.md';
    const options = buildAttachmentPopupOptions(fakeAttachment({ sourcePath: longPath }));
    const copyPath = options.find(o => o.value === 'copy-path')!;
    expect(copyPath.description!.length).toBeLessThanOrEqual(50);
    expect(copyPath.description).toContain('SMOKE.md');
  });

  test('short paths pass through untouched', () => {
    const options = buildAttachmentPopupOptions(fakeAttachment({ sourcePath: '/tmp/x.md' }));
    const copyPath = options.find(o => o.value === 'copy-path')!;
    expect(copyPath.description).toBe('/tmp/x.md');
  });

  test('createAttachmentPopup does not throw when building the picker shell', () => {
    expect(() => createAttachmentPopup({
      attachment: fakeAttachment(),
      ownerWorkspaceId: 'virtual-window:9',
      row: 10,
      col: 20,
      termCols: 120,
      termRows: 40,
      onAction: () => {},
    })).not.toThrow();
  });

  test('attaches the popup to the provided workspace owner', () => {
    const handle = createAttachmentPopup({
      attachment: fakeAttachment(),
      ownerWorkspaceId: 'virtual-window:9',
      row: 10,
      col: 20,
      termCols: 120,
      termRows: 40,
      onAction: () => {},
    });
    expect(handle.surface.ownerWorkspaceId).toBe('virtual-window:9');
    handle.dispose();
  });

  test('hides footer hint for compact narrow attachment lists', () => {
    const handle = createAttachmentPopup({
      attachment: fakeAttachment(),
      row: 10,
      col: 20,
      termCols: 40,
      termRows: 20,
      onAction: () => {},
    });
    const paint = handle.surface.paint();
    expect(paint).not.toContain('Dbl/↵ run');
    expect(paint).not.toContain('Double-click/Enter run');
    handle.dispose();
  });
});
