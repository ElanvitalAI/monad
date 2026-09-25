// NEXUS · trigger lifecycle ↔ NexusEventBus bridge
// (Surface-unification v2 · 2026-05-11)
//
// The workflow-runtime daemon manages trigger source subscriptions
// (schedule / webhook / discord / telegram). Each subscribe / unsubscribe
// / fire feeds through this bridge so SSE subscribers (PWA
// ActiveTriggersPanel) react without polling.
//
// Companion of `workflow-run-event-bridge.ts` — same module-singleton
// pattern, same null-tolerant publish so unit tests stay clean.

import type { NexusEventBus } from './event-bus.js';
import type { TriggerEmitResult } from '../../workflow-runtime/triggers/source.js';

export type TriggerVariant = 'schedule' | 'webhook' | 'discord' | 'telegram' | 'manual' | 'chat';

let triggerEventBus: NexusEventBus | null = null;

/** Wire the bus that publishes trigger lifecycle events. Pass `null` to
 *  clear. Called once during NEXUS boot. */
export function setTriggerEventBus(bus: NexusEventBus | null): void {
  triggerEventBus = bus;
}

/** Fire `trigger.subscribed` (daemon attached a trigger source for a
 *  specific node). Detail: `{workflowName, nodeId, variant}`. */
export function publishTriggerSubscribed(info: {
  workflowName: string;
  nodeId: string;
  variant: TriggerVariant;
}): void {
  if (!triggerEventBus) return;
  try {
    triggerEventBus.publish({
      ts: Date.now(),
      kind: 'trigger.subscribed',
      detail: { ...info },
    });
  } catch { /* swallow — bus already eats listener throws */ }
}

/** Fire `trigger.unsubscribed`. */
export function publishTriggerUnsubscribed(info: {
  workflowName: string;
  nodeId: string;
  variant: TriggerVariant;
}): void {
  if (!triggerEventBus) return;
  try {
    triggerEventBus.publish({
      ts: Date.now(),
      kind: 'trigger.unsubscribed',
      detail: { ...info },
    });
  } catch { /* swallow */ }
}

/** Fire `trigger.fired` — daemon dispatched the trigger and got back a
 *  result (success → runId, failure → error). */
export function publishTriggerFired(info: {
  workflowName: string;
  nodeId: string;
  variant: TriggerVariant;
  result: TriggerEmitResult;
}): void {
  if (!triggerEventBus) return;
  const detail: Record<string, unknown> = {
    workflowName: info.workflowName,
    nodeId: info.nodeId,
    variant: info.variant,
    ok: info.result.ok,
  };
  if (info.result.ok && info.result.runId) detail.runId = info.result.runId;
  if (!info.result.ok && info.result.error) detail.error = info.result.error;
  try {
    triggerEventBus.publish({ ts: Date.now(), kind: 'trigger.fired', detail });
  } catch { /* swallow */ }
}
