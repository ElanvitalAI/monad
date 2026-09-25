// Node-catalog N1.1 (2026-05-11) — if (boolean branch) node tests.
//
// Mirrors the executor.test.ts pattern: stubbed deps, real wiring.
// We verify (a) condition true → output 'then' (b) false → 'else'
// (c) downstream `when:` clause routes correctly + the off-branch is
// skipped.

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

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-if-test-'));
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

describe('schema · if variant', () => {
  it('accepts an if node with a non-empty condition', () => {
    const wf = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', if: { condition: "$ARGUMENTS == 'yes'" } },
      ],
    };
    const r = validateWorkflow(wf);
    expect(r.ok).toBe(true);
    expect(r.workflow?.nodes[0]).toMatchObject({ id: 'route' });
  });

  it('rejects an if node with no condition', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', if: {} }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('if.condition'))).toBe(true);
  });

  it('rejects an if node mixed with another variant', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', if: { condition: '$ARGUMENTS' }, bash: 'echo' }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('multiple variants'))).toBe(true);
  });
});

describe('executor · if node', () => {
  it("emits output 'then' when the condition is truthy ($ARGUMENTS truthy)", async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', if: { condition: "$ARGUMENTS == 'yes'" } },
      ],
    };
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'yes', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(ok).toBe(true);
    expect(outputs['route']?.output).toBe('then');
  });

  it("emits output 'else' when the condition is falsy", async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', if: { condition: "$ARGUMENTS == 'yes'" } },
      ],
    };
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'no', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(ok).toBe(true);
    expect(outputs['route']?.output).toBe('else');
  });

  it('routes downstream nodes via `when: $route.output == \'then\'`', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', if: { condition: "$ARGUMENTS == 'yes'" } },
        {
          id: 'on-then',
          bash: 'echo took-then',
          depends_on: ['route'],
          when: "$route.output == 'then'",
        },
        {
          id: 'on-else',
          bash: 'echo took-else',
          depends_on: ['route'],
          when: "$route.output == 'else'",
        },
      ],
    };

    const yesRun = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'yes', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(yesRun.outputs['on-then']?.output).toBe('took-then');
    expect(yesRun.outputs['on-else']).toBeUndefined();
    expect(yesRun.events.some((e) => e.type === 'node_skipped' && e.nodeId === 'on-else')).toBe(true);

    const noRun = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'no', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(noRun.outputs['on-then']).toBeUndefined();
    expect(noRun.outputs['on-else']?.output).toBe('took-else');
    expect(noRun.events.some((e) => e.type === 'node_skipped' && e.nodeId === 'on-then')).toBe(true);
  });

  it('reports variant=if in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', if: { condition: '$ARGUMENTS' } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('if');
  });

  it('chains an if node off a previous bash output', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'detect', bash: "echo high" },
        {
          id: 'route',
          depends_on: ['detect'],
          if: { condition: "$detect.output == 'high'" },
        },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['route']?.output).toBe('then');
  });
});
