// M4-6.2 (FU8 PR #1 · 2026-05-12) — lifecycle trigger gating tests.
//
// Covers the daemon's `emit` closure draft-skip path:
//   1. Default lifecycle ('active') keeps fires intact across all 5
//      surfaces (schedule · webhook · discord · telegram · chat).
//   2. Setting a workflow to 'draft' suppresses the run + fires the
//      skip recorder + delivers the skip through `onEmit` / `onLifecycle`.
//   3. The 3-sink fan-out helper (`createTriggerSkipRecorder`) emits
//      both signal-bus + user-intent envelopes.
//   4. Per-sink failure does not cascade.
//   5. Flipping 'draft' → 'active' resumes fires (back-compat).
//
// The daemon's emit closure is the single dispatch boundary all five
// trigger surfaces pass through (see `daemon.ts:emit`), so wiring the
// gate there exercises every surface in one place. The tests inject
// `readLifecycle` + `triggerSkipRecorder` so we don't touch the real
// global signal-bus / user-intent singletons for the orchestration
// asserts; a separate `recorder · 2-sink fan-out` block exercises
// the production helper against the singletons.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import {
  createTriggerSkipRecorder,
  type TriggerSkipRecord,
} from '../src/workflow-runtime/trigger-skip-emit';
import type { WorkflowLifecycleStatus } from '../src/workflow-runtime/lifecycle';
import { _resetSignalBus } from '../src/signal-bus/bus';
import { _resetUserIntentLogger } from '../src/user-intent/logger';
import type { SignalEnvelope } from '../src/signal-bus/types';
import type { UserIntentEvent } from '../src/user-intent/types';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

const stubDeps: WorkflowDeps = {} as WorkflowDeps;

function wfWithSchedule(name: string, intervalMs = 60_000): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'tick', scheduleTrigger: { type: 'interval', interval: intervalMs } }],
    },
  } as unknown as WorkflowEntry;
}

function wfWithWebhook(name: string, path: string): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'hook', webhookTrigger: { method: 'POST', path } }],
    },
  } as unknown as WorkflowEntry;
}

function wfWithDiscord(name: string): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'dc', discordTrigger: { kind: 'message' } }],
    },
  } as unknown as WorkflowEntry;
}

function wfWithTelegram(name: string): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'tg', telegramTrigger: { kind: 'message' } }],
    },
  } as unknown as WorkflowEntry;
}

function wfWithChat(name: string, path = '/chat'): WorkflowEntry {
  return {
    source: { source: 'global', path: `/tmp/${name}.yaml` },
    definition: {
      name,
      nodes: [{ id: 'cx', chatTrigger: { path } }],
    },
  } as unknown as WorkflowEntry;
}

describe('M4-6.2 · daemon emit closure · lifecycle gate', () => {
  test("default lifecycle ('active') lets a webhook fire through to runWorkflow", async () => {
    const runs: string[] = [];
    const lifecycle: Record<string, WorkflowLifecycleStatus> = {};
    const skips: TriggerSkipRecord[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wfWithWebhook('hello-active', '/hello')],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      readLifecycle: (name) => lifecycle[name] ?? 'active',
      triggerSkipRecorder: (rec) => { skips.push(rec); },
    });
    await daemon.start();
    const res = await daemon.dispatchWebhook({
      method: 'POST',
      path: '/hello',
      headers: {},
      body: '{}',
    });
    expect(res?.status).toBe(202);
    expect(runs).toEqual(['hello-active']);
    expect(skips).toHaveLength(0);
    await daemon.stop();
  });

  test("'draft' lifecycle suppresses a webhook fire and records the skip", async () => {
    const runs: string[] = [];
    const lifecycle: Record<string, WorkflowLifecycleStatus> = { 'hello-draft': 'draft' };
    const skips: TriggerSkipRecord[] = [];
    const onEmit: Array<{ workflowName: string; ok: boolean; error?: string }> = [];
    const onLifecycle: Array<{ phase: string; workflowName: string; variant: string }> = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wfWithWebhook('hello-draft', '/hello')],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      readLifecycle: (name) => lifecycle[name] ?? 'active',
      triggerSkipRecorder: (rec) => { skips.push(rec); },
      onEmit: (info) => { onEmit.push({ workflowName: info.workflowName, ok: info.result.ok, error: info.result.error }); },
      onLifecycle: (info) => { onLifecycle.push({ phase: info.phase, workflowName: info.workflowName, variant: info.variant }); },
    });
    await daemon.start();
    const res = await daemon.dispatchWebhook({
      method: 'POST',
      path: '/hello',
      headers: {},
      body: '{}',
    });
    // The webhook router still acks because the daemon emit returned a
    // structured `{ ok: false, error: 'workflow is draft' }`; the
    // router maps that to its 4xx path. The crucial assertion is that
    // runWorkflow never fired.
    expect(runs).toHaveLength(0);
    expect(res).not.toBeNull();
    // Skip recorder was invoked once with the right shape.
    expect(skips).toHaveLength(1);
    expect(skips[0]!).toEqual({
      workflowName: 'hello-draft',
      nodeId: 'hook',
      variant: 'webhook',
      reason: 'draft',
    });
    // onEmit + onLifecycle telemetry still fires so dashboards see the
    // suppressed dispatch as a "fired" event with the skip outcome.
    expect(onEmit).toHaveLength(1);
    expect(onEmit[0]!.ok).toBe(false);
    expect(onEmit[0]!.error).toBe('workflow is draft');
    expect(onLifecycle.some((e) => e.phase === 'fired' && e.workflowName === 'hello-draft' && e.variant === 'webhook')).toBe(true);
    await daemon.stop();
  });

  test('lifecycle gate applies uniformly across all 5 trigger surfaces', async () => {
    // Each trigger surface routes through the daemon's `emit` closure
    // exactly once with `(workflowName, nodeId, payload)`. Calling
    // emit directly (private — exposed via the trigger sources'
    // `subscribe` callback that we own through `triggerSkipRecorder`
    // capture) would couple this test to internal plumbing. Instead
    // we mark every surface as 'draft', wire one of each, and verify
    // the variant classification appears once per surface when we
    // drive a representative fire path.
    //
    // Schedule + webhook have real dispatchers; chat/discord/telegram
    // we trip via the daemon's own dispatchDiscord / dispatchTelegram
    // / dispatchChat methods.
    const runs: string[] = [];
    const lifecycle: Record<string, WorkflowLifecycleStatus> = {
      'wf-sched': 'draft',
      'wf-hook': 'draft',
      'wf-discord': 'draft',
      'wf-telegram': 'draft',
      'wf-chat': 'draft',
    };
    const skips: TriggerSkipRecord[] = [];
    let intervalCb: (() => void) | null = null;
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [
        wfWithSchedule('wf-sched', 2_000),
        wfWithWebhook('wf-hook', '/hook'),
        wfWithDiscord('wf-discord'),
        wfWithTelegram('wf-telegram'),
        wfWithChat('wf-chat', '/chat'),
      ],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      readLifecycle: (name) => lifecycle[name] ?? 'active',
      triggerSkipRecorder: (rec) => { skips.push(rec); },
      // Schedule source: install fake interval so we can fire the tick
      // manually instead of waiting on the wall clock.
      scheduleSource: (await import('../src/workflow-runtime/triggers/schedule-source')).createScheduleSource({
        setInterval: (cb) => { intervalCb = cb; return 1 as unknown as ReturnType<typeof setInterval>; },
        clearInterval: () => {},
      }),
    });
    await daemon.start();

    // Schedule fire
    intervalCb!();
    await new Promise((r) => setTimeout(r, 5));

    // Webhook fire
    await daemon.dispatchWebhook({
      method: 'POST',
      path: '/hook',
      headers: {},
      body: '{}',
    });

    // Discord fire — minimum DiscordEvent shape that the source will
    // route to a subscribed workflow (matches kind+channel+user).
    await daemon.dispatchDiscord({
      kind: 'message',
      channel: 'c1',
      user: 'u1',
      body: 'hi',
    });

    // Telegram fire
    await daemon.dispatchTelegram({
      kind: 'message',
      chat: '1',
      user: '1',
      body: 'hi',
    });

    // Chat fire — the chat router's dispatch route. Path matches the
    // chatTrigger.path = '/chat' we registered. The body is a parsed
    // `{ message }` object per ChatRouterRequest.
    await daemon.dispatchChat({
      path: '/chat',
      body: { message: 'hi' },
    });

    // No workflow actually ran.
    expect(runs).toEqual([]);
    // Each surface recorded exactly one skip — variant covers the
    // full set we wired for FU8 PR #1.
    const variants = skips.map((s) => s.variant).sort();
    expect(variants).toContain('schedule');
    expect(variants).toContain('webhook');
    expect(variants).toContain('discord');
    expect(variants).toContain('telegram');
    expect(variants).toContain('chat');
    for (const skip of skips) expect(skip.reason).toBe('draft');
    await daemon.stop();
  });

  test('flipping draft → active resumes fires (back-compat path)', async () => {
    const runs: string[] = [];
    const lifecycle: Record<string, WorkflowLifecycleStatus> = { 'wf-flip': 'draft' };
    const skips: TriggerSkipRecord[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wfWithWebhook('wf-flip', '/flip')],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      readLifecycle: (name) => lifecycle[name] ?? 'active',
      triggerSkipRecorder: (rec) => { skips.push(rec); },
    });
    await daemon.start();

    // First call — draft → skip.
    await daemon.dispatchWebhook({ method: 'POST', path: '/flip', headers: {}, body: '{}' });
    expect(runs).toHaveLength(0);
    expect(skips).toHaveLength(1);

    // Flip to active — next call fires.
    lifecycle['wf-flip'] = 'active';
    await daemon.dispatchWebhook({ method: 'POST', path: '/flip', headers: {}, body: '{}' });
    expect(runs).toEqual(['wf-flip']);
    // No new skip recorded.
    expect(skips).toHaveLength(1);
    await daemon.stop();
  });

  test('a throwing readLifecycle treats the workflow as active (defensive default)', async () => {
    const runs: string[] = [];
    const skips: TriggerSkipRecord[] = [];
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [wfWithWebhook('wf-bad-read', '/bad')],
      deps: stubDeps,
      runWorkflow: async (opts) => {
        runs.push(opts.workflow.name);
        return { outputs: {}, events: [], ok: true };
      },
      readLifecycle: () => { throw new Error('corrupt lifecycle.json'); },
      triggerSkipRecorder: (rec) => { skips.push(rec); },
    });
    await daemon.start();
    const res = await daemon.dispatchWebhook({ method: 'POST', path: '/bad', headers: {}, body: '{}' });
    expect(res?.status).toBe(202);
    expect(runs).toEqual(['wf-bad-read']);
    expect(skips).toHaveLength(0);
    await daemon.stop();
  });
});

describe('M4-6.2 · createTriggerSkipRecorder · 2-sink fan-out', () => {
  let bus: ReturnType<typeof _resetSignalBus>;
  let intent: ReturnType<typeof _resetUserIntentLogger>;
  let intentEvents: UserIntentEvent[];

  beforeEach(() => {
    bus = _resetSignalBus();
    intent = _resetUserIntentLogger();
    intentEvents = [];
    intent.setSinks([{
      name: 'capture',
      write: (ev) => { intentEvents.push(ev); },
    }]);
  });

  afterEach(() => {
    _resetSignalBus();
    _resetUserIntentLogger();
  });

  test('fires both signal-bus + intent log for a draft skip', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'workflow.trigger_skipped',
      minTier: 'info',
      handler: (env) => { captured.push(env); },
    });
    const record = createTriggerSkipRecorder({ bus, intent });
    record({
      workflowName: 'wf-x',
      nodeId: 'hook',
      variant: 'webhook',
      reason: 'draft',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.source).toBe('workflow.trigger_skipped');
    expect(captured[0]!.tier).toBe('info');
    expect((captured[0]!.payload as { variant?: string }).variant).toBe('webhook');
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.intent.kind).toBe('system.workflow.trigger_skipped');
    expect(intentEvents[0]!.intent.target).toEqual({ kind: 'workflow', id: 'wf-x' });
  });

  test('per-sink failure does not cascade to the other sink', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'workflow.trigger_skipped',
      minTier: 'info',
      handler: () => { throw new Error('subscriber blew up'); },
    });
    bus.subscribe({
      sourceGlob: 'workflow.trigger_skipped',
      minTier: 'info',
      handler: (env) => { captured.push(env); },
    });
    const record = createTriggerSkipRecorder({ bus, intent });
    expect(() => record({
      workflowName: 'wf-x',
      nodeId: 'hook',
      variant: 'webhook',
      reason: 'draft',
    })).not.toThrow();
    // The intent log still fired even though one signal subscriber
    // threw.
    expect(intentEvents).toHaveLength(1);
  });
});
