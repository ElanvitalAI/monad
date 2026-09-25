// W6 Z8 · showroom node · aggregator matrix + executor + schema validation.

import { describe, expect, test } from 'bun:test';
import {
  aggregate,
  executeShowroomNode,
  type ShowroomLaneRun,
  type ShowroomNodeOutput,
} from '../../src/workflow-runtime/nodes/showroom';
import {
  isShowroomNode,
  validateWorkflow,
} from '../../src/workflow-runtime/schema';
import type {
  DagNode,
  NodeExecContext,
  ShowroomNode,
  WorkflowDeps,
} from '../../src/workflow-runtime/types';

function lane(role: ShowroomLaneRun['role'], text: string, model = 'm'): ShowroomLaneRun {
  return { role, model, text };
}

function ctx(): NodeExecContext {
  return {
    arguments: '',
    artifactsDir: '/tmp',
    outputs: {},
  } as NodeExecContext;
}

function depsWith(answers: Record<string, string>): WorkflowDeps {
  return {
    callLLM: async (input: { prompt: string; model?: string }) => {
      const key = `${input.model}::${input.prompt.slice(0, 24)}`;
      const direct = answers[key];
      if (direct !== undefined) return direct;
      const byModel = answers[input.model ?? ''];
      if (byModel !== undefined) return byModel;
      return 'default-answer';
    },
  } as unknown as WorkflowDeps;
}

function showroomNode(over: Partial<ShowroomNode['showroom']> = {}): ShowroomNode {
  return {
    id: 'sr',
    showroom: {
      lanes: [
        { role: 'plan', model: 'm1', prompt: 'plan it' },
        { role: 'build', model: 'm2', prompt: 'build it' },
        { role: 'review', model: 'm3', prompt: 'review it' },
      ],
      aggregator: 'majority',
      ...over,
    },
  } as ShowroomNode;
}

describe('aggregate (pure)', () => {
  test('first-finalize returns first lane verbatim', () => {
    const out = aggregate('first-finalize', [lane('plan', 'A'), lane('build', 'B')]);
    expect(out.result).toBe('A');
    expect(out.consensus).toBe('first');
  });

  test('majority picks the most-voted answer', () => {
    const out = aggregate('majority', [lane('plan', 'go'), lane('build', 'go'), lane('review', 'stop')]);
    expect(out.result).toBe('go');
    expect(out.consensus).toBe('majority');
    expect(out.notes).toContain('2/3');
  });

  test('majority with no majority falls back to first', () => {
    const out = aggregate('majority', [lane('plan', 'a'), lane('build', 'b'), lane('review', 'c')]);
    expect(out.result).toBe('a');
    expect(out.consensus).toBe('split');
    expect(out.notes).toBe('no-majority-fallback-first');
  });

  test('unanimous-or-escalate returns escalate on split', () => {
    const out = aggregate('unanimous-or-escalate', [lane('plan', 'a'), lane('build', 'b')]);
    expect(out.consensus).toBe('escalate');
    expect(out.result).toBe('');
    expect(out.notes).toContain('split');
  });

  test('unanimous-or-escalate returns unanimous when all match', () => {
    const out = aggregate('unanimous-or-escalate', [lane('plan', 'go'), lane('build', 'go'), lane('review', 'go')]);
    expect(out.consensus).toBe('unanimous');
    expect(out.result).toBe('go');
  });

  test('vote_with_reasoning bundles every lane reasoning', () => {
    const out = aggregate('vote_with_reasoning', [
      lane('plan', 'go', 'gpt'),
      lane('build', 'go', 'qwen'),
      lane('review', 'stop', 'claude'),
    ]);
    expect(out.consensus).toBe('majority');
    expect(out.result).toContain('go');
    expect(out.result).toContain('Reasoning:');
    expect(out.result).toContain('plan/gpt: go');
    expect(out.result).toContain('review/claude: stop');
  });

  test('case + whitespace normalized before vote', () => {
    const out = aggregate('majority', [
      lane('plan', '  GO  '),
      lane('build', 'go'),
      lane('review', 'stop'),
    ]);
    expect(out.consensus).toBe('majority');
  });

  test('empty lanes → split with no-lanes note', () => {
    const out = aggregate('majority', []);
    expect(out.consensus).toBe('split');
    expect(out.notes).toBe('no-lanes');
  });
});

describe('executeShowroomNode', () => {
  test('parallel mode runs all lanes and aggregates', async () => {
    const deps = depsWith({ m1: 'go', m2: 'go', m3: 'stop' });
    const result = await executeShowroomNode(showroomNode(), ctx(), deps);
    expect(result.ok).toBe(true);
    const out = result.output as ShowroomNodeOutput;
    expect(out.aggregator).toBe('majority');
    expect(out.result).toBe('go');
    expect(out.consensus).toBe('majority');
    expect(out.lanes.length).toBe(3);
  });

  test('sequential mode preserves call order', async () => {
    const order: string[] = [];
    const deps = {
      callLLM: async (input: { prompt: string; model?: string }) => {
        order.push(input.model ?? '?');
        return input.model ?? 'x';
      },
    } as unknown as WorkflowDeps;
    const node = showroomNode({ mode: 'sequential', aggregator: 'first-finalize' });
    await executeShowroomNode(node, ctx(), deps);
    expect(order).toEqual(['m1', 'm2', 'm3']);
  });

  test('callLLM throw → ok=false with error', async () => {
    const deps = {
      callLLM: async () => { throw new Error('llm-down'); },
    } as unknown as WorkflowDeps;
    const result = await executeShowroomNode(showroomNode(), ctx(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('llm-down');
  });
});

describe('schema integration', () => {
  test('isShowroomNode narrows correctly', () => {
    const node = showroomNode() as unknown as DagNode;
    expect(isShowroomNode(node)).toBe(true);
    expect(isShowroomNode({ id: 'p', prompt: 'hi' } as DagNode)).toBe(false);
  });

  test('validateWorkflow accepts a well-formed showroom workflow', () => {
    const wf = {
      name: 'sr-wf',
      description: 'showroom test',
      nodes: [{
        id: 'sr',
        showroom: {
          lanes: [
            { role: 'plan', model: 'm1', prompt: 'p1' },
            { role: 'build', model: 'm2', prompt: 'p2' },
          ],
          aggregator: 'majority',
          mode: 'parallel',
        },
      }],
    };
    const res = validateWorkflow(wf);
    expect(res.ok).toBe(true);
  });

  test('validateWorkflow rejects bad aggregator + empty lanes', () => {
    const wf = {
      name: 'sr-wf',
      description: 'showroom test',
      nodes: [{
        id: 'sr',
        showroom: { lanes: [], aggregator: 'bogus' },
      }],
    };
    const res = validateWorkflow(wf);
    expect(res.ok).toBe(false);
    const msgs = res.ok ? [] : res.issues.map((i) => i.message).join(' ');
    expect(msgs).toContain('aggregator');
    expect(msgs).toContain('lanes');
  });

  test('validateWorkflow rejects bad lane role', () => {
    const wf = {
      name: 'sr-wf',
      description: 'showroom test',
      nodes: [{
        id: 'sr',
        showroom: {
          lanes: [{ role: 'bogus', model: 'm', prompt: 'p' }],
          aggregator: 'majority',
        },
      }],
    };
    const res = validateWorkflow(wf);
    expect(res.ok).toBe(false);
  });
});
