// Node-catalog N3.1 + N3.2 (2026-05-11) — Set + Filter tests.

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
import { evaluateWhen } from '../src/workflow-runtime/variables.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-set-filter-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async () => '',
    runBash: async (body) => ({ stdout: body, stderr: '', exitCode: 0 }),
    ...over,
  };
}

describe('schema · set variant', () => {
  it('accepts well-formed set', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'vars', set: { fields: { a: '$ARGUMENTS', b: 'literal' } } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty fields', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'vars', set: { fields: {} } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('set.fields'))).toBe(true);
  });

  it('rejects non-string field value', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'vars', set: { fields: { a: 42 } } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('schema · filter variant', () => {
  it('accepts well-formed filter', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'odd', filter: { items: '[1,2,3]', condition: "$item == '1'" } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects missing items or condition', () => {
    expect(validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'f', filter: { condition: '$item' } }],
    }).ok).toBe(false);
    expect(validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'f', filter: { items: '$ARGUMENTS' } }],
    }).ok).toBe(false);
  });
});

describe('evaluateWhen · $item / $index extensions (Filter)', () => {
  it("$item == 'value' compares against ctx.item (string)", () => {
    expect(evaluateWhen("$item == 'foo'", {
      arguments: '', artifactsDir: '', outputs: {}, item: 'foo', index: 0,
    })).toBe(true);
    expect(evaluateWhen("$item != 'foo'", {
      arguments: '', artifactsDir: '', outputs: {}, item: 'bar', index: 0,
    })).toBe(true);
  });

  it('$item.field reads JSON path on object item', () => {
    expect(evaluateWhen("$item.role == 'admin'", {
      arguments: '', artifactsDir: '', outputs: {}, item: { role: 'admin' }, index: 0,
    })).toBe(true);
  });

  it('bare $item is truthy when string is non-empty', () => {
    expect(evaluateWhen('$item', {
      arguments: '', artifactsDir: '', outputs: {}, item: 'x', index: 0,
    })).toBe(true);
    expect(evaluateWhen('$item', {
      arguments: '', artifactsDir: '', outputs: {}, item: '', index: 0,
    })).toBe(false);
  });

  it('$index == N compares numerically', () => {
    expect(evaluateWhen('$index == 2', {
      arguments: '', artifactsDir: '', outputs: {}, item: 'x', index: 2,
    })).toBe(true);
    expect(evaluateWhen('$index != 0', {
      arguments: '', artifactsDir: '', outputs: {}, item: 'x', index: 1,
    })).toBe(true);
  });

  it('$item patterns inactive when ctx.item is absent', () => {
    // Without ctx.item, $item should fall through to the unsupported
    // path (warning + default true). We verify by passing a stricter
    // expression that the regex couldn't match anyway.
    expect(evaluateWhen("$item == 'x'", {
      arguments: '', artifactsDir: '', outputs: {},
    })).toBe(true); // unsupported → defaults to true
  });
});

describe('executor · set node', () => {
  it('emits a Record<string, string> of resolved expressions', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'vars', set: { fields: { greeting: 'Hello $ARGUMENTS', staticVal: 'literal' } } },
      ],
    };
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'World', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(ok).toBe(true);
    expect(outputs['vars']?.output).toEqual({
      greeting: 'Hello World',
      staticVal: 'literal',
    });
  });

  it('reads upstream node outputs', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'who', bash: 'echo Alice' },
        {
          id: 'collect',
          depends_on: ['who'],
          set: { fields: { name: '$who.output', shout: '$who.output!' } },
        },
      ],
    };
    const deps = makeDeps({
      runBash: async (body) => ({
        stdout: body.startsWith('echo ') ? body.slice(5) : body,
        stderr: '',
        exitCode: 0,
      }),
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['collect']?.output).toEqual({ name: 'Alice', shout: 'Alice!' });
  });

  it('reports variant=set in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'vars', set: { fields: { a: '$ARGUMENTS' } } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('set');
  });
});

describe('executor · filter node', () => {
  it('keeps elements where the condition evaluates true', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'f', filter: { items: '["a","b","c","b"]', condition: "$item == 'b'" } },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['f']?.output).toEqual(['b', 'b']);
  });

  it('supports $index in the condition', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'f', filter: { items: '["a","b","c","d"]', condition: '$index != 0' } },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['f']?.output).toEqual(['b', 'c', 'd']);
  });

  it('supports $item.field on object items', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        {
          id: 'f',
          filter: {
            items: '[{"role":"admin"},{"role":"user"},{"role":"admin"}]',
            condition: "$item.role == 'admin'",
          },
        },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['f']?.output).toEqual([{ role: 'admin' }, { role: 'admin' }]);
  });

  it('returns an empty output array when items resolve to []', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'f', filter: { items: '[]', condition: '$item' } },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['f']?.output).toEqual([]);
  });

  it('reports variant=filter in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'f', filter: { items: '["a"]', condition: '$item' } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('filter');
  });
});
