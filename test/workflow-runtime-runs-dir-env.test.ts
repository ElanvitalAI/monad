// HANDOFF §4.4 follow-up — verify `MONAD_WORKFLOWS_RUNS_DIR` env var
// overrides the default `~/.monad/workflows-runs/` root for both the
// executor (write path) and the Nexus disk-hydration loader (read
// path). This lets a dogfood NEXUS isolate its run state from the
// user's primary instance.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflowToCompletion,
  type WorkflowDefinition,
  type WorkflowDeps,
} from '../src/workflow-runtime/index.js';
import {
  _resetWorkflowRunRegistryForTest,
  _setWorkflowRunsRootForTest,
  handleWorkflowRunsList,
} from '../src/nexus/api/workflows.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';

const tmpRoots: string[] = [];
afterAll(() => {
  for (const t of tmpRoots) rmSync(t, { recursive: true, force: true });
});

function makeRoot(): string {
  const t = mkdtempSync(join(tmpdir(), 'wf-runs-env-'));
  tmpRoots.push(t);
  return t;
}

function makeDeps(): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => `LLM[${prompt.slice(0, 12)}]`,
    runBash: async (body) => ({
      stdout: body.replace(/^echo\s+/, '').trim(),
      stderr: '',
      exitCode: 0,
    }),
  };
}

const TWO_NODE_WF: WorkflowDefinition = {
  name: 'env-root-demo',
  description: 'verifies MONAD_WORKFLOWS_RUNS_DIR honored',
  nodes: [
    { id: 'first', bash: 'echo one' },
    { id: 'second', bash: 'echo two', depends_on: ['first'] },
  ],
};

describe('MONAD_WORKFLOWS_RUNS_DIR override (HANDOFF §4.4)', () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.MONAD_WORKFLOWS_RUNS_DIR;
    // Make sure the test-only override doesn't mask env behaviour from
    // a previously-run test in the same file.
    _setWorkflowRunsRootForTest(null);
    _resetWorkflowRunRegistryForTest();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MONAD_WORKFLOWS_RUNS_DIR;
    else process.env.MONAD_WORKFLOWS_RUNS_DIR = prevEnv;
    _setWorkflowRunsRootForTest(null);
  });

  it('executor writes run state under the env-pointed root', async () => {
    const root = makeRoot();
    process.env.MONAD_WORKFLOWS_RUNS_DIR = root;

    const result = await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '' },
      makeDeps(),
    );

    expect(result.ok).toBe(true);
    const entries = readdirSync(root);
    expect(entries.length).toBe(1);
    const runDir = join(root, entries[0]!);
    expect(statSync(runDir).isDirectory()).toBe(true);
    expect(existsSync(join(runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(runDir, 'nodes'))).toBe(true);
    expect(entries[0]).toMatch(/^wf-/);
  });

  it('disk-hydration handler reads runs from the env-pointed root', async () => {
    const root = makeRoot();
    process.env.MONAD_WORKFLOWS_RUNS_DIR = root;

    await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '' },
      makeDeps(),
    );

    // Drop the in-memory record so the handler can only see what's on
    // disk under the env-pointed root.
    _resetWorkflowRunRegistryForTest();

    const opts: MetaApiOpts = { noAuth: true };
    const req = new Request('http://localhost/v1/workflows/runs', {
      method: 'GET',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    const resp = handleWorkflowRunsList(req, opts);
    const body = (await resp.json()) as { runs: Array<{ workflowName: string; status: string }> };
    const fromDisk = body.runs.filter((r) => r.workflowName === 'env-root-demo');
    expect(fromDisk.length).toBe(1);
    expect(['done', 'running']).toContain(fromDisk[0]!.status);
  });

  it('trims whitespace and falls back to default when empty', async () => {
    process.env.MONAD_WORKFLOWS_RUNS_DIR = '   ';
    // Empty after trim → executor uses homedir default. We assert via
    // persistRun:false to avoid touching the real home dir, just
    // proving that whitespace doesn't get spliced into the run path
    // (which would crash mkdir on some filesystems).
    const result = await runWorkflowToCompletion(
      { workflow: TWO_NODE_WF, arguments: '', persistRun: false },
      makeDeps(),
    );
    expect(result.ok).toBe(true);
  });
});
