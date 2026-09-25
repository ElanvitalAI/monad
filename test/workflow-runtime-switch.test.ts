// Node-catalog N1.2 (2026-05-11) — switch (N-way branch) tests.

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
  return mkdtempSync(join(tmpdir(), 'wf-switch-test-'));
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

describe('schema · switch variant', () => {
  it('accepts a well-formed switch node', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: ['a', 'b'] } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects when value is missing', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { cases: ['a'] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('switch.value'))).toBe(true);
  });

  it('rejects when cases is empty', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: [] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('switch.cases'))).toBe(true);
  });

  it("rejects when cases includes the reserved 'default'", () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: ['a', 'default'] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('reserved'))).toBe(true);
  });
});

describe('executor · switch node', () => {
  it('matches $ARGUMENTS against the cases list (first match wins)', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: ['a', 'b', 'c'] } }],
    };
    for (const arg of ['a', 'b', 'c']) {
      const { outputs } = await runWorkflowToCompletion(
        { workflow: wf, arguments: arg, artifactsDir: makeArtifactsDir() },
        makeDeps(),
      );
      expect(outputs['route']?.output).toBe(arg);
    }
  });

  it("falls through to 'default' on no match", async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: ['a', 'b'] } }],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'z', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['route']?.output).toBe('default');
  });

  it('routes downstream nodes via `when: $route.output == case`', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', switch: { value: '$ARGUMENTS', cases: ['a', 'b'] } },
        { id: 'on-a', bash: 'echo took-a', depends_on: ['route'], when: "$route.output == 'a'" },
        { id: 'on-b', bash: 'echo took-b', depends_on: ['route'], when: "$route.output == 'b'" },
        { id: 'on-default', bash: 'echo took-default', depends_on: ['route'], when: "$route.output == 'default'" },
      ],
    };

    const aRun = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'a', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(aRun.outputs['on-a']?.output).toBe('took-a');
    expect(aRun.outputs['on-b']).toBeUndefined();
    expect(aRun.outputs['on-default']).toBeUndefined();

    const zRun = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'z', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(zRun.outputs['on-a']).toBeUndefined();
    expect(zRun.outputs['on-default']?.output).toBe('took-default');
  });

  it('matches the upstream node output via interpolation', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'detect', bash: 'echo blue' },
        {
          id: 'route',
          depends_on: ['detect'],
          switch: { value: '$detect.output', cases: ['red', 'blue', 'green'] },
        },
      ],
    };
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    expect(outputs['route']?.output).toBe('blue');
  });

  it('reports variant=switch in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', switch: { value: '$ARGUMENTS', cases: ['x'] } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps(),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('switch');
  });
});
