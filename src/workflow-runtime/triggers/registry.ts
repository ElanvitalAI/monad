// Node-catalog v2 (2026-05-11) — trigger registry (pure scanner).
//
// Takes a list of `WorkflowEntry` and returns the trigger nodes
// declared across all of them. The daemon-side scheduler +
// webhook router consume this registry to wire dispatch.
//
// Pure: no I/O, no clock, no side effects. Tests pass a synthetic
// workflow list and assert the registry shape.

import { isScheduleTriggerNode, isWebhookTriggerNode } from '../schema.js';
import type {
  ScheduleTriggerNode,
  WebhookTriggerNode,
  WorkflowEntry,
} from '../types.js';

export interface ScheduleEntry {
  workflowName: string;
  nodeId: string;
  trigger: ScheduleTriggerNode['scheduleTrigger'];
}

export interface WebhookEntry {
  workflowName: string;
  nodeId: string;
  trigger: WebhookTriggerNode['webhookTrigger'];
}

export interface TriggerRegistry {
  schedules: ScheduleEntry[];
  webhooks: WebhookEntry[];
}

/** Pure: scan workflows for scheduleTrigger + webhookTrigger nodes.
 *  Returns a flat registry keyed by `{workflowName, nodeId}` so each
 *  trigger node maps to exactly one entry. */
export function buildTriggerRegistry(workflows: WorkflowEntry[]): TriggerRegistry {
  const schedules: ScheduleEntry[] = [];
  const webhooks: WebhookEntry[] = [];
  for (const wf of workflows) {
    for (const node of wf.definition.nodes ?? []) {
      if (isScheduleTriggerNode(node)) {
        schedules.push({
          workflowName: wf.definition.name,
          nodeId: node.id,
          trigger: node.scheduleTrigger,
        });
      } else if (isWebhookTriggerNode(node)) {
        webhooks.push({
          workflowName: wf.definition.name,
          nodeId: node.id,
          trigger: node.webhookTrigger,
        });
      }
    }
  }
  return { schedules, webhooks };
}

/** Pure: detect collisions where the same `(method, path)` pair is
 *  registered by multiple webhooks. The router cannot wire conflicting
 *  routes, so callers should surface these to the user. */
export function findWebhookCollisions(registry: TriggerRegistry): Array<{
  method: string;
  path: string;
  entries: WebhookEntry[];
}> {
  const byKey = new Map<string, WebhookEntry[]>();
  for (const w of registry.webhooks) {
    const key = `${w.trigger.method} ${w.trigger.path}`;
    const arr = byKey.get(key) ?? [];
    arr.push(w);
    byKey.set(key, arr);
  }
  const collisions: Array<{ method: string; path: string; entries: WebhookEntry[] }> = [];
  for (const [key, entries] of byKey) {
    if (entries.length > 1) {
      const [method, path] = key.split(' ', 2);
      collisions.push({ method, path, entries });
    }
  }
  return collisions;
}
