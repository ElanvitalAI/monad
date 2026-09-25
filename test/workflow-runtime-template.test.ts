// Node-catalog N3.3 (2026-05-11) — template (handlebars-lite) tests.

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
import { renderTemplate } from '../src/workflow-runtime/nodes/template.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-tpl-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async () => '',
    runBash: async (body) => ({ stdout: body, stderr: '', exitCode: 0 }),
    ...over,
  };
}

describe('renderTemplate (pure)', () => {
  it('substitutes {{ARGUMENTS}}', () => {
    const r = renderTemplate('Hello {{ARGUMENTS}}!', {
      arguments: 'World', artifactsDir: '/tmp', outputs: {},
    });
    expect(r.text).toBe('Hello World!');
    expect(r.missing).toEqual([]);
  });

  it('trims whitespace inside tags', () => {
    const r = renderTemplate('Hi {{  ARGUMENTS  }} done', {
      arguments: 'Alice', artifactsDir: '', outputs: {},
    });
    expect(r.text).toBe('Hi Alice done');
  });

  it('substitutes node output (full + field)', () => {
    const r = renderTemplate('name={{detect.output}}, score={{detect.output.score}}', {
      arguments: '', artifactsDir: '', outputs: {
        detect: { output: { score: 0.9 } },
      },
    });
    expect(r.text).toBe('name={"score":0.9}, score=0.9');
  });

  it('emits empty + records missing for unknown ref', () => {
    const r = renderTemplate('hi {{nope.output}} done', {
      arguments: '', artifactsDir: '', outputs: {},
    });
    expect(r.text).toBe('hi  done');
    expect(r.missing).toContain('nope.output');
  });

  it('emits empty + records missing for malformed inside-tag content', () => {
    const r = renderTemplate('{{not_a_ref}}', {
      arguments: '', artifactsDir: '', outputs: {},
    });
    expect(r.text).toBe('');
    expect(r.missing).toContain('not_a_ref');
  });

  it('handles ARTIFACTS_DIR', () => {
    const r = renderTemplate('save in {{ARTIFACTS_DIR}}', {
      arguments: '', artifactsDir: '/tmp/run-abc', outputs: {},
    });
    expect(r.text).toBe('save in /tmp/run-abc');
  });

  it('preserves text without tags', () => {
    const r = renderTemplate('plain text only', {
      arguments: '', artifactsDir: '', outputs: {},
    });
    expect(r.text).toBe('plain text only');
  });

  it('handles multiple tags in one template', () => {
    const r = renderTemplate('{{a.output}} → {{b.output.x}}', {
      arguments: '', artifactsDir: '', outputs: {
        a: { output: 'first' },
        b: { output: { x: 'second' } },
      },
    });
    expect(r.text).toBe('first → second');
  });

  it('does NOT interpret $X.output syntax (reserved for runtime side)', () => {
    const r = renderTemplate('use $foo.output here', {
      arguments: '', artifactsDir: '', outputs: {
        foo: { output: 'bar' },
      },
    });
    // The `$foo.output` is left as-is — template only handles `{{ ... }}`.
    expect(r.text).toBe('use $foo.output here');
  });
});

describe('schema · template variant', () => {
  it('accepts a well-formed template', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 't', template: { template: 'Hello {{ARGUMENTS}}' } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty template string', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 't', template: { template: '' } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('template.template'))).toBe(true);
  });

  it('rejects non-string template field', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 't', template: { template: 42 } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('executor · template node', () => {
  it('renders the template using run args', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'msg', template: { template: 'Hello {{ARGUMENTS}}!' } }],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'World', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['msg']?.output).toBe('Hello World!');
  });

  it('renders upstream node outputs', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'who', bash: 'echo Alice' },
        {
          id: 'msg',
          depends_on: ['who'],
          template: { template: 'name={{who.output}}' },
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
    expect(outputs['msg']?.output).toBe('name=Alice');
  });

  it('reports variant=template in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 't', template: { template: '{{ARGUMENTS}}' } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('template');
  });
});
