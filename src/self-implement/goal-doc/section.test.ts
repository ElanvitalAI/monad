import { describe, expect, test } from 'bun:test';
import { extractGoalDocSections, type GoalDocSourceLine } from './section.js';

describe('extractGoalDocSections', () => {
  test('preserves goal-author exact heading, fenced-line filtering, and level-one-or-two boundary', () => {
    const linesOutsideFence = (document: string): GoalDocSourceLine[] => {
      let fenced = false;
      const lines: GoalDocSourceLine[] = [];
      for (const match of document.matchAll(/.*(?:\r\n|\n|$)/g)) {
        const raw = match[0];
        if (!raw) continue;
        const text = raw.replace(/\r?\n$/, '');
        if (text === '```') { fenced = !fenced; continue; }
        if (!fenced) lines.push({ text, start: match.index });
      }
      return lines;
    };
    const document = [
      'preamble', '## TARGET', 'kept', '```', '## TARGET', 'ignored', '```', '### nested', '# top', 'after',
    ].join('\r\n');
    expect(extractGoalDocSections(document, {
      search: 'exact-trimmed-line', heading: '## TARGET', lines: linesOutsideFence, endHeading: /^#{1,2}(?:\s|$)/,
    })).toEqual([{
      start: document.indexOf('## TARGET'),
      end: document.indexOf('# top'),
      heading: '## TARGET',
      body: 'kept\n### nested',
    }]);
  });

  test('uses selected source-line offsets when a fenced duplicate precedes the real heading', () => {
    const document = '0123456789\n```\n## TARGET\nignored\n```\nprelude\n## TARGET\nbody\n## NEXT';
    const lines = [
      { text: '0123456789', start: 0 },
      { text: 'prelude', start: 37 },
      { text: '## TARGET', start: 45 },
      { text: 'body', start: 55 },
      { text: '## NEXT', start: 60 },
    ];
    expect(extractGoalDocSections(document, {
      search: 'exact-trimmed-line', heading: '## TARGET', lines: () => lines, endHeading: /^##(?:\s|$)/,
    })).toEqual([{ start: 45, end: 60, heading: '## TARGET', body: 'body' }]);
  });

  test('preserves supervisor substring matching and level-two-only boundary offsets', () => {
    const document = 'prefix ## target\nbody\n# not-a-boundary\n## next\nafter';
    expect(extractGoalDocSections(document, {
      search: 'substring', heading: '## target', endHeading: '\n## ',
    })).toEqual([{ start: 7, end: 38, heading: '## target', body: '\nbody\n# not-a-boundary' }]);
  });

  test('preserves digest level-two regex splitting and trimmed preamble/body', () => {
    const document = ' preamble \n# one\n## A \n body A \n### nested\n## B\n body B ';
    expect(extractGoalDocSections(document, {
      search: 'heading-regexp', heading: /^##\s+(.+?)\s*$/gm, endHeading: /^##\s+/m, includePreamble: true, trimBody: true,
    }).map(({ heading, body }) => ({ heading, body }))).toEqual([
      { heading: undefined, body: 'preamble \n# one' },
      { heading: 'A', body: 'body A \n### nested' },
      { heading: 'B', body: 'body B' },
    ]);
  });
});
