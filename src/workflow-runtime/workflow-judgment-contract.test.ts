import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runWorkflow, runWorkflowToCompletion } from './executor.js';
import { validateJudgmentContract } from './judgment-contract.js';
import type { JudgmentContext, WorkflowDefinition, WorkflowDeps } from './types.js';

function deps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async ({ prompt }) => `llm:${prompt}`,
    runBash: async () => ({ stdout: 'bash', stderr: '', exitCode: 0 }),
    ...overrides,
  };
}

function workflow(node: WorkflowDefinition['nodes'][number]): WorkflowDefinition {
  return { name: 'judgment-contract', description: 'd', nodes: [node] };
}

describe('workflow judgment contract validation', () => {
  it('rejects cadences whose substrate is not wired', () => {
    const node = { id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1', cadence: 'on-signal' } as never;
    const reason = validateJudgmentContract(node);
    expect(reason).toContain('on-signal');
    expect(reason).toContain('not wired');
  });

  it('rejects unknown vocabulary and executions by name', () => {
    expect(validateJudgmentContract({
      id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1', vocabulary: ['invent']
    } as never)).toContain("vocabulary 'invent'");
    expect(validateJudgmentContract({
      id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1', executions: ['launch-missiles']
    } as never)).toContain("execution 'launch-missiles'");
  });

  it('accepts a strict vocabulary subset and catalog execution declaration', () => {
    expect(validateJudgmentContract({
      id: 'judge',
      prompt: 'p',
      judgment: 'executor-supervision@v1',
      cadence: 'always',
      vocabulary: ['continue', 'defer'],
      executions: ['noop', 'finalize'],
    } as never)).toBeNull();
  });
});

describe('workflow judgment contract executor gate', () => {
  it('preserves legacy node dispatch when judgment is absent', async () => {
    const result = await runWorkflowToCompletion(
      { workflow: workflow({ id: 'legacy', prompt: 'p' } as never), arguments: 'goal' },
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.outputs.legacy).toMatchObject({ ok: true, output: 'llm:p' });
  });

  it('blocks invalid contracts before dispatch and permits downstream all_done', async () => {
    const result = await runWorkflowToCompletion(
      {
        workflow: {
          name: 'contract-gate',
          description: 'd',
          nodes: [
            { id: 'judge', prompt: 'must-not-run', judgment: 'executor-supervision@v1', cadence: 'scheduled' } as never,
            { id: 'cleanup', bash: 'cleanup', depends_on: ['judge'], trigger_rule: 'all_done' } as never,
          ],
        },
        arguments: '',
      },
      deps({ callLLM: async () => { throw new Error('dispatch should not run'); } }),
    );
    expect(result.outputs.judge).toMatchObject({ ok: false });
    expect(result.outputs.judge?.error).toContain('judgment contract unmet');
    expect(result.outputs.judge?.error).toContain('not wired');
    expect(result.outputs.cleanup).toMatchObject({ ok: true, output: 'bash' });
    expect(result.events.filter((event) => event.type === 'node_start').map((event) => event.nodeId)).toEqual(['judge', 'cleanup']);
    expect(result.events.filter((event) => event.type === 'node_done').map((event) => event.nodeId)).toEqual(['judge', 'cleanup']);
  });

  it('blocks a declared judgment when runJudgment is not injected', async () => {
    const result = await runWorkflowToCompletion(
      { workflow: workflow({ id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1' } as never), arguments: '' },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.outputs.judge?.error).toContain('deps.runJudgment');
  });

  it('calls runJudgment with only declared observations', async () => {
    let received: JudgmentContext | undefined;
    const result = await runWorkflowToCompletion(
      {
        workflow: workflow({
          id: 'judge',
          prompt: 'p',
          judgment: 'executor-supervision@v1',
          observes: ['goal', 'lifecycle'],
          vocabulary: ['continue', 'defer'],
        } as never),
        arguments: 'ship the contract',
      },
      deps({
        runJudgment: async (contractId, context) => {
          expect(contractId).toBe('executor-supervision@v1');
          received = context;
          return { ok: true, verdict: 'continue', output: { verdict: 'continue' } };
        },
      }),
    );
    expect(received).toEqual({
      goal: 'ship the contract',
      lifecycle: { workflow: 'judgment-contract', nodeId: 'judge' },
    });
    expect(result.outputs.judge).toMatchObject({ ok: true, output: { verdict: 'continue' } });
  });
});

describe('workflow judgment contract runtime enforcement', () => {
  function runDir(): string {
    return mkdtempSync(join(tmpdir(), 'workflow-judgment-'));
  }

  function persistedNode(dir: string, id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, 'nodes', `${id}.json`), 'utf8')) as Record<string, unknown>;
  }

  function persistedRun(dir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as Record<string, unknown>;
  }

  it('persists a preflight block with the original workflow start time', async () => {
    const dir = runDir();
    const error = "judgment contract unmet — cadence 'scheduled' is not wired: scheduled requires deferred-resume wiring";
    const generator = runWorkflow(
      {
        workflow: workflow({
          id: 'judge',
          prompt: 'must-not-run',
          judgment: 'executor-supervision@v1',
          cadence: 'scheduled',
        } as never),
        arguments: 'goal',
        runDir: dir,
        persistRun: true,
        runId: 'judgment-preflight-block',
      },
      deps({
        callLLM: async () => { throw new Error('dispatch should not run'); },
        runJudgment: async () => { throw new Error('judgment should not run'); },
      }),
    );

    const first = await generator.next();
    expect(first.value).toMatchObject({ type: 'workflow_start', runId: 'judgment-preflight-block' });
    const originalStartedAt = persistedRun(dir).startedAt;
    await Bun.sleep(5);

    const events = [];
    while (true) {
      const next = await generator.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(persistedNode(dir, 'judge')).toMatchObject({ ok: false, output: '', error });
    expect(persistedRun(dir)).toMatchObject({
      runId: 'judgment-preflight-block',
      workflowName: 'judgment-contract',
      arguments: 'goal',
      startedAt: originalStartedAt,
      ok: false,
      status: 'failed',
      error: "node 'judge' blocked: cadence 'scheduled' is not wired: scheduled requires deferred-resume wiring",
      outputs: { judge: { ok: false, output: '', error } },
    });
    expect(events.filter((event) => event.type === 'node_start').map((event) => event.nodeId)).toEqual(['judge']);
    expect(events.filter((event) => event.type === 'node_done').map((event) => event.nodeId)).toEqual(['judge']);
  });

  it('persists a normal judgment result with node lifecycle events', async () => {
    const dir = runDir();
    const result = await runWorkflowToCompletion(
      {
        workflow: workflow({
          id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1',
          vocabulary: ['continue'],
        } as never),
        arguments: '',
        runDir: dir,
        persistRun: true,
      },
      deps({ runJudgment: async () => ({ output: 'accepted', verdict: 'continue' }) }),
    );
    expect(result.ok).toBe(true);
    expect(persistedNode(dir, 'judge')).toMatchObject({ ok: true, output: 'accepted' });
    expect(result.events.map((event) => event.type)).toContain('node_start');
    expect(result.events.map((event) => event.type)).toContain('node_done');
  });

  it('blocks and persists a verdict outside the declared vocabulary while all_done continues', async () => {
    const dir = runDir();
    const result = await runWorkflowToCompletion(
      {
        workflow: {
          name: 'verdict-gate', description: 'd', nodes: [
            {
              id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1',
              vocabulary: ['continue', 'defer'],
            } as never,
            { id: 'cleanup', bash: 'cleanup', depends_on: ['judge'], trigger_rule: 'all_done' } as never,
          ],
        },
        arguments: '',
        runDir: dir,
        persistRun: true,
      },
      deps({ runJudgment: async () => ({ output: 'forbidden', verdict: 'complete' }) }),
    );
    expect(result.outputs.judge).toMatchObject({ ok: false });
    expect(result.outputs.judge?.error).toContain("judgment verdict 'complete'");
    expect(persistedNode(dir, 'judge')).toMatchObject({ ok: false });
    expect(result.outputs.cleanup).toMatchObject({ ok: true });
    expect(result.events.filter((event) => event.type === 'node_start').map((event) => event.nodeId)).toEqual(['judge', 'cleanup']);
    expect(result.events.filter((event) => event.type === 'node_done').map((event) => event.nodeId)).toEqual(['judge', 'cleanup']);
  });

  it('supplies screen only when requested and blocks requested screen without a source', async () => {
    let received: JudgmentContext | undefined;
    const supplied = await runWorkflowToCompletion(
      {
        workflow: workflow({
          id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1', observes: ['screen'],
        } as never),
        arguments: '',
        screen: { text: 'live screen' },
      },
      deps({ runJudgment: async (_id, context) => {
        received = context;
        return { output: 'ok' };
      } }),
    );
    expect(supplied.ok).toBe(true);
    expect(received).toEqual({ screen: { text: 'live screen' } });

    let called = false;
    const absent = await runWorkflowToCompletion(
      { workflow: workflow({ id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1', observes: ['screen'] } as never), arguments: '' },
      deps({ runJudgment: async () => { called = true; return { output: 'never' }; } }),
    );
    expect(absent.outputs.judge).toMatchObject({ ok: false });
    expect(absent.outputs.judge?.error).toContain('screen observation is not wired');
    expect(called).toBe(false);

    let unrequested: JudgmentContext | undefined;
    await runWorkflowToCompletion(
      { workflow: workflow({ id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1' } as never), arguments: '', screen: 'hidden' },
      deps({ runJudgment: async (_id, context) => { unrequested = context; return { output: 'ok' }; } }),
    );
    expect(unrequested).toEqual({});
  });

  it('fails closed and persists judgment errors even when ok is true', async () => {
    const dir = runDir();
    const result = await runWorkflowToCompletion(
      {
        workflow: workflow({ id: 'judge', prompt: 'p', judgment: 'executor-supervision@v1' } as never),
        arguments: '',
        runDir: dir,
        persistRun: true,
      },
      deps({ runJudgment: async () => ({ ok: true, output: 'contradictory', error: 'judgment failed' }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.outputs.judge).toMatchObject({ ok: false, error: 'judgment failed' });
    expect(persistedNode(dir, 'judge')).toMatchObject({ ok: false, error: 'judgment failed' });
    expect(result.events.filter((event) => event.type === 'node_start').map((event) => event.nodeId)).toEqual(['judge']);
    expect(result.events.filter((event) => event.type === 'node_done').map((event) => event.nodeId)).toEqual(['judge']);
  });
});
