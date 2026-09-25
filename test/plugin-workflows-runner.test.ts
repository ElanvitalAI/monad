// ── PX-4 P4: workflow runner tests ──
//
// Drives the linear executor with in-memory dispatchers so step
// sequencing, handoff, and onError policies can be exercised without
// hitting the filesystem shell / LLM dispatcher. `.monad/workflows/`
// handoff file writes use tmp dirs that get auto-cleaned by the OS.

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowRunner,
  type WorkflowStepDispatcher,
  type WorkflowRunnerOpts,
} from '../src/plugin-workflows/runner';
import type {
  SkillWorkflow,
  WorkflowStepOnError,
} from '../src/plugin-workflows/types';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-test-'));
}

function workflow(
  steps: SkillWorkflow['steps'],
  over: Partial<SkillWorkflow> = {},
): SkillWorkflow {
  return {
    id: 'wf',
    name: 'Test',
    steps,
    ...over,
  };
}

function makeRunner(
  overrides: Partial<WorkflowRunnerOpts> = {},
  dispatchers: Partial<WorkflowRunnerOpts['dispatchers']> = {},
): WorkflowRunner {
  const defaultD: WorkflowStepDispatcher = async (s) => `(${s.kind}:${s.id})`;
  return new WorkflowRunner({
    workflowsRoot: scratchDir(),
    pluginId: 'test',
    dispatchers: {
      agent: dispatchers.agent ?? defaultD,
      skill: dispatchers.skill ?? defaultD,
      tool: dispatchers.tool ?? defaultD,
      askUser: dispatchers.askUser ?? defaultD,
    },
    ...overrides,
  });
}

describe('PX-4 P4 — WorkflowRunner linear', () => {
  test('runs 3 steps in order; status transitions to done', async () => {
    const order: string[] = [];
    const runner = makeRunner({}, {
      tool: async (s) => { order.push(s.id); return `ran:${s.id}`; },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'a' },
      { kind: 'tool', id: 'b' },
      { kind: 'tool', id: 'c' },
    ]));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(state.status).toBe('done');
    expect(state.steps.every(s => s.status === 'done')).toBe(true);
  });

  test('writes handoff file to .monad/workflows/<wf>-<run>/step-N.md', async () => {
    const root = scratchDir();
    const runner = new WorkflowRunner({
      workflowsRoot: root,
      pluginId: 'test',
      dispatchers: {
        tool: async () => 'hello world',
        agent: async () => '', skill: async () => '', askUser: async () => '',
      },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'Bash', handoff: { outputPath: 'custom.md' } },
    ]));
    const outPath = join(root, '.monad', 'workflows', `wf-${state.runId}`, 'custom.md');
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, 'utf-8')).toBe('hello world');
  });

  test('default output filename is step-N.md (1-indexed)', async () => {
    const root = scratchDir();
    const runner = new WorkflowRunner({
      workflowsRoot: root,
      pluginId: 'test',
      dispatchers: {
        tool: async (s) => `out-${s.id}`,
        agent: async () => '', skill: async () => '', askUser: async () => '',
      },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'a', handoff: {} },  // minimal handoff; falls back to default name
      { kind: 'tool', id: 'b', handoff: {} },
    ]));
    const dir = join(root, '.monad', 'workflows', `wf-${state.runId}`);
    expect(existsSync(join(dir, 'step-1.md'))).toBe(true);
    expect(existsSync(join(dir, 'step-2.md'))).toBe(true);
  });

  test('handoff.passToNext merges output into next step args', async () => {
    const seenArgs: Array<Record<string, unknown>> = [];
    const runner = makeRunner({}, {
      tool: async (s, args) => {
        seenArgs.push({ ...args });
        return s.id === 'first' ? 'FIRST_OUT' : 'done';
      },
    });
    await runner.run(workflow([
      { kind: 'tool', id: 'first', handoff: { passToNext: ['context'] } },
      { kind: 'tool', id: 'second' },
    ]));
    expect(seenArgs[1]!.context).toBe('FIRST_OUT');
  });

  test('dispatch by step.kind — agent + skill + tool + askUser each fire', async () => {
    const log: string[] = [];
    const record = (tag: string): WorkflowStepDispatcher => async (s) => {
      log.push(`${tag}:${s.id}`);
      return tag;
    };
    const runner = makeRunner({}, {
      agent: record('A'), skill: record('S'), tool: record('T'), askUser: record('Q'),
    });
    await runner.run(workflow([
      { kind: 'agent', id: 'a1' },
      { kind: 'skill', id: 's1' },
      { kind: 'tool', id: 't1' },
      { kind: 'askUser', id: 'q1' },
    ]));
    expect(log).toEqual(['A:a1', 'S:s1', 'T:t1', 'Q:q1']);
  });

  test('onError=abort (default) stops execution; later steps stay pending', async () => {
    const runner = makeRunner({}, {
      tool: async (s) => { if (s.id === 'fail') throw new Error('boom'); return 'ok'; },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'ok1' },
      { kind: 'tool', id: 'fail' },
      { kind: 'tool', id: 'not-reached' },
    ]));
    expect(state.status).toBe('error');
    expect(state.steps[0]!.status).toBe('done');
    expect(state.steps[1]!.status).toBe('running');  // failed mid-run
    expect(state.steps[2]!.status).toBe('pending');
  });

  test('onError=skip continues to next step + marks status skipped', async () => {
    const runner = makeRunner({}, {
      tool: async (s) => { if (s.id === 'bad') throw new Error('x'); return 'ok'; },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'ok' },
      { kind: 'tool', id: 'bad', onError: 'skip' },
      { kind: 'tool', id: 'after' },
    ]));
    expect(state.status).toBe('done');
    expect(state.steps[1]!.status).toBe('skipped');
    expect(state.steps[2]!.status).toBe('done');
  });

  test('onError=retry retries up to maxRetries then aborts', async () => {
    let calls = 0;
    const runner = makeRunner({}, {
      tool: async (s) => {
        if (s.id === 'flaky') { calls++; throw new Error('try again'); }
        return 'ok';
      },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'flaky', onError: 'retry', maxRetries: 2 },
    ]));
    expect(calls).toBe(3);   // initial + 2 retries
    expect(state.status).toBe('error');
    expect(state.steps[0]!.retries).toBe(2);
  });

  test('onError=ask delegates to opts.onAskUser', async () => {
    let asked = 0;
    const runner = makeRunner({
      onAskUser: async () => { asked++; return 'skip' satisfies WorkflowStepOnError; },
    }, {
      tool: async (s) => { if (s.id === 'bad') throw new Error('x'); return 'ok'; },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'bad', onError: 'ask' },
      { kind: 'tool', id: 'after' },
    ]));
    expect(asked).toBe(1);
    expect(state.steps[0]!.status).toBe('skipped');
    expect(state.steps[1]!.status).toBe('done');
    expect(state.status).toBe('done');
  });

  test('abort(runId) mid-run stops execution', async () => {
    let started = 0;
    const runner = makeRunner({}, {
      tool: async (_s, _args, ctx) => {
        started++;
        if (started === 1) {
          // Ask the runner to abort before step 2 starts.
          runner.abort(ctx.runId, 'user-cancel');
        }
        return 'ok';
      },
    });
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'a' },
      { kind: 'tool', id: 'b' },
    ]));
    expect(started).toBe(1);
    expect(state.status).toBe('aborted');
  });

  test('unknown kind via runtime injection → abort with clear error', async () => {
    const runner = makeRunner({}, {
      tool: (async () => { throw new Error('never-called'); }) as any,
    });
    // Force a bogus dispatch by deleting the tool dispatcher.
    (runner as any).opts.dispatchers.tool = undefined;
    const state = await runner.run(workflow([
      { kind: 'tool', id: 'a' },
    ]));
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/no dispatcher/);
  });

  test('status(runId) returns a cloned snapshot (no mutation leak)', async () => {
    const runner = makeRunner();
    const first = await runner.run(workflow([
      { kind: 'tool', id: 'a' },
    ]));
    const snap = await runner.status(first.runId);
    expect(snap?.status).toBe('done');
    // Mutating the snapshot does not alter registry state.
    if (snap) snap.status = 'aborted';
    const snap2 = await runner.status(first.runId);
    expect(snap2?.status).toBe('done');
  });

  test('onStepComplete fires after each step', async () => {
    const seen: number[] = [];
    const runner = makeRunner({
      onStepComplete: (s) => { seen.push(s.currentStep); },
    });
    await runner.run(workflow([
      { kind: 'tool', id: 'a' },
      { kind: 'tool', id: 'b' },
    ]));
    // Fires per-step + once more on final state (post-loop).
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });
});
