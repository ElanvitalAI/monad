import { describe, expect, test } from 'bun:test';

import { handleDashboardAttachmentPopupAction } from '../src/dashboard/attachment-popup-actions.js';
import type { Attachment } from '../src/context.js';

const attachment: Attachment = {
  id: 7,
  token: '[PDF #7]',
  kind: 'pdf',
  sourcePath: '/tmp/file.pdf',
  filename: 'file.pdf',
  sizeBytes: 10,
  mtime: 1,
};

describe('handleDashboardAttachmentPopupAction', () => {
  test('drops context and forgets row mapping', () => {
    const events: string[] = [];

    handleDashboardAttachmentPopupAction('drop', attachment, {
      dropContextById: (id) => {
        events.push(`drop:${id}`);
        return true;
      },
      forgetAttachmentRowById: (id) => { events.push(`forget:${id}`); },
      onDropResult: (ok, nextAttachment) => {
        events.push(`result:${ok}:${nextAttachment.token}`);
      },
      writeClipboardDetailed: async () => ({ ok: true }),
      onCopied: () => { events.push('copied'); },
    });

    expect(events).toEqual(['drop:7', 'forget:7', 'result:true:[PDF #7]']);
  });

  test('copies token and path labels through the clipboard callback', async () => {
    const events: string[] = [];
    const pending: Promise<void>[] = [];

    const deps = {
      dropContextById: () => true,
      forgetAttachmentRowById: () => {},
      onDropResult: () => {},
      writeClipboardDetailed: async (text: string) => ({ ok: true, via: text }),
      onCopied: (label: string, result: { ok: boolean; via?: string | null }) => {
        events.push(`${label}:${String(result.via)}`);
      },
    };

    pending.push(Promise.resolve(handleDashboardAttachmentPopupAction('copy-token', attachment, deps)));
    pending.push(Promise.resolve(handleDashboardAttachmentPopupAction('copy-path', attachment, deps)));
    await Promise.all(pending);
    await Promise.resolve();

    expect(events).toEqual(['[PDF #7]:[PDF #7]', 'path:/tmp/file.pdf']);
  });
});
