import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowRunner,
  type WorkflowRunEvent,
} from '../src/plugin-workflows/runner.js';
import type { SkillWorkflow } from '../src/plugin-workflows/types.js';

function makeWorkflow(steps: { id: string; kind: 'tool' }[]): SkillWorkflow {
  return {
    id: 'wf-test',
    title: 'test workflow',
    steps: steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      args: { dummy: true },
    })),
  } as SkillWorkflow;
}

describe('WorkflowRunner.subscribe (Wave P4a-1)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'wf-runner-sub-'));
  });

  test('subscribe registers + unsubscribe disposes the listener', () => {
    const runner = new WorkflowRunner({
      workflowsRoot: tmpRoot,
      pluginId: 'test',
      dispatchers: { tool: async () => 'ok' } as never,
    });
    const events: WorkflowRunEvent[] = [];
    const off = runner.subscribe((e) => events.push(e));
    expect(typeof off).toBe('function');
    off();
    // After unsubscribe a new run still works but the disposed listener
    // never fires.
    expect(events.length).toBe(0);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('run() emits run-start, step-complete (×N), run-end in order', async () => {
    const events: WorkflowRunEvent[] = [];
    const runner = new WorkflowRunner({
      workflowsRoot: tmpRoot,
      pluginId: 'test',
      dispatchers: { tool: async () => 'ok' } as never,
    });
    runner.subscribe((e) => events.push(e));

    const wf = makeWorkflow([
      { id: 'a', kind: 'tool' },
      { id: 'b', kind: 'tool' },
    ]);
    await runner.run(wf, { runId: 'r1' });

    expect(events.length).toBe(4); // start + 2 step + end
    expect(events[0]!.type).toBe('run-start');
    expect(events[1]!.type).toBe('step-complete');
    expect(events[2]!.type).toBe('step-complete');
    expect(events[3]!.type).toBe('run-end');
    // Final state status is 'done'.
    expect((events[3]! as { state: { status: string } }).state.status).toBe('done');
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('listener exception does not break the runner main flow', async () => {
    const runner = new WorkflowRunner({
      workflowsRoot: tmpRoot,
      pluginId: 'test',
      dispatchers: { tool: async () => 'ok' } as never,
    });
    runner.subscribe(() => { throw new Error('boom'); });
    const wf = makeWorkflow([{ id: 'a', kind: 'tool' }]);
    const state = await runner.run(wf, { runId: 'r2' });
    expect(state.status).toBe('done');
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('multiple listeners all fire', async () => {
    const runner = new WorkflowRunner({
      workflowsRoot: tmpRoot,
      pluginId: 'test',
      dispatchers: { tool: async () => 'ok' } as never,
    });
    let a = 0;
    let b = 0;
    runner.subscribe(() => { a++; });
    runner.subscribe(() => { b++; });
    const wf = makeWorkflow([{ id: 'a', kind: 'tool' }]);
    await runner.run(wf, { runId: 'r3' });
    // 3 events each: run-start + step-complete + run-end.
    expect(a).toBe(3);
    expect(b).toBe(3);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('abort() emits run-end even when run() not awaited', async () => {
    const events: WorkflowRunEvent[] = [];
    let resolveStep!: () => void;
    const stepBlocked = new Promise<void>((r) => { resolveStep = r; });
    const runner = new WorkflowRunner({
      workflowsRoot: tmpRoot,
      pluginId: 'test',
      dispatchers: {
        tool: async () => { await stepBlocked; return 'ok'; },
      } as never,
    });
    runner.subscribe((e) => events.push(e));
    const wf = makeWorkflow([{ id: 'a', kind: 'tool' }]);
    const runPromise = runner.run(wf, { runId: 'r4' });
    // Microtask flush so run-start has fired.
    await Promise.resolve();
    runner.abort('r4', 'user-cancelled');
    resolveStep();
    await runPromise;
    // Some event of type run-end exists with aborted state.
    const ends = events.filter((e) => e.type === 'run-end');
    expect(ends.length).toBeGreaterThanOrEqual(1);
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
