// Surface-unification ROADMAP §D3 (2026-05-11) — dryRun skips trigger
// nodes (Schedule · Webhook · HTTP · Discord · Telegram · Manual · Chat)
// so the PWA "▶ Run now" button can run the dependent chain straight
// through without waiting for daemon trigger subscriptions to fire.

import { describe, expect, it } from 'bun:test';
import { runWorkflow } from '../src/workflow-runtime/executor';
import type { WorkflowDefinition, WorkflowDeps, WorkflowEvent } from '../src/workflow-runtime/types';

function collectEvents(workflow: WorkflowDefinition, deps: WorkflowDeps, dryRun: boolean): Promise<WorkflowEvent[]> {
  return (async () => {
    const events: WorkflowEvent[] = [];
    for await (const evt of runWorkflow({ workflow, arguments: '', dryRun }, deps)) {
      events.push(evt);
    }
    return events;
  })();
}

const deps = {
  callLLM: async () => 'noop',
  runBash: async () => ({ stdout: 'echo-out', stderr: '', exitCode: 0 }),
  runSkill: async () => 'noop-skill',
} as unknown as WorkflowDeps;

describe('runWorkflow dryRun', () => {
  it('skips every trigger variant with reason="dry-run"', async () => {
    const workflow: WorkflowDefinition = {
      name: 'all-triggers',
      description: 'every variant',
      nodes: [
        { id: 'sched', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } },
        { id: 'hook', webhookTrigger: { method: 'POST', path: '/h' } },
        { id: 'discord', discordTrigger: { kind: 'message' } },
        { id: 'telegram', telegramTrigger: { kind: 'message' } },
        { id: 'manual', manualTrigger: {} },
        { id: 'chat', chatTrigger: { path: '/chat' } },
        { id: 'work', bash: 'echo hello' },
      ],
    };
    const events = await collectEvents(workflow, deps, true);
    const skipped = events
      .filter((e) => e.type === 'node_skipped')
      .map((e) => ({ nodeId: e.nodeId, reason: e.reason }));
    // 6 trigger variants should be skipped (Schedule · Webhook · Discord
    // · Telegram · Manual · Chat). HTTP is not a trigger (it's a node
    // body); the bash 'work' node must still execute.
    expect(skipped).toHaveLength(6);
    for (const s of skipped) expect(s.reason).toBe('dry-run');
    const done = events.find((e) => e.type === 'node_done' && e.nodeId === 'work');
    expect(done).toBeDefined();
  });

  it('non-dry-run path runs every trigger as pass-through (no skip)', async () => {
    const workflow: WorkflowDefinition = {
      name: 'no-dry',
      description: 'baseline',
      nodes: [
        { id: 'sched', scheduleTrigger: { type: 'interval', interval: 60000 } },
        { id: 'manual', manualTrigger: {} },
        { id: 'work', bash: 'echo hi' },
      ],
    };
    const events = await collectEvents(workflow, deps, false);
    const skipped = events.filter((e) => e.type === 'node_skipped');
    expect(skipped).toHaveLength(0);
  });
});
