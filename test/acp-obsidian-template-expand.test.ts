// PLAN-ipad-notes-obsidian-typora §5 Phase O4·7 (2026-05-17) —
// Templates smart fill contract: read template + expand tokens.

import { describe, test, expect } from 'bun:test';
import {
  expandTemplateBody,
  expandTemplate,
  formatDate,
} from '../src/acp/obsidian-template-expand';

// Fixed reference: 2026-05-17 14:30:45 (Sunday).
const REF = new Date('2026-05-17T14:30:45.000');

describe('formatDate — Moment-style tokens', () => {
  test('YYYY / YY year tokens', () => {
    expect(formatDate(REF, 'YYYY')).toBe('2026');
    expect(formatDate(REF, 'YY')).toBe('26');
  });

  test('MMMM / MMM / MM / M month tokens', () => {
    expect(formatDate(REF, 'MMMM')).toBe('May');
    expect(formatDate(REF, 'MMM')).toBe('May');
    expect(formatDate(REF, 'MM')).toBe('05');
    expect(formatDate(REF, 'M')).toBe('5');
  });

  test('DD / D day tokens + Do ordinal', () => {
    expect(formatDate(REF, 'DD')).toBe('17');
    expect(formatDate(REF, 'D')).toBe('17');
    expect(formatDate(REF, 'Do')).toBe('17th');
    expect(formatDate(new Date(2026, 4, 1, 0), 'Do')).toBe('1st');
    expect(formatDate(new Date(2026, 4, 2, 0), 'Do')).toBe('2nd');
    expect(formatDate(new Date(2026, 4, 3, 0), 'Do')).toBe('3rd');
    expect(formatDate(new Date(2026, 4, 11, 0), 'Do')).toBe('11th');
    expect(formatDate(new Date(2026, 4, 21, 0), 'Do')).toBe('21st');
  });

  test('dddd / ddd weekday tokens', () => {
    expect(formatDate(REF, 'dddd')).toBe('Sunday');
    expect(formatDate(REF, 'ddd')).toBe('Sun');
  });

  test('HH / H / hh / h / mm / m / ss / s time tokens', () => {
    expect(formatDate(REF, 'HH:mm:ss')).toBe('14:30:45');
    expect(formatDate(REF, 'H:m:s')).toBe('14:30:45');
    expect(formatDate(REF, 'hh:mm')).toBe('02:30');
    expect(formatDate(REF, 'h:mm A')).toBe('2:30 PM');
    expect(formatDate(REF, 'a')).toBe('pm');
  });

  test('combined ISO + weekday format', () => {
    expect(formatDate(REF, 'YYYY-MM-DD (ddd)')).toBe('2026-05-17 (Sun)');
  });

  test('literal text via [...] escape brackets (Moment.js convention)', () => {
    expect(formatDate(REF, '[Date:] YYYY')).toBe('Date: 2026');
    expect(formatDate(REF, '[Today is] dddd')).toBe('Today is Sunday');
  });

  test('unmatched [ emits literally and continues parsing', () => {
    expect(formatDate(REF, '[YYYY')).toBe('[2026');
  });

  test('punctuation characters not part of token names pass through', () => {
    expect(formatDate(REF, 'YYYY-MM-DD')).toBe('2026-05-17');
    expect(formatDate(REF, '(YYYY)')).toBe('(2026)');
  });
});

describe('expandTemplateBody — variable substitution', () => {
  test('{{date}} → ISO YYYY-MM-DD', () => {
    const r = expandTemplateBody('Day: {{date}}', { now: REF, title: 'Daily' });
    expect(r.content).toBe('Day: 2026-05-17');
    expect(r.tokensExpanded).toEqual(['date']);
  });

  test('{{date:FORMAT}} honors the format', () => {
    const r = expandTemplateBody('Today is {{date:dddd, MMMM Do YYYY}}.', { now: REF, title: 'x' });
    expect(r.content).toBe('Today is Sunday, May 17th 2026.');
  });

  test('{{time}} → HH:mm', () => {
    const r = expandTemplateBody('At {{time}}', { now: REF, title: 'x' });
    expect(r.content).toBe('At 14:30');
  });

  test('{{time:FORMAT}} honors the format', () => {
    const r = expandTemplateBody('At {{time:h:mm A}}', { now: REF, title: 'x' });
    expect(r.content).toBe('At 2:30 PM');
  });

  test('{{title}} substitutes the caller-provided title', () => {
    const r = expandTemplateBody('# {{title}}\nBody', { now: REF, title: 'Meeting Notes' });
    expect(r.content).toBe('# Meeting Notes\nBody');
  });

  test('multiple distinct tokens dedup in tokensExpanded but each substitutes', () => {
    const r = expandTemplateBody(
      'Day {{date}} · {{date}} again · time {{time}} · {{title}}',
      { now: REF, title: 'Hi' },
    );
    expect(r.content).toBe('Day 2026-05-17 · 2026-05-17 again · time 14:30 · Hi');
    expect(r.tokensExpanded.sort()).toEqual(['date', 'time', 'title']);
  });

  test('{{cursor}} stays literal (editor consumes it)', () => {
    const r = expandTemplateBody('Type here: {{cursor}}', { now: REF, title: 'x' });
    expect(r.content).toBe('Type here: {{cursor}}');
    expect(r.tokensExpanded).toEqual(['cursor']);
  });

  test('unknown token stays literal so user can spot it', () => {
    const r = expandTemplateBody('Unknown {{xyz}} stays', { now: REF, title: 'x' });
    expect(r.content).toBe('Unknown {{xyz}} stays');
    expect(r.tokensExpanded).toEqual(['xyz']);
  });

  test('whitespace inside braces is tolerated ({{ date }})', () => {
    const r = expandTemplateBody('{{ date }}', { now: REF, title: 'x' });
    expect(r.content).toBe('2026-05-17');
  });

  test('empty content returns empty', () => {
    const r = expandTemplateBody('', { now: REF, title: 'x' });
    expect(r.content).toBe('');
    expect(r.tokensExpanded).toEqual([]);
  });

  test('no tokens at all → content unchanged', () => {
    const r = expandTemplateBody('plain markdown', { now: REF, title: 'x' });
    expect(r.content).toBe('plain markdown');
    expect(r.tokensExpanded).toEqual([]);
  });
});

describe('expandTemplate — full pipeline', () => {
  test('reads template file via readFileFn seam + expands', async () => {
    const r = await expandTemplate({
      vaultRoot: '/fake',
      templatePath: 'Templates/Daily.md',
      now: REF,
      readFileFn: async () => '# {{date}}\nWritten on {{time}}.',
    });
    expect(r.content).toBe('# 2026-05-17\nWritten on 14:30.');
    expect(r.error).toBeUndefined();
  });

  test('default title falls back to template basename', async () => {
    const r = await expandTemplate({
      vaultRoot: '/fake',
      templatePath: 'Templates/Daily.md',
      now: REF,
      readFileFn: async () => '# {{title}}',
    });
    expect(r.content).toBe('# Daily');
  });

  test('explicit title overrides the basename default', async () => {
    const r = await expandTemplate({
      vaultRoot: '/fake',
      templatePath: 'Templates/Daily.md',
      title: 'Today',
      now: REF,
      readFileFn: async () => '# {{title}}',
    });
    expect(r.content).toBe('# Today');
  });

  test('readFile error surfaces as error envelope (content empty)', async () => {
    const r = await expandTemplate({
      vaultRoot: '/fake',
      templatePath: 'Templates/Missing.md',
      readFileFn: async () => { throw new Error('ENOENT'); },
    });
    expect(r.content).toBe('');
    expect(r.tokensExpanded).toEqual([]);
    expect(r.error).toBe('ENOENT');
  });
});
