// Surface-unification ROADMAP §E1 (2026-05-11) — trigger snapshot
// endpoint tests. Drives the PWA Active-triggers panel (E2).

import { describe, expect, it } from 'bun:test';
import { buildTriggerSnapshot } from '../src/nexus/api/triggers';
import type { WorkflowEntry } from '../src/workflow-runtime/types';

function wf(name: string, nodes: Array<Record<string, unknown>>): WorkflowEntry {
  return ({
    source: { kind: 'project', source: `${name}.yaml`, path: `${name}.yaml` },
    definition: { name, description: name, nodes },
  } as unknown) as WorkflowEntry;
}

describe('buildTriggerSnapshot', () => {
  it('returns empty inventory for no workflows', () => {
    expect(buildTriggerSnapshot([])).toEqual({ triggers: [], workflowsScanned: 0 });
  });

  it('collects schedule + webhook + discord + telegram + manual + chat', () => {
    const workflows = [
      wf('multi', [
        { id: 'sched', scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } },
        { id: 'hook', webhookTrigger: { method: 'POST', path: '/h' } },
        { id: 'disc', discordTrigger: { kind: 'message' } },
        { id: 'tg', telegramTrigger: { kind: 'message' } },
        { id: 'man', manualTrigger: {} },
        { id: 'chat', chatTrigger: { path: '/chat' } },
        { id: 'work', bash: 'echo hi' },
      ]),
    ];
    const snap = buildTriggerSnapshot(workflows);
    expect(snap.workflowsScanned).toBe(1);
    expect(snap.triggers).toHaveLength(6);
    const variants = snap.triggers.map((t) => t.variant).sort();
    expect(variants).toEqual(['chat', 'discord', 'manual', 'schedule', 'telegram', 'webhook']);
  });

  it('preserves workflowName + nodeId for click-through', () => {
    const workflows = [
      wf('a', [{ id: 'tick', scheduleTrigger: { type: 'interval', interval: 60000 } }]),
      wf('b', [{ id: 'hook', webhookTrigger: { method: 'GET', path: '/p' } }]),
    ];
    const snap = buildTriggerSnapshot(workflows);
    expect(snap.triggers.find((t) => t.variant === 'schedule')).toMatchObject({
      workflowName: 'a',
      nodeId: 'tick',
    });
    expect(snap.triggers.find((t) => t.variant === 'webhook')).toMatchObject({
      workflowName: 'b',
      nodeId: 'hook',
    });
  });

  it('includes the variant payload verbatim (so PWA can render preview)', () => {
    const workflows = [
      wf('p', [
        { id: 't1', scheduleTrigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Asia/Seoul' } },
      ]),
    ];
    const snap = buildTriggerSnapshot(workflows);
    expect(snap.triggers[0]?.payload).toEqual({
      type: 'cron',
      cron: '0 9 * * *',
      timezone: 'Asia/Seoul',
    });
  });

  it('ignores non-trigger variants', () => {
    const workflows = [
      wf('plain', [
        { id: 'a', bash: 'echo' },
        { id: 'b', prompt: 'hi' },
        { id: 'c', http: { method: 'GET', url: 'https://x' } },
      ]),
    ];
    expect(buildTriggerSnapshot(workflows).triggers).toHaveLength(0);
  });
});
