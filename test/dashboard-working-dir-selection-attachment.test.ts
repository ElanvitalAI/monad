import { describe, expect, test } from 'bun:test';

import { attachDashboardWorkingDirSelection } from '../src/dashboard/working-dir-selection-attachment.js';

describe('attachDashboardWorkingDirSelection', () => {
  test('tokenizes selected paths and appends resulting attachment tokens', () => {
    const warnings: string[] = [];
    const summaries: string[] = [];
    const prefixes: string[] = [];

    attachDashboardWorkingDirSelection(
      ['/tmp/alpha.pdf', '/tmp/missing.md'],
      {
        tokenizeInput: (text) => {
          expect(text).toBe('"/tmp/alpha.pdf" "/tmp/missing.md"');
          return {
            text: '[PDF #1]',
            added: [{ attachment: { kind: 'pdf' } }],
            warnings: [{ raw: '/tmp/missing.md', reason: 'not-found' }],
          };
        },
        onWarning: (warning) => { warnings.push(`${warning.raw}:${warning.reason}`); },
        renderAttachmentSummary: (added) => {
          summaries.push(added.map((entry) => entry.attachment.kind).join(','));
        },
        appendInputPrefix: (text) => { prefixes.push(text); },
      },
    );

    expect(warnings).toEqual(['/tmp/missing.md:not-found']);
    expect(summaries).toEqual(['pdf']);
    expect(prefixes).toEqual(['[PDF #1] ']);
  });

  test('returns early when selection is empty', () => {
    const events: string[] = [];

    attachDashboardWorkingDirSelection([], {
      tokenizeInput: () => {
        events.push('tokenize');
        return { text: '', added: [], warnings: [] };
      },
      onWarning: () => { events.push('warning'); },
      renderAttachmentSummary: () => { events.push('summary'); },
      appendInputPrefix: () => { events.push('prefix'); },
    });

    expect(events).toEqual([]);
  });
});
