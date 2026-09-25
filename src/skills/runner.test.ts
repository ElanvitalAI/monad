import { describe, expect, mock, test } from 'bun:test';

import type { LLMMessage, LLMProvider, StreamWithToolsHandlers } from '../llm.js';
import * as llmActual from '../llm.js';
import {
  FOLD_LIMITS,
  foldHint,
  renderLogEntry,
  type FoldMode,
  type LogEntry,
  type RenderOpts,
} from '../log-entry.js';
import type { ExecuteSkillOpts, SkillManifest } from './runner.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI_RE, '');
const body = (count: number): string =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
const toolBody = (text: string): LogEntry => ({ kind: 'tool-body', text });

const TOOL_OUTPUT = body(4);

const testProvider: LLMProvider = {
  name: 'test',
  defaultModel: 'test-model',
  available: () => true,
  async *chat() { yield 'ok'; },
};

mock.module('../llm.js', () => ({
  ...llmActual,
  getProvider: () => testProvider,
  resolveDefaultProvider: () => testProvider,
  isModelCompatible: () => true,
  streamLLMWithTools: async (
    _messages: LLMMessage[],
    handlers: StreamWithToolsHandlers,
  ) => {
    const call = { id: 'call-1', name: 'Read', args: { file_path: '/tmp/demo.txt' } };
    handlers.onToolCall?.(call);
    handlers.onToolResult?.({ id: call.id, name: call.name, result: TOOL_OUTPUT });
    return 'ok';
  },
}));

const { executeSkill, skillFoldRenderOpts } = await import('./runner.js');

const demoManifest: SkillManifest = {
  name: 'demo-fold',
  description: 'demo',
  content: '# demo',
  skillDir: '/tmp/demo-fold-skill',
};

async function runExecuteSkill(foldMode?: FoldMode) {
  const folds: Array<{ entry: LogEntry; renderOpts: RenderOpts }> = [];
  let display = '';
  const opts: ExecuteSkillOpts = {
    onFoldableEntry: (entry, renderOpts) => {
      folds.push({ entry, renderOpts });
    },
  };
  if (foldMode !== undefined) opts.foldMode = foldMode;
  const result = await executeSkill(demoManifest, '', (_delta, full) => {
    display = full;
  }, opts);
  return { display, folds, result };
}

describe('skillFoldRenderOpts', () => {
  test('omitted foldMode keeps the empty RenderOpts that renderLogEntry already defaults to line', () => {
    expect(skillFoldRenderOpts()).toEqual({});
    expect(skillFoldRenderOpts(undefined)).toEqual({});

    const lines = body(FOLD_LIMITS.TOOL_BODY + 2);
    const viaHelper = renderLogEntry(toolBody(lines), skillFoldRenderOpts());
    const viaDefault = renderLogEntry(toolBody(lines));
    expect(viaHelper).toEqual(viaDefault);
    expect(viaHelper.map(strip)).toEqual([
      ...Array.from({ length: FOLD_LIMITS.TOOL_BODY }, (_, i) => `line ${i + 1}`),
      foldHint('line', 2),
    ]);
  });

  test('task-unit foldMode reaches the first tool-body paint through the same RenderOpts the runner registers', () => {
    const lines = body(4);
    const opts = skillFoldRenderOpts('task-unit');
    expect(opts).toEqual({ foldMode: 'task-unit' });
    expect(renderLogEntry(toolBody(lines), opts).map(strip)).toEqual([foldHint('line', 4)]);
  });
});

describe('executeSkill foldMode seam', () => {
  test('tool-result first paint and onFoldableEntry share foldMode from opts', async () => {
    const folded = await runExecuteSkill('task-unit');
    const unfolded = await runExecuteSkill();

    const foldedBodies = folded.folds.filter((f) => f.entry.kind === 'tool-body');
    const unfoldedBodies = unfolded.folds.filter((f) => f.entry.kind === 'tool-body');
    expect(foldedBodies).toHaveLength(1);
    expect(unfoldedBodies).toHaveLength(1);

    expect(foldedBodies[0]!.entry).toEqual(toolBody(TOOL_OUTPUT));
    expect(unfoldedBodies[0]!.entry).toEqual(toolBody(TOOL_OUTPUT));
    expect(foldedBodies[0]!.renderOpts).toEqual({ foldMode: 'task-unit' });
    expect(unfoldedBodies[0]!.renderOpts).toEqual({});

    const foldedPaint = renderLogEntry(toolBody(TOOL_OUTPUT), { foldMode: 'task-unit' }).map(strip);
    const unfoldedPaint = renderLogEntry(toolBody(TOOL_OUTPUT)).map(strip);
    expect(foldedPaint).toEqual([foldHint('line', 4)]);
    expect(unfoldedPaint).toEqual(['line 1', 'line 2', 'line 3', 'line 4']);
    expect(foldedPaint).not.toEqual(unfoldedPaint);

    const foldedDisplay = strip(folded.display);
    const unfoldedDisplay = strip(unfolded.display);
    expect(foldedDisplay).toContain(foldHint('line', 4));
    expect(foldedDisplay).not.toContain('line 2');
    expect(unfoldedDisplay).toContain('line 1');
    expect(unfoldedDisplay).toContain('line 2');
    expect(unfoldedDisplay).toContain('line 3');
    expect(unfoldedDisplay).toContain('line 4');
    expect(unfoldedDisplay).not.toContain(foldHint('line', 4));
  }, 20_000);
});
