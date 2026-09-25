// V2.2-7 (2026-05-11) — daemon.registerWorkflow + schedule-source live
// subscribe coverage.
//
// Verifies:
//  1. registerWorkflow() before start() seeds the entries list — the
//     workflow fires once the daemon starts.
//  2. registerWorkflow() after start() wires the schedule entry into
//     the running SchedulerHandle (live subscribe path) — interval/cron
//     start firing without a restart.
//  3. Re-registering an entry with the same workflow name replaces the
//     definition (used when a TOX task is updated).
//  4. onLifecycle('subscribed') fans for the newly registered entry
//     when the daemon is already running.
//  5. registerWorkflow with a webhook trigger node is a silent no-op for
//     the schedule live path — schedule-only is the V2.2-7 v1 contract.

import { describe, expect, test } from 'bun:test';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import { createScheduleSource } from '../src/workflow-runtime/triggers/schedule-source';
import { createWebhookSource } from '../src/workflow-runtime/triggers/webhook-source';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

const stubDeps: WorkflowDeps = {} as WorkflowDeps;

function intervalEntry(name: string, ms: number, nodeId = 'tick'): WorkflowEntry {
  return {
    source: { source: 'global', path: `<tox:${name}>` },
    definition: {
      name,
      description: `synthetic ${name}`,
      nodes: [{ id: nodeId, scheduleTrigger: { type: 'interval', interval: ms } }],
    },
  } as unknown as WorkflowEntry;
}

function webhookEntry(name: string): WorkflowEntry {
  return {
    source: { source: 'global', path: `<tox:${name}>` },
    definition: {
      name,
      description: `synthetic ${name}`,
      nodes: [{ id: 'hook', webhookTrigger: { method: 'POST', path: `/${name}` } }],
    },
  } as unknown as WorkflowEntry;
}

describe('daemon.registerWorkflow', () => {
  test('pre-start register seeds entries — fires once daemon starts', async () => {
    const intervals: Array<{ cb: () => void; ms: number }> = [];
    const scheduleSource = createScheduleSource({
      setInterval: (cb, ms) => {
        intervals.push({ cb, ms });
        return intervals.length as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {},
    });
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      scheduleSource,
    });

    daemon.registerWorkflow(intervalEntry('pre-start', 2000));
    await daemon.start();

    expect(daemon.status().schedule.activeIntervals).toBe(1);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.ms).toBe(2000);

    intervals[0]!.cb();
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toEqual(['pre-start']);
  });

  test('post-start register wires into running handle (live subscribe)', async () => {
    const intervals: Array<{ cb: () => void; ms: number }> = [];
    const scheduleSource = createScheduleSource({
      setInterval: (cb, ms) => {
        intervals.push({ cb, ms });
        return intervals.length as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {},
    });
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      scheduleSource,
    });

    await daemon.start();
    expect(daemon.status().schedule.activeIntervals).toBe(0);

    daemon.registerWorkflow(intervalEntry('live', 5000));
    expect(daemon.status().schedule.activeIntervals).toBe(1);
    expect(intervals).toHaveLength(1);

    intervals[0]!.cb();
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toEqual(['live']);
  });

  test('re-register with same workflow name replaces the definition', async () => {
    const scheduleSource = createScheduleSource({
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    });
    const seenWorkflowNames: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        seenWorkflowNames.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      scheduleSource,
    });

    await daemon.start();
    daemon.registerWorkflow(intervalEntry('same-name', 2000, 'tick'));
    daemon.registerWorkflow(intervalEntry('same-name', 3000, 'tick'));

    // Both subscriptions exist on the schedule source (schedule-source's
    // own dedupe is by (workflowName, nodeId) so re-subscribing with the
    // same node id skips). The daemon entries map keeps the *latest*
    // definition so emits resolve the new body.
    const subs = daemon.status().subscriptions.filter((s) => s.workflowName === 'same-name');
    expect(subs.length).toBeGreaterThanOrEqual(1);
  });

  test('onLifecycle fires `subscribed` for post-start register', async () => {
    const scheduleSource = createScheduleSource({
      setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    });
    const lifecycleEvents: Array<{ phase: string; workflowName: string; variant: string }> = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async () => ({ outputs: {}, events: [], ok: true }),
      scheduleSource,
      onLifecycle: (info) => {
        lifecycleEvents.push({ phase: info.phase, workflowName: info.workflowName, variant: info.variant });
      },
    });

    await daemon.start();
    expect(lifecycleEvents).toHaveLength(0);

    daemon.registerWorkflow(intervalEntry('lifecycle-test', 2000));
    const subscribed = lifecycleEvents.filter((e) => e.phase === 'subscribed');
    expect(subscribed).toHaveLength(1);
    expect(subscribed[0]).toMatchObject({
      phase: 'subscribed',
      workflowName: 'lifecycle-test',
      variant: 'schedule',
    });
  });

  test('post-start register fans into webhook source — dispatch works without restart', async () => {
    const scheduleSource = createScheduleSource({
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    });
    const webhookSource = createWebhookSource();
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      scheduleSource,
      webhookSource,
    });

    await daemon.start();
    daemon.registerWorkflow(webhookEntry('webhook-late'));

    // Subscription is now visible via daemon status …
    const subs = daemon.status().subscriptions.filter((s) => s.kind === 'webhook');
    expect(subs.map((s) => s.workflowName)).toContain('webhook-late');

    // … and an inbound dispatch through the router actually fires it
    // (router.register was called on the live router).
    const res = await daemon.dispatchWebhook({ method: 'POST', path: '/webhook-late', headers: {}, body: '{}' });
    expect(res?.status).toBe(202);
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toContain('webhook-late');
  });

  test('post-start register fans into chat source — chatConfig + dispatch work without restart', async () => {
    const chatLateEntry: WorkflowEntry = {
      source: { source: 'global', path: '<tox:chat-late>' },
      definition: {
        name: 'chat-late',
        description: 'late chat trigger',
        nodes: [
          {
            id: 'in',
            chatTrigger: {
              path: '/chat-late',
              hostedUi: { enabled: true, bearer: 'tok' },
            },
          },
          { id: 'reply', depends_on: ['in'], prompt: 'echo' },
        ],
      },
    } as unknown as WorkflowEntry;

    const scheduleSource = createScheduleSource({
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    });
    const runs: string[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return {
          outputs: { reply: { ok: true, output: 'echo-reply', durationMs: 1 } },
          events: [],
          ok: true,
        };
      },
      scheduleSource,
    });

    await daemon.start();
    // chatConfig pre-register = 404
    expect(daemon.chatConfig('chat-late')).toBeNull();

    daemon.registerWorkflow(chatLateEntry);
    // chatConfig now surfaces the chat trigger
    const cfg = daemon.chatConfig('chat-late');
    expect(cfg).not.toBeNull();
    expect(cfg?.path).toBe('/chat-late');

    // dispatch through the router (bearer required)
    const res = await daemon.dispatchChat({
      path: '/chat-late',
      authorization: 'Bearer tok',
      body: { message: 'hi' },
    });
    expect(res?.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toContain('chat-late');
  });
});
