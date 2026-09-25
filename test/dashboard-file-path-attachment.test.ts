import { describe, expect, test } from 'bun:test';

import { attachDashboardFilePathToken } from '../src/dashboard/file-path-attachment.js';

describe('attachDashboardFilePathToken', () => {
  test('returns tokenized attachment text and marks changes on added entries', async () => {
    const warnings: string[] = [];
    const summaries: string[] = [];
    let changed = 0;

    await expect(
      attachDashboardFilePathToken('/tmp/file.pdf', {
        tokenizeInput: (text) => {
          expect(text).toBe('"/tmp/file.pdf"');
          return {
            text: '[PDF #3]',
            added: [{ attachment: { kind: 'pdf' } }],
            warnings: [],
          };
        },
        onWarning: (warning) => { warnings.push(warning.raw); },
        renderAttachmentSummary: (added) => {
          summaries.push(added.map((entry) => entry.attachment.kind).join(','));
        },
        markChanged: () => { changed += 1; },
      }),
    ).resolves.toBe('[PDF #3] ');

    expect(warnings).toEqual([]);
    expect(summaries).toEqual(['pdf']);
    expect(changed).toBe(1);
  });

  test('emits warnings and marks changes when tokenization warns', async () => {
    const warnings: string[] = [];
    let changed = 0;

    await expect(
      attachDashboardFilePathToken('/tmp/missing.pdf', {
        tokenizeInput: () => ({
          text: '',
          added: [],
          warnings: [{ raw: '/tmp/missing.pdf', reason: 'not-found' }],
        }),
        onWarning: (warning) => { warnings.push(`${warning.raw}:${warning.reason}`); },
        renderAttachmentSummary: () => {},
        markChanged: () => { changed += 1; },
      }),
    ).resolves.toBe('');

    expect(warnings).toEqual(['/tmp/missing.pdf:not-found']);
    expect(changed).toBe(1);
  });
});
