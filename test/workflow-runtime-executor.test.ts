// Archon-port T2.1 (2026-05-08) — DAG executor integration tests.
//
// Real wiring with stubbed deps (no fixed-module mock). Each test
// constructs a tiny WorkflowDefinition + WorkflowDeps stubs and asserts
// the event stream + outputs.

import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflow,
  runWorkflowToCompletion,
  type WorkflowDeps,
  type WorkflowDefinition,
  type WorkflowEvent,
} from '../src/workflow-runtime/index.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => `LLM[${prompt.length}]`,
    runBash: async (body) => ({
      stdout: body.includes('echo')
        ? body.replace(/^echo\s+/, '').trim()
        : body.trim(),
      stderr: '',
      exitCode: 0,
    }),
    ...over,
  };
}

const collect = async (
  workflow: WorkflowDefinition,
  args: string,
  deps: WorkflowDeps,
): Promise<{ events: WorkflowEvent[]; outputs: Record<string, unknown>; ok: boolean }> => {
  const r = await runWorkflowToCompletion(
    {
      workflow,
      arguments: args,
      artifactsDir: makeArtifactsDir(),
    },
    deps,
  );
  const flat = Object.fromEntries(Object.entries(r.outputs).map(([k, v]) => [k, v.output]));
  return { events: r.events, outputs: flat, ok: r.ok };
};

describe('runWorkflow — single bash node', () => {
  it('produces stdout as output', async () => {
    const wf: WorkflowDefinition = {
      name: 'one',
      description: 'x',
      nodes: [{ id: 'echo', bash: 'echo hello' }],
    };
    const r = await collect(wf, '', makeDeps());
    expect(r.ok).toBe(true);
    expect(r.outputs['echo']).toBe('hello');
  });
});

describe('runWorkflow — chain w/ variable interp', () => {
  it('passes prior output via $<id>.output', async () => {
    const wf: WorkflowDefinition = {
      name: 'chain',
      description: 'x',
      nodes: [
        { id: 'first', bash: 'echo first-result' },
        { id: 'second', bash: 'echo prev=$first.output', depends_on: ['first'] },
      ],
    };
    const r = await collect(wf, '', makeDeps());
    expect(r.ok).toBe(true);
    expect(r.outputs['second']).toBe('prev=first-result');
  });
});

describe('runWorkflow — prompt node with output_format', () => {
  it('JSON-parses LLM response', async () => {
    const wf: WorkflowDefinition = {
      name: 'cls',
      description: 'classification',
      nodes: [
        {
          id: 'classify',
          prompt: 'classify $ARGUMENTS',
          allowed_tools: [],
          output_format: { type: 'object' },
        },
      ],
    };
    const r = await collect(wf, 'TestInput', makeDeps({
      callLLM: async () => '{"label":"foo","score":0.9}',
    }));
    expect(r.ok).toBe(true);
    expect(r.outputs['classify']).toEqual({ label: 'foo', score: 0.9 });
  });

  it('handles fenced JSON gracefully', async () => {
    const wf: WorkflowDefinition = {
      name: 'fenced',
      description: 'x',
      nodes: [
        { id: 'p', prompt: 'p', output_format: { type: 'object' } },
      ],
    };
    const r = await collect(wf, '', makeDeps({
      callLLM: async () => '```json\n{"a":1}\n```',
    }));
    expect(r.ok).toBe(true);
    expect(r.outputs['p']).toEqual({ a: 1 });
  });

  it('reports parse error as ok=false', async () => {
    const wf: WorkflowDefinition = {
      name: 'bad-json',
      description: 'x',
      nodes: [
        { id: 'p', prompt: 'p', output_format: { type: 'object' } },
      ],
    };
    const r = await collect(wf, '', makeDeps({
      callLLM: async () => 'not json',
    }));
    expect(r.ok).toBe(false);
  });
});

describe('runWorkflow — failure propagation', () => {
  it('stops chain when a node fails (default: trigger_rule=all_success)', async () => {
    const wf: WorkflowDefinition = {
      name: 'fail-stop',
      description: 'x',
      nodes: [
        { id: 'first', bash: 'oops' },
        { id: 'second', bash: 'echo never', depends_on: ['first'] },
      ],
    };
    const r = await collect(wf, '', makeDeps({
      runBash: async (body) => {
        if (body === 'oops') return { stdout: '', stderr: 'err', exitCode: 1 };
        return { stdout: body, stderr: '', exitCode: 0 };
      },
    }));
    expect(r.ok).toBe(false);
    expect(r.events.some(e => e.type === 'workflow_failed')).toBe(true);
    // second node should not have produced output
    expect(r.outputs['second']).toBeUndefined();
  });

  it('continues to all_done node despite upstream failure', async () => {
    const wf: WorkflowDefinition = {
      name: 'cleanup',
      description: 'x',
      nodes: [
        { id: 'work', bash: 'oops' },
        {
          id: 'cleanup',
          bash: 'echo cleanup-ran',
          depends_on: ['work'],
          trigger_rule: 'all_done',
        },
      ],
    };
    const r = await collect(wf, '', makeDeps({
      runBash: async (body) => {
        if (body === 'oops') return { stdout: '', stderr: '', exitCode: 1 };
        return { stdout: body, stderr: '', exitCode: 0 };
      },
    }));
    // The custom runBash stub returns body verbatim — verifies the
    // node ran (output is the raw heredoc) despite upstream failure.
    expect(r.outputs['cleanup']).toBe('echo cleanup-ran');
  });
});

describe('runWorkflow — when expression', () => {
  it('skips node when condition is false', async () => {
    const wf: WorkflowDefinition = {
      name: 'guarded',
      description: 'x',
      nodes: [
        { id: 'check', bash: 'echo skip' },
        { id: 'act', bash: 'echo never', depends_on: ['check'], when: "$check.output == 'go'" },
      ],
    };
    const r = await collect(wf, '', makeDeps());
    expect(r.events.some(e => e.type === 'node_skipped' && e.nodeId === 'act')).toBe(true);
    expect(r.outputs['act']).toBeUndefined();
  });

  it('runs node when condition is true', async () => {
    const wf: WorkflowDefinition = {
      name: 'guarded-run',
      description: 'x',
      nodes: [
        { id: 'check', bash: 'echo go' },
        { id: 'act', bash: 'echo proceed', depends_on: ['check'], when: "$check.output == 'go'" },
      ],
    };
    const r = await collect(wf, '', makeDeps());
    expect(r.outputs['act']).toBe('proceed');
  });
});

describe('runWorkflow — skill / cft / approval delegation', () => {
  it('skill node delegates to deps.runSkill', async () => {
    const wf: WorkflowDefinition = {
      name: 'skill-only',
      description: 'x',
      nodes: [{ id: 'sum', skill: 'omni-digest', arguments: 'https://example.com' }],
    };
    const calls: { slug: string; args: string }[] = [];
    const r = await collect(wf, 'unused', makeDeps({
      runSkill: async (slug, args) => {
        calls.push({ slug, args });
        return `SUMMARY[${slug}](${args})`;
      },
    }));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ slug: 'omni-digest', args: 'https://example.com' }]);
    expect(r.outputs['sum']).toBe('SUMMARY[omni-digest](https://example.com)');
  });

  it('cft node delegates to deps.runCft', async () => {
    const wf: WorkflowDefinition = {
      name: 'cft-only',
      description: 'x',
      nodes: [{ id: 'pdca', cft: 'pdca', config: { plan: 'do something' } }],
    };
    const r = await collect(wf, '', makeDeps({
      runCft: async (method, cfg) => ({ method, cfg }),
    }));
    expect(r.ok).toBe(true);
    expect(r.outputs['pdca']).toEqual({ method: 'pdca', cfg: { plan: 'do something' } });
  });

  it('approval node delegates to deps.requestApproval', async () => {
    const wf: WorkflowDefinition = {
      name: 'gate',
      description: 'x',
      nodes: [{ id: 'gate', approval: { message: 'ok?' } }],
    };
    const r = await collect(wf, '', makeDeps({
      requestApproval: async () => undefined,
    }));
    expect(r.ok).toBe(true);
    expect(r.outputs['gate']).toBe('approved');
  });

  it('approval captures response when capture_response=true', async () => {
    const wf: WorkflowDefinition = {
      name: 'gate-cap',
      description: 'x',
      nodes: [{ id: 'gate', approval: { message: 'ok?', capture_response: true } }],
    };
    const r = await collect(wf, '', makeDeps({
      requestApproval: async () => 'looks good',
    }));
    expect(r.outputs['gate']).toBe('looks good');
  });

  it('skill node fails fast when deps.runSkill missing', async () => {
    const wf: WorkflowDefinition = {
      name: 'no-skill',
      description: 'x',
      nodes: [{ id: 'sum', skill: 'omni-digest' }],
    };
    const r = await collect(wf, '', makeDeps()); // no runSkill
    expect(r.ok).toBe(false);
  });
});

describe('runWorkflow — cycle detection', () => {
  it('emits workflow_failed on cycle (validator-bypassed input)', async () => {
    const wf: WorkflowDefinition = {
      name: 'loop',
      description: 'x',
      nodes: [
        { id: 'a', bash: 'true', depends_on: ['b'] },
        { id: 'b', bash: 'true', depends_on: ['a'] },
      ],
    };
    const r = await collect(wf, '', makeDeps());
    expect(r.ok).toBe(false);
    expect(r.events.some(e => e.type === 'workflow_failed')).toBe(true);
  });
});

describe('runWorkflow — event stream shape', () => {
  it('emits start/node_start/node_done/done in order', async () => {
    const wf: WorkflowDefinition = {
      name: 'shape',
      description: 'x',
      nodes: [{ id: 'x', bash: 'echo hi' }],
    };
    const events: WorkflowEvent[] = [];
    for await (const e of runWorkflow(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    )) {
      events.push(e);
    }
    const types = events.map(e => e.type);
    expect(types).toEqual([
      'workflow_start',
      'node_start',
      'node_done',
      'workflow_done',
    ]);
  });
});
