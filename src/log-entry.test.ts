import { describe, expect, spyOn, test } from 'bun:test';

import { debug } from './debug/log.js';
import {
  FOLD_LIMITS,
  countFoldedItems,
  foldHint,
  foldKindHint,
  renderLogEntry,
  renderLogEntryAsString,
  toolOperationKind,
  type FoldMode,
  type LogEntry,
} from './log-entry';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI_RE, '');
const body = (count: number): string => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
const toolBody = (text: string): LogEntry => ({ kind: 'tool-body', text });

describe('renderLogEntry foldMode', () => {
  test('default fold mode keeps the existing line-budget body rendering', () => {
    const lines = body(FOLD_LIMITS.TOOL_BODY + 2);
    const out = renderLogEntry(toolBody(lines));

    expect(out.map(strip)).toEqual([
      ...Array.from({ length: FOLD_LIMITS.TOOL_BODY }, (_, i) => `line ${i + 1}`),
      foldHint('line', 2),
    ]);
    expect(countFoldedItems(toolBody(lines))).toBe(2);
  });

  test('task-unit mode hides an entire multi-line tool body and reports the hidden line count', () => {
    const foldMode: FoldMode = 'task-unit';
    const lines = body(4);
    const out = renderLogEntry(toolBody(lines), { foldMode });

    expect(out.map(strip)).toEqual([foldHint('line', 4)]);
    expect(countFoldedItems(toolBody(lines), { foldMode })).toBe(4);
    expect(renderLogEntryAsString(toolBody(lines), { foldMode })).toBe(out.join('\n'));
  });

  test('task-unit mode preserves Infinity expansion for FoldStack rerendering', () => {
    const foldMode: FoldMode = 'task-unit';
    const lines = body(4);

    expect(renderLogEntry(toolBody(lines), { foldMode }).map(strip)).toEqual([foldHint('line', 4)]);
    expect(renderLogEntry(toolBody(lines), { foldMode, maxLines: Infinity }).map(strip)).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
    ]);
    expect(countFoldedItems(toolBody(lines), { foldMode, maxLines: Infinity })).toBe(0);
  });

  test('task-unit mode emits no fold marker for empty or one-line tool bodies regardless of line budget', () => {
    const foldMode: FoldMode = 'task-unit';

    expect(renderLogEntry(toolBody(''), { foldMode, maxLines: 0 })).toEqual([]);
    expect(countFoldedItems(toolBody(''), { foldMode, maxLines: 0 })).toBe(0);

    expect(renderLogEntry(toolBody('only line'), { foldMode, maxLines: 0 }).map(strip)).toEqual(['only line']);
    expect(countFoldedItems(toolBody('only line'), { foldMode, maxLines: 0 })).toBe(0);
  });

  test('kind-unit mode leaves a single tool-body on the line-budget path', () => {
    const foldMode: FoldMode = 'kind-unit';
    const lines = body(FOLD_LIMITS.TOOL_BODY + 2);
    const out = renderLogEntry(toolBody(lines), { foldMode });

    expect(out.map(strip)).toEqual([
      ...Array.from({ length: FOLD_LIMITS.TOOL_BODY }, (_, i) => `line ${i + 1}`),
      foldHint('line', 2),
    ]);
    expect(countFoldedItems(toolBody(lines), { foldMode })).toBe(2);
  });

  test('FOLD_LIMITS and foldHint remain the shared line-fold contract for tool bodies', () => {
    const lines = body(FOLD_LIMITS.TOOL_BODY + 1);
    const out = renderLogEntry(toolBody(lines));

    expect(strip(out.at(-1)!)).toBe(foldHint('line', 1));
    expect(countFoldedItems(toolBody(lines))).toBe(1);
  });

  test('records fold-applied only when task-unit folding is applied', () => {
    const applied: Array<Record<string, unknown>> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({ ...data });
      }
    }) as typeof debug.log);

    try {
      const foldMode: FoldMode = 'task-unit';
      const lines = body(4);

      renderLogEntry(toolBody(lines), { foldMode });
      expect(applied).toEqual([{
        mode: 'task-unit',
        preFoldLineCount: 4,
        postFoldLineCount: 1,
      }]);

      applied.length = 0;
      renderLogEntry(toolBody('only line'), { foldMode });
      expect(applied).toEqual([]);

      applied.length = 0;
      countFoldedItems(toolBody(lines), { foldMode });
      expect(applied).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe('foldHint expandHint', () => {
  test('rich opt-in keeps the exact press-f invitation', () => {
    expect(foldHint('line', 2, { expandHint: true })).toBe(
      '… (2 more lines folded — press f to expand)',
    );
    expect(foldHint('line', 1, { expandHint: true })).toBe(
      '… (1 more line folded — press f to expand)',
    );
    expect(foldHint('agent', 2, { expandHint: true })).toBe(
      '… (2 more agents folded — press f to expand)',
    );
  });

  test('essential/disabled and unspecified omit only the key instruction', () => {
    expect(foldHint('line', 2, { expandHint: false })).toBe('… (2 more lines folded)');
    expect(foldHint('line', 1)).toBe('… (1 more line folded)');
    expect(foldHint('agent', 2)).toBe('… (2 more agents folded)');
    expect(foldHint('line', 2)).not.toContain('press f');
    expect(foldHint('line', 2)).toContain('2 more lines folded');
  });

  test('renderLogEntry threads expandHint and does not import dashboard or ui-mode', async () => {
    const src = await Bun.file(new URL('./log-entry.ts', import.meta.url)).text();
    expect(src).not.toMatch(/from ['"][^'"]*dashboard/);
    expect(src).not.toMatch(/from ['"][^'"]*ui-mode/);

    const lines = body(FOLD_LIMITS.TOOL_BODY + 2);
    const rich = renderLogEntry(toolBody(lines), { expandHint: true }).map(strip);
    const essential = renderLogEntry(toolBody(lines), { expandHint: false }).map(strip);
    const unspecified = renderLogEntry(toolBody(lines)).map(strip);

    expect(rich.at(-1)).toBe(foldHint('line', 2, { expandHint: true }));
    expect(essential.at(-1)).toBe(foldHint('line', 2));
    expect(unspecified.at(-1)).toBe(foldHint('line', 2));
    expect(essential.at(-1)).not.toContain('press f');
    expect(unspecified.at(-1)).not.toContain('press f');
  });
});

describe('kind-unit helpers', () => {
  test('toolOperationKind reuses classified summarizeToolCall names and falls back to the tool name', () => {
    expect(toolOperationKind('Read', { file_path: 'a.ts' })).toBe('Read');
    expect(toolOperationKind('read', { file_path: 'a.ts' })).toBe('Read');
    expect(toolOperationKind('CustomProbe', { q: 1 })).toBe('CustomProbe');
  });

  test('foldKindHint names both the count and the kind without coercing foldHint noun', () => {
    expect(foldKindHint('Read', 3)).toBe('… (3 Read)');
    expect(foldKindHint('CustomProbe', 2)).toBe('… (2 CustomProbe)');
  });
});
