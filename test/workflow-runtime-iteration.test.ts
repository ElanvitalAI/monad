// Node-catalog N1.3 (2026-05-11) — sequential iteration tests.

import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflowToCompletion,
  type WorkflowDeps,
  type WorkflowDefinition,
} from '../src/workflow-runtime/index.js';
import { validateWorkflow } from '../src/workflow-runtime/schema.js';
import {
  applyIterationVars,
  resolveIterationItems,
} from '../src/workflow-runtime/nodes/iteration.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-iter-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => `LLM[${prompt.length}]`,
    runBash: async (body) => ({
      stdout: body,
      stderr: '',
      exitCode: 0,
    }),
    ...over,
  };
}

describe('resolveIterationItems (pure)', () => {
  it('returns [] for empty text', () => {
    expect(resolveIterationItems('')).toEqual([]);
    expect(resolveIterationItems('   ')).toEqual([]);
  });

  it('parses a JSON array', () => {
    expect(resolveIterationItems('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    expect(resolveIterationItems('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('parses a JSON array of objects', () => {
    expect(resolveIterationItems('[{"k":1},{"k":2}]')).toEqual([{ k: 1 }, { k: 2 }]);
  });

  it('falls back to newline-split when not JSON', () => {
    expect(resolveIterationItems('a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(resolveIterationItems('one\n\ntwo\n')).toEqual(['one', 'two']);
  });

  it('ignores non-array JSON (object → newline-split fallback)', () => {
    // `{"k":1}` is valid JSON but not an array; falls back to newline-split
    // which yields a single element.
    expect(resolveIterationItems('{"k":1}')).toEqual(['{"k":1}']);
  });
});

describe('applyIterationVars (pure)', () => {
  it('replaces $item with a string element', () => {
    expect(applyIterationVars('echo $item', 'foo', 0)).toBe('echo foo');
  });

  it('replaces $index with a number', () => {
    expect(applyIterationVars('echo $index', 'x', 5)).toBe('echo 5');
  });

  it('replaces both in the same body', () => {
    expect(applyIterationVars('echo $index:$item', 'a', 2)).toBe('echo 2:a');
  });

  it('JSON-stringifies non-string element', () => {
    expect(applyIterationVars('echo $item', { k: 1 }, 0)).toBe('echo {"k":1}');
  });

  it('handles number / boolean primitives', () => {
    expect(applyIterationVars('echo $item', 42, 0)).toBe('echo 42');
    expect(applyIterationVars('echo $item', true, 0)).toBe('echo true');
  });

  it('does not greedily replace longer identifiers', () => {
    // `$items` must not be consumed by `$item` pattern. We use \b in the
    // matcher so `$items` should remain literal.
    expect(applyIterationVars('echo $items', 'foo', 0)).toBe('echo $items');
    expect(applyIterationVars('echo $indexes', 'foo', 0)).toBe('echo $indexes');
  });
});

describe('schema · iteration variant', () => {
  it('accepts a well-formed iteration node', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'loop', iteration: { items: '$ARGUMENTS', body: 'echo $item' } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects when items is missing', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'loop', iteration: { body: 'echo $item' } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('iteration.items'))).toBe(true);
  });

  it('rejects when body is missing', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'loop', iteration: { items: '$ARGUMENTS' } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('iteration.body'))).toBe(true);
  });
});

describe('executor · iteration node', () => {
  it('runs body once per JSON array element, collecting stdout', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'loop', iteration: { items: '["red","green","blue"]', body: 'echo $item' } },
      ],
    };
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(ok).toBe(true);
    expect(outputs['loop']?.output).toEqual(['echo red', 'echo green', 'echo blue']);
  });

  it('runs over an upstream node output (newline-split fallback)', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'list', bash: 'printf "a\\nb\\nc\\n"' },
        {
          id: 'loop',
          depends_on: ['list'],
          iteration: { items: '$list.output', body: 'echo $item' },
        },
      ],
    };
    const customDeps = makeDeps({
      runBash: async (body) => {
        // `list` node uses printf — return the multi-line literal.
        if (body.startsWith('printf')) {
          return { stdout: 'a\nb\nc\n', stderr: '', exitCode: 0 };
        }
        return { stdout: body, stderr: '', exitCode: 0 };
      },
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      customDeps,
    );
    expect(outputs['loop']?.output).toEqual(['echo a', 'echo b', 'echo c']);
  });

  it('substitutes $index in the body', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'loop', iteration: { items: '["x","y"]', body: 'echo $index:$item' } },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['loop']?.output).toEqual(['echo 0:x', 'echo 1:y']);
  });

  it('fails fast on the first non-zero exit, keeps partial collected output', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'loop', iteration: { items: '["a","b","c"]', body: 'cmd $item' } },
      ],
    };
    let call = 0;
    const customDeps = makeDeps({
      runBash: async (body) => {
        call++;
        if (call === 2) return { stdout: '', stderr: 'boom', exitCode: 7 };
        return { stdout: body, stderr: '', exitCode: 0 };
      },
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      customDeps,
    );
    expect(ok).toBe(false);
    expect(outputs['loop']?.ok).toBe(false);
    expect(outputs['loop']?.output).toEqual(['cmd a']);
    expect(outputs['loop']?.error).toContain('iteration[1]');
  });

  it('returns an empty output array when items resolve to []', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'loop', iteration: { items: '[]', body: 'echo $item' } },
      ],
    };
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(ok).toBe(true);
    expect(outputs['loop']?.output).toEqual([]);
  });

  it('reports variant=iteration in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'loop', iteration: { items: '["a"]', body: 'echo $item' } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('iteration');
  });
});
