// Surface-unification v2.1 (2026-05-11) — chat trigger returns the
// workflow's last-node output (not a "ack: <msg>" placeholder).
//
// Integration smoke: daemon's emit closure captures
// `runResult.outputs[lastDeclaredNodeId]?.output` and pipes it through
// TriggerEmitResult.output → chat-source's runWorkflow callback →
// chat-router 200 body. Webhook + discord + telegram dispatch flows
// stay fire-and-forget (their `output` field is undefined).

import { describe, expect, it } from 'bun:test';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import type { NodeOutput, WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

function wf(name: string, nodes: Array<Record<string, unknown>>): WorkflowEntry {
  return ({
    source: { kind: 'project', source: `${name}.yaml`, path: `${name}.yaml` },
    definition: { name, description: name, nodes },
  } as unknown) as WorkflowEntry;
}

const deps = {} as WorkflowDeps;

describe('daemon emit pipes last-node output to chat trigger', () => {
  it('returns the last node\'s output string on success', async () => {
    const workflow = wf('chat-echo', [
      { id: 'in', chatTrigger: { path: '/echo' } },
      { id: 'reply', bash: 'echo unused' },
    ]);

    // Stub the runner so we control the outputs map without spawning
    // a real bash node.
    const fakeRun = (async (opts) => ({
      outputs: {
        in: { ok: true, output: { kind: 'chat' }, durationMs: 1 } as NodeOutput,
        reply: { ok: true, output: 'hello from the workflow', durationMs: 5 } as NodeOutput,
      },
      events: [],
      ok: true,
    })) as never;

    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps,
      runWorkflow: fakeRun,
    });
    await daemon.start();
    const res = await daemon.dispatchChat({
      path: '/echo',
      body: { message: 'hi' },
    });
    await daemon.stop();

    expect(res?.status).toBe(200);
    expect(res?.body).toMatchObject({
      ok: true,
      response: 'hello from the workflow',
      workflowName: 'chat-echo',
    });
  });

  it('stringifies non-string outputs (JSON serializable) for the response', async () => {
    const workflow = wf('chat-json', [
      { id: 'in', chatTrigger: { path: '/json' } },
      { id: 'reply', bash: 'echo unused' },
    ]);
    const fakeRun = (async () => ({
      outputs: {
        in: { ok: true, output: {}, durationMs: 1 } as NodeOutput,
        reply: { ok: true, output: { ok: true, value: 42 }, durationMs: 5 } as NodeOutput,
      },
      events: [],
      ok: true,
    })) as never;

    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps,
      runWorkflow: fakeRun,
    });
    await daemon.start();
    const res = await daemon.dispatchChat({ path: '/json', body: { message: 'hi' } });
    await daemon.stop();
    expect(res?.body).toMatchObject({ response: '{"ok":true,"value":42}' });
  });

  it('falls back to "(no response)" when last node produced no output', async () => {
    const workflow = wf('chat-empty', [
      { id: 'in', chatTrigger: { path: '/empty' } },
      { id: 'reply', bash: 'echo unused' },
    ]);
    const fakeRun = (async () => ({
      outputs: {
        in: { ok: true, output: {}, durationMs: 1 } as NodeOutput,
        // reply node missing → no output captured
      },
      events: [],
      ok: true,
    })) as never;

    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps,
      runWorkflow: fakeRun,
    });
    await daemon.start();
    const res = await daemon.dispatchChat({ path: '/empty', body: { message: 'hi' } });
    await daemon.stop();
    expect(res?.status).toBe(200);
    expect(String(res?.body.response)).toContain('no response');
  });

  it('returns 500 + error when workflow run fails', async () => {
    const workflow = wf('chat-fail', [
      { id: 'in', chatTrigger: { path: '/fail' } },
      { id: 'reply', bash: 'echo unused' },
    ]);
    const fakeRun = (async () => ({
      outputs: {},
      events: [],
      ok: false,
    })) as never;

    const daemon = createWorkflowRuntimeDaemon({
      workflows: [workflow],
      deps,
      runWorkflow: fakeRun,
    });
    await daemon.start();
    const res = await daemon.dispatchChat({ path: '/fail', body: { message: 'hi' } });
    await daemon.stop();
    expect(res?.status).toBe(500);
  });
});
