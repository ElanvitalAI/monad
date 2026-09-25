import { describe, expect, test } from 'bun:test';

import { createDashboardChatMainAttachmentOpts } from '../src/dashboard/input/chat-main-attachment-opts.js';

describe('dashboard chat main attachment opts', () => {
  test('paste tokenization emits warnings and appends clipboard image fallback', async () => {
    const warnings: string[] = [];
    const events: string[] = [];
    const opts = createDashboardChatMainAttachmentOpts({
      tokenizeInput: () => ({
        text: '',
        added: [],
        warnings: [{ raw: '/tmp/missing', reason: 'not-found' }],
      }),
      attachClipboardImage: async () => '[Image #9]',
      isClipboardSupported: () => true,
      onWarning: (warning) => { warnings.push(`${warning.raw}:${warning.reason}`); },
      renderAttachmentSummary: () => { events.push('summary'); },
      clearClipboardImageIndicator: () => { events.push('clear-indicator'); },
      markChatDirty: () => { events.push('dirty'); },
      attachFilePathToken: async () => '[PDF #1]',
      openFolderAttachModal: (_absPath, resolve) => resolve('[PDF #2]'),
      dropContextById: () => {},
      sweepAttachmentSummaryLines: () => 0,
    });

    await expect(opts.onPaste?.('')).resolves.toBe('[Image #9]');
    expect(warnings).toEqual(['/tmp/missing:not-found']);
    expect(events).toEqual(['summary', 'clear-indicator', 'dirty']);
  });

  test('image attachments clear the clipboard indicator without fallback attach', async () => {
    const events: string[] = [];
    const opts = createDashboardChatMainAttachmentOpts({
      tokenizeInput: () => ({
        text: 'hello',
        added: [{ attachment: { kind: 'image' } }],
        warnings: [],
      }),
      attachClipboardImage: async () => '[Image #9]',
      isClipboardSupported: () => true,
      onWarning: () => {},
      renderAttachmentSummary: () => { events.push('summary'); },
      clearClipboardImageIndicator: () => { events.push('clear-indicator'); },
      markChatDirty: () => { events.push('dirty'); },
      attachFilePathToken: async () => '[PDF #1]',
      openFolderAttachModal: (_absPath, resolve) => resolve('[PDF #2]'),
      dropContextById: () => {},
      sweepAttachmentSummaryLines: () => 0,
    });

    await expect(opts.onPaste?.('hello')).resolves.toBe('hello');
    expect(events).toEqual(['summary', 'dirty', 'clear-indicator']);
  });

  test('delegates direct file and folder attachment picks', async () => {
    const events: string[] = [];
    const opts = createDashboardChatMainAttachmentOpts({
      tokenizeInput: () => ({ text: '', added: [], warnings: [] }),
      attachClipboardImage: async () => null,
      isClipboardSupported: () => false,
      onWarning: () => {},
      renderAttachmentSummary: () => {},
      clearClipboardImageIndicator: () => {},
      markChatDirty: () => {},
      attachFilePathToken: async (absPath) => `[picked:${absPath}]`,
      openFolderAttachModal: (absPath, resolve) => {
        events.push(absPath);
        resolve('[folder-picked]');
      },
      dropContextById: () => {},
      sweepAttachmentSummaryLines: () => 0,
    });

    await expect(opts.onAtPick?.('/tmp/file.pdf')).resolves.toBe('[picked:/tmp/file.pdf]');
    await expect(opts.onAtFolderAttach?.('/tmp/folder')).resolves.toBe('[folder-picked]');
    expect(events).toEqual(['/tmp/folder']);
  });

  test('token deletion removes unreferenced attachments and marks chat dirty when log rows were removed', () => {
    const dropped: number[] = [];
    const events: string[] = [];
    const opts = createDashboardChatMainAttachmentOpts({
      tokenizeInput: () => ({ text: '', added: [], warnings: [] }),
      attachClipboardImage: async () => null,
      isClipboardSupported: () => false,
      onWarning: () => {},
      renderAttachmentSummary: () => {},
      clearClipboardImageIndicator: () => {},
      markChatDirty: () => { events.push('dirty'); },
      attachFilePathToken: async () => '[PDF #1]',
      openFolderAttachModal: (_absPath, resolve) => resolve('[folder-picked]'),
      dropContextById: (id) => { dropped.push(id); },
      sweepAttachmentSummaryLines: (token) => {
        events.push(`sweep:${token}`);
        return 2;
      },
    });

    opts.onTokenDeleted?.('[PDF #7]', false);
    expect(dropped).toEqual([7]);
    expect(events).toEqual(['sweep:[PDF #7]', 'dirty']);
  });
});
