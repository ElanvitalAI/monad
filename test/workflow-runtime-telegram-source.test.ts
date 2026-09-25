// Scheduler-retirement R7 (2026-05-11) — Telegram trigger source tests.

import { describe, expect, test } from 'bun:test';
import { createTelegramSource } from '../src/workflow-runtime/triggers/telegram-source';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

const stubDeps: WorkflowDeps = {} as WorkflowDeps;

function wf(name: string, telegram: Record<string, unknown>): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'trigger', telegramTrigger: telegram }],
    },
  } as unknown as WorkflowEntry;
}

describe('createTelegramSource', () => {
  test('dispatch before start returns empty', async () => {
    const src = createTelegramSource();
    const r = await src.dispatch({ kind: 'message', chat: 'g', user: 'u', body: 'hi' });
    expect(r).toEqual([]);
  });

  test('matches kind + chat + user + pattern', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w1', { kind: 'message', chat: '@ops', user: 'alice', pattern: '^summary' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    expect((await src.dispatch({ kind: 'message', chat: '@other', user: 'alice', body: 'summary now' })).length).toBe(0);
    expect((await src.dispatch({ kind: 'message', chat: '@ops', user: 'bob', body: 'summary now' })).length).toBe(0);
    expect((await src.dispatch({ kind: 'message', chat: '@ops', user: 'alice', body: 'hello' })).length).toBe(0);
    const ok = await src.dispatch({ kind: 'message', chat: '@ops', user: 'alice', body: 'summary now' });
    expect(ok.length).toBe(1);
    expect(ok[0]).toEqual({ workflowName: 'w1', nodeId: 'trigger', ok: true });
    await src.stop();
  });

  test('command kind matches command name (not body)', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w2', { kind: 'command', command: 'summary' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    expect((await src.dispatch({
      kind: 'command', chat: '@x', user: 'u', body: 'today', command: 'help',
    })).length).toBe(0);
    expect((await src.dispatch({
      kind: 'command', chat: '@x', user: 'u', body: 'today', command: 'summary',
    })).length).toBe(1);
    await src.stop();
  });

  test('callback_query routes through with body=callback_data', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w3', { kind: 'callback_query', pattern: '^action:' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    const r = await src.dispatch({
      kind: 'callback_query', chat: '@x', user: 'u', body: 'action:approve',
    });
    expect(r.length).toBe(1);
    await src.stop();
  });

  test('wildcard chat/user matches anything', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w4', { kind: 'message', chat: '*', user: '*' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    expect((await src.dispatch({ kind: 'message', chat: 'x', user: 'y', body: 'a' })).length).toBe(1);
    expect((await src.dispatch({ kind: 'message', chat: 'z', user: 'q', body: 'b' })).length).toBe(1);
    await src.stop();
  });

  test('subscriptions() surfaces summary with /command prefix', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w5', { kind: 'command', chat: '@x', command: 'build' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    expect(src.subscriptions()).toEqual([
      {
        kind: 'telegram',
        workflowName: 'w5',
        nodeId: 'trigger',
        summary: 'telegram:command chat=@x command=/build',
      },
    ]);
  });

  test('bad regex pattern fails closed', async () => {
    const src = createTelegramSource();
    src.subscribe(
      wf('w6', { kind: 'message', pattern: '(((bad' }),
      async () => ({ ok: true, runId: 'r' }),
    );
    await src.start();
    const r = await src.dispatch({ kind: 'message', chat: '@x', user: 'u', body: 'anything' });
    expect(r.length).toBe(0);
    await src.stop();
  });
});

describe('daemon.dispatchTelegram', () => {
  test('end-to-end command → workflow run', async () => {
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wf('w7', { kind: 'command', command: 'summary' })],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
    });
    await daemon.start();
    const r = await daemon.dispatchTelegram({
      kind: 'command', chat: '@x', user: 'alice', body: '', command: 'summary',
    });
    expect(r.length).toBe(1);
    expect(r[0].ok).toBe(true);
    expect(runs).toEqual(['w7']);
    await daemon.stop();
  });
});
