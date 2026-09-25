import { describe, expect, spyOn, test } from 'bun:test';

import { debug } from '../../debug/log.js';
import { foldHint } from '../../log-entry.js';
import { renderToolBlock, toolBlockGrouping } from './block.js';
import type { ToolRenderModel } from './types.js';

const model: ToolRenderModel = {
  kind: 'Read',
  status: 'success',
  summary: 'Read a.ts',
  collapsedSummary: '5 lines',
  bodyLines: ['1', '2', '3', '4', '5'],
  operationKind: 'Read',
};

describe('renderToolBlock fold modes', () => {
  test('line and unspecified stay on the line-budget path', () => {
    const line = renderToolBlock(model, 4, 'line');
    const unspecified = renderToolBlock(model, 4);
    expect(line).toEqual(unspecified);
    expect(line.join('\n')).toContain(foldHint('line', 2));
  });

  test('task-unit still collapses a multi-line body to one hint', () => {
    const task = renderToolBlock(model, 4, 'task-unit');
    expect(task.join('\n')).toContain(foldHint('line', 5));
    expect(task).not.toEqual(renderToolBlock(model, 4, 'line'));
  });

  test('kind-unit grouping is omitted unless foldMode is kind-unit', () => {
    expect(toolBlockGrouping(model, 'line')).toEqual({});
    expect(toolBlockGrouping(model, 'task-unit')).toEqual({});
    expect(toolBlockGrouping(model, 'kind-unit')).toEqual({ operationKind: 'Read' });
    expect(toolBlockGrouping({ ...model, operationKind: undefined }, 'kind-unit')).toEqual({});
  });

  test('five body lines at budget three: kind-unit reuses task-unit folding', () => {
    const line = renderToolBlock(model, 3, 'line');
    const task = renderToolBlock(model, 3, 'task-unit');
    const kind = renderToolBlock(model, 3, 'kind-unit');

    expect(line).toHaveLength(4);
    expect(line.join('\n')).toContain('1');
    expect(line.join('\n')).toContain('2');
    expect(line.join('\n')).toContain(foldHint('line', 3));

    expect(task).toHaveLength(2);
    expect(task.join('\n')).toContain(foldHint('line', 5));
    const taskBody = task.slice(1).map((row) => row.replace(/\x1b\[[0-9;]*m/g, ''));
    expect(taskBody.some((row) => /(^|\s)[12]$/.test(row.trim()))).toBe(false);
    expect(task).not.toEqual(line);

    expect(kind).toEqual(task);
    expect(kind).not.toEqual(line);
    expect(kind).toHaveLength(2);
    expect(kind.join('\n')).toContain(foldHint('line', 5));

    expect(toolBlockGrouping(model, 'kind-unit')).toEqual({ operationKind: 'Read' });
  });

  test('records fold-applied when task-unit or kind-unit folding is applied', () => {
    const applied: Array<Record<string, unknown>> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({ ...data });
      }
    }) as typeof debug.log);

    try {
      renderToolBlock(model, 4, 'task-unit');
      expect(applied).toEqual([{
        mode: 'task-unit',
        preFoldLineCount: 5,
        postFoldLineCount: 1,
      }]);

      applied.length = 0;
      renderToolBlock(model, 4, 'kind-unit');
      expect(applied).toEqual([{
        mode: 'kind-unit',
        preFoldLineCount: 5,
        postFoldLineCount: 1,
      }]);

      applied.length = 0;
      renderToolBlock({ ...model, bodyLines: ['only line'] }, 4, 'task-unit');
      expect(applied).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test('records fold-applied on the budget-mode default return path', () => {
    const applied: Array<Record<string, unknown>> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({ ...data });
      }
    }) as typeof debug.log);

    try {
      renderToolBlock(model, 4, 'line');
      expect(applied).toEqual([{
        mode: 'line',
        preFoldLineCount: 5,
        postFoldLineCount: 4,
      }]);
    } finally {
      log.mockRestore();
    }
  });

  test('records fold-applied on the budget-mode persisted-ref return path', () => {
    const applied: Array<Record<string, unknown>> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({ ...data });
      }
    }) as typeof debug.log);

    try {
      renderToolBlock({
        ...model,
        bodyLines: ['1', '2', '3', '4', '5', '... Full output saved to /tmp/out'],
      }, 4, 'line');
      expect(applied).toEqual([{
        mode: 'line',
        preFoldLineCount: 6,
        postFoldLineCount: 4,
      }]);
    } finally {
      log.mockRestore();
    }
  });

  test('does not record fold-applied when budget-mode input is too short to fold', () => {
    const applied: Array<Record<string, unknown>> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({ ...data });
      }
    }) as typeof debug.log);

    try {
      renderToolBlock({ ...model, bodyLines: ['1', '2'] }, 4, 'line');
      expect(applied).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});
