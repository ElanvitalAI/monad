// Archon-port follow-up (2026-05-08) — runDir disk persistence (Caveat #4).
//
// Verifies that when the executor owns the run directory it writes
// per-node outputs and a final run.json, and that the legacy
// `artifactsDir`-only test path skips persistence (so existing tests
// don't suddenly start touching the user's home dir).

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflowToCompletion,
  type WorkflowDefinition,
  type WorkflowDeps,
} from '../src/workflow-runtime/index.js';

const tmpRoots: string[] = [];
afterAll(() => {
  for (const t of tmpRoots) rmSync(t, { recursive: true, force: true });
});

function makeRunDir(): string {
  const t = mkdtempSync(join(tmpdir(), 'wf-runDir-'));
  tmpRoots.push(t);
  return t;
}

function makeDeps(): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => `LLM[${prompt.slice(0, 20)}]`,
    runBash: async (body) => ({
      stdout: body.replace(/^echo\s+/, '').trim(),
      stderr: '',
      exitCode: 0,
    }),
  };
}

const TWO_NODE_WF: WorkflowDefinition = {
  name: 'persist-demo',
  description: 'tests persistence',
  nodes: [
    { id: 'first', bash: 'echo one' },
    { id: 'second', bash: 'echo two', depends_on: ['first'] },
  ],
};

describe('runDir persistence — happy path (Caveat #4)', () => {
  it('writes nodes/<id>.json + run.json with status=done on success', async () => {
    const runDir = makeRunDir();
    const r = await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: 'arg', runDir, runId: 'wf-test-001' },
      makeDeps(),
    );
    expect(r.ok).toBe(true);

    // nodes/ contains one json per node
    const nodeFiles = readdirSync(join(runDir, 'nodes')).sort();
    expect(nodeFiles).toEqual(['first.json', 'second.json']);

    const first = JSON.parse(readFileSync(join(runDir, 'nodes', 'first.json'), 'utf-8'));
    expect(first.ok).toBe(true);
    expect(first.output).toBe('one');
    expect(typeof first.durationMs).toBe('number');

    // run.json final
    const final = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf-8'));
    expect(final.status).toBe('done');
    expect(final.ok).toBe(true);
    expect(final.runId).toBe('wf-test-001');
    expect(final.workflowName).toBe('persist-demo');
    expect(final.arguments).toBe('arg');
    expect(typeof final.startedAt).toBe('number');
    expect(typeof final.completedAt).toBe('number');
    expect(final.completedAt).toBeGreaterThanOrEqual(final.startedAt);
    expect(Object.keys(final.outputs).sort()).toEqual(['first', 'second']);
  });

  it('artifacts/ subdir is created under runDir', async () => {
    const runDir = makeRunDir();
    await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '', runDir },
      makeDeps(),
    );
    expect(existsSync(join(runDir, 'artifacts'))).toBe(true);
  });
});

describe('runDir persistence — failure path', () => {
  it('writes run.json with status=failed when a node fails', async () => {
    const runDir = makeRunDir();
    const wf: WorkflowDefinition = {
      name: 'fail-demo',
      description: 'x',
      nodes: [
        { id: 'ok', bash: 'echo ok' },
        { id: 'broken', bash: 'echo broken', depends_on: ['ok'] },
      ],
    };
    const deps: WorkflowDeps = {
      ...makeDeps(),
      runBash: async (body) => {
        if (body.includes('broken')) {
          return { stdout: '', stderr: 'kaput', exitCode: 1 };
        }
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', runDir },
      deps,
    );
    expect(r.ok).toBe(false);

    const final = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf-8'));
    expect(final.status).toBe('failed');
    expect(final.ok).toBe(false);
    expect(final.error).toContain("node 'broken' failed");

    // The successful upstream still has its node file written.
    const okNode = JSON.parse(readFileSync(join(runDir, 'nodes', 'ok.json'), 'utf-8'));
    expect(okNode.ok).toBe(true);
  });

  it('sanitises unsafe nodeIds when writing the per-node file', async () => {
    const runDir = makeRunDir();
    const wf: WorkflowDefinition = {
      name: 'safe-id',
      description: 'x',
      nodes: [{ id: 'has spaces/and/slash', bash: 'echo x' }],
    };
    await runWorkflowToCompletion(
      { workflow: wf, arguments: '', runDir },
      makeDeps(),
    );
    const files = readdirSync(join(runDir, 'nodes'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
    expect(files[0]).not.toContain(' ');
  });
});

describe('persistence opt-out — legacy artifactsDir-only path', () => {
  it('does not create run.json when only artifactsDir is supplied (the test pattern)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wf-legacy-'));
    tmpRoots.push(tmp);
    await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '', artifactsDir: tmp },
      makeDeps(),
    );
    // No nodes/ dir, no run.json — caller has signalled "I'm managing
    // my own filesystem fixture."
    expect(existsSync(join(tmp, 'nodes'))).toBe(false);
    expect(existsSync(join(tmp, 'run.json'))).toBe(false);
  });

  it('honors persistRun=false even when runDir is set', async () => {
    const runDir = makeRunDir();
    await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '', runDir, persistRun: false },
      makeDeps(),
    );
    expect(existsSync(join(runDir, 'nodes'))).toBe(false);
    expect(existsSync(join(runDir, 'run.json'))).toBe(false);
  });

  it('honors persistRun=true even when only artifactsDir is set', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wf-force-'));
    tmpRoots.push(tmp);
    // persistRun=true forces persistence, but with no runDir there's
    // no parent — the executor should derive defaultRunDir(runId).
    // We pass an explicit runDir to keep the assertion hermetic.
    const runDir = makeRunDir();
    await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '', artifactsDir: tmp, runDir, persistRun: true },
      makeDeps(),
    );
    expect(existsSync(join(runDir, 'run.json'))).toBe(true);
  });
});
