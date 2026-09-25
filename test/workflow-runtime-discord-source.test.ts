// Scheduler-retirement R6 (2026-05-11) — Discord trigger source tests.

import { describe, expect, test } from 'bun:test';
import { createDiscordSource } from '../src/workflow-runtime/triggers/discord-source';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

const stubDeps: WorkflowDeps = {} as WorkflowDeps;

function wf(name: string, discord: Record<string, unknown>): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'trigger', discordTrigger: discord }],
    },
  } as unknown as WorkflowEntry;
}

describe('createDiscordSource', () => {
  test('dispatch before start returns empty (closed)', async () => {
    const src = createDiscordSource();
    const r = await src.dispatch({ kind: 'message', channel: 'ops', user: 'alice', body: 'hi' });
    expect(r).toEqual([]);
  });

  test('matches kind + channel + user + pattern', async () => {
    const src = createDiscordSource();
    let received: unknown = null;
    src.subscribe(
      wf('w1', { kind: 'message', channel: 'ops', user: 'alice', pattern: '^배포' }),
      async (workflowName, nodeId, payload) => {
        received = { workflowName, nodeId, payload };
        return { ok: true, runId: 'r1' };
      },
    );
    await src.start();

    // miss — wrong kind
    expect((await src.dispatch({ kind: 'reaction', channel: 'ops', user: 'alice', body: '배포 now' })).length).toBe(0);
    // miss — wrong channel
    expect((await src.dispatch({ kind: 'message', channel: 'general', user: 'alice', body: '배포 now' })).length).toBe(0);
    // miss — wrong user
    expect((await src.dispatch({ kind: 'message', channel: 'ops', user: 'bob', body: '배포 now' })).length).toBe(0);
    // miss — pattern doesn't match
    expect((await src.dispatch({ kind: 'message', channel: 'ops', user: 'alice', body: 'hello world' })).length).toBe(0);

    // hit
    const ok = await src.dispatch({ kind: 'message', channel: 'ops', user: 'alice', body: '배포 now' });
    expect(ok.length).toBe(1);
    expect(ok[0]).toEqual({ workflowName: 'w1', nodeId: 'trigger', ok: true });
    expect(received).toBeTruthy();
    await src.stop();
  });

  test('wildcard channel/user matches anything', async () => {
    const src = createDiscordSource();
    src.subscribe(
      wf('w2', { kind: 'message', channel: '*', user: '*' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    const r1 = await src.dispatch({ kind: 'message', channel: 'x', user: 'y', body: 'anything' });
    const r2 = await src.dispatch({ kind: 'message', channel: 'z', user: 'q', body: 'whatever' });
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(1);
    await src.stop();
  });

  test('bad regex pattern fails closed (no match)', async () => {
    const src = createDiscordSource();
    src.subscribe(
      wf('w3', { kind: 'message', pattern: '(((bad regex' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    const r = await src.dispatch({ kind: 'message', channel: 'ops', user: 'alice', body: 'anything' });
    expect(r.length).toBe(0);
    await src.stop();
  });

  test('subscriptions() surfaces summary', async () => {
    const src = createDiscordSource();
    src.subscribe(
      wf('w4', { kind: 'reaction', channel: 'ops' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    expect(src.subscriptions()).toEqual([
      {
        kind: 'discord',
        workflowName: 'w4',
        nodeId: 'trigger',
        summary: 'discord:reaction channel=ops',
      },
    ]);
  });

  test('stop() releases bindings', async () => {
    const src = createDiscordSource();
    src.subscribe(wf('w5', { kind: 'message' }), async () => ({ ok: true, runId: 'r' }));
    await src.start();
    await src.stop();
    expect(src.subscriptions()).toEqual([]);
  });
});

describe('daemon.dispatchDiscord', () => {
  test('routes through workflow daemon end-to-end', async () => {
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wf('w6', { kind: 'message', channel: 'ops', pattern: '^deploy' })],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
    });
    await daemon.start();
    const r = await daemon.dispatchDiscord({
      kind: 'message',
      channel: 'ops',
      user: 'alice',
      body: 'deploy production',
    });
    expect(r.length).toBe(1);
    expect(r[0].ok).toBe(true);
    expect(runs).toEqual(['w6']);
    await daemon.stop();
  });
});
