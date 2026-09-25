// Node-catalog N2.2 (2026-05-11) — extract (LLM structured extraction) tests.

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
import { parseExtractResponse } from '../src/workflow-runtime/nodes/extract.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-extract-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async () => '{"name":"Alice","date":"2026-05-11"}',
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...over,
  };
}

describe('parseExtractResponse (pure)', () => {
  it('parses a bare JSON object', () => {
    expect(parseExtractResponse('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json code fences', () => {
    expect(parseExtractResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseExtractResponse('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('tolerates surrounding commentary', () => {
    expect(parseExtractResponse("Here's the JSON: {\"a\":3} done."))
      .toEqual({ a: 3 });
  });

  it('returns null for non-JSON', () => {
    expect(parseExtractResponse('this is not JSON')).toBeNull();
    expect(parseExtractResponse('')).toBeNull();
  });

  it('rejects a JSON array (we want an object output)', () => {
    expect(parseExtractResponse('[1,2,3]')).toBeNull();
  });

  it('rejects a JSON primitive', () => {
    expect(parseExtractResponse('"just a string"')).toBeNull();
    expect(parseExtractResponse('42')).toBeNull();
  });
});

describe('schema · extract variant', () => {
  it('accepts well-formed extract', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'pull', extract: { input: '$ARGUMENTS', schema: { name: 'person name' } } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty schema', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'pull', extract: { input: '$ARGUMENTS', schema: {} } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('extract.schema'))).toBe(true);
  });

  it('rejects non-string description in schema', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'pull', extract: { input: '$ARGUMENTS', schema: { name: 42 } } }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects missing input', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'pull', extract: { schema: { name: 'desc' } } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('extract.input'))).toBe(true);
  });
});

describe('executor · extract node', () => {
  it('parses the LLM response and emits the JSON object as output', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        {
          id: 'pull',
          extract: {
            input: '$ARGUMENTS',
            schema: { name: 'person name', date: 'ISO date' },
          },
        },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'Alice on 2026-05-11', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['pull']?.ok).toBe(true);
    expect(outputs['pull']?.output).toEqual({ name: 'Alice', date: '2026-05-11' });
  });

  it('exposes fields via $node.output.field interpolation', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        {
          id: 'pull',
          extract: {
            input: '$ARGUMENTS',
            schema: { name: 'name' },
          },
        },
        {
          id: 'echo',
          bash: 'echo extracted-name=$pull.output.name',
          depends_on: ['pull'],
        },
      ],
    };
    const deps = makeDeps({
      callLLM: async () => '{"name":"Bob"}',
      runBash: async (b) => ({ stdout: b, stderr: '', exitCode: 0 }),
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'hi', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['echo']?.output).toBe('echo extracted-name=Bob');
  });

  it('returns ok=false when response is not valid JSON', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'pull', extract: { input: '$ARGUMENTS', schema: { x: 'val' } } },
      ],
    };
    const deps = makeDeps({ callLLM: async () => 'nope, no JSON here' });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(false);
    expect(outputs['pull']?.ok).toBe(false);
    expect(outputs['pull']?.error).toContain('not valid JSON');
  });

  it('tolerates ```json code fences in the LLM response', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'pull', extract: { input: '$ARGUMENTS', schema: { k: 'val' } } },
      ],
    };
    const deps = makeDeps({ callLLM: async () => '```json\n{"k":"v"}\n```' });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['pull']?.output).toEqual({ k: 'v' });
  });

  it('retries on invalid JSON until parse succeeds (v2)', async () => {
    let calls = 0;
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'pull',
        extract: {
          input: '$ARGUMENTS',
          schema: { x: 'val' },
          retries: 2,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => {
        calls++;
        return calls < 2 ? 'nope, not json' : '{"x":"y"}';
      },
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(true);
    expect(outputs['pull']?.output).toEqual({ x: 'y' });
    expect(calls).toBe(2);
  });

  it('retries on LLM throw (v2)', async () => {
    let calls = 0;
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'pull',
        extract: {
          input: '$ARGUMENTS',
          schema: { k: 'v' },
          retries: 2,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => {
        calls++;
        if (calls < 3) throw new Error('rate limit');
        return '{"k":"ok"}';
      },
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['pull']?.output).toEqual({ k: 'ok' });
    expect(calls).toBe(3);
  });

  it('returns ok=false after exhausting retries (v2)', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'pull',
        extract: {
          input: '$ARGUMENTS',
          schema: { x: 'val' },
          retries: 2,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => 'still not json',
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(false);
    expect(outputs['pull']?.error).toContain('not valid JSON');
  });

  it('reports variant=extract in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'pull', extract: { input: '$ARGUMENTS', schema: { a: 'b' } } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps({ callLLM: async () => '{"a":"b"}' }),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('extract');
  });
});
