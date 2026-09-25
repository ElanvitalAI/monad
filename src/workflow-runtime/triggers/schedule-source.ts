// Scheduler retirement R2 — concrete TriggerSource for schedule (cron/interval).
//
// Wraps `buildTriggerRegistry` + `startScheduler` (which already do the
// heavy lifting) behind the generic `TriggerSource` interface so the
// daemon can drive schedule + webhook + (future) discord/telegram
// uniformly.

import { isScheduleTriggerNode } from '../schema.js';
import type { ScheduleTriggerNode, WorkflowEntry } from '../types.js';
import type { ScheduleEntry } from './registry.js';
import { startScheduler, type SchedulerHandle, type SchedulerOpts } from './scheduler.js';
import type { TriggerEmit, TriggerSource, TriggerSubscription } from './source.js';

export interface ScheduleSourceOpts {
  /** Inject for tests. Forwarded to `startScheduler`. */
  setInterval?: SchedulerOpts['setInterval'];
  clearInterval?: SchedulerOpts['clearInterval'];
  cronSchedule?: SchedulerOpts['cronSchedule'];
}

export interface ScheduleSource extends TriggerSource {
  readonly kind: 'schedule';
  /** After `start()`, the underlying scheduler handle (timer counts,
   *  skipped entries). Null before start / after stop. */
  handle(): SchedulerHandle | null;
  /** Subscription snapshot for `daemon.status()`. */
  subscriptions(): TriggerSubscription[];
}

interface Binding {
  entry: WorkflowEntry;
  node: ScheduleTriggerNode;
  scheduleEntry: ScheduleEntry;
  onEmit: TriggerEmit;
}

export function createScheduleSource(opts: ScheduleSourceOpts = {}): ScheduleSource {
  const bindings: Binding[] = [];
  let handle: SchedulerHandle | null = null;
  let started = false;

  return {
    kind: 'schedule',
    handle: () => handle,
    subscribe(entry, onEmit) {
      for (const node of entry.definition.nodes ?? []) {
        if (!isScheduleTriggerNode(node)) continue;
        const scheduleEntry: ScheduleEntry = {
          workflowName: entry.definition.name,
          nodeId: node.id,
          trigger: node.scheduleTrigger,
        };
        if (bindings.some(b => b.scheduleEntry.workflowName === scheduleEntry.workflowName
          && b.scheduleEntry.nodeId === scheduleEntry.nodeId)) {
          continue; // dedupe
        }
        bindings.push({ entry, node, scheduleEntry, onEmit });
        // V2.2-7 (2026-05-11) — live subscribe support. When the source
        // has already started (TOX→workflow-runtime bridge calls this
        // from `runtimes/create.ts` at task creation time, well after
        // boot), wire the new entry directly into the underlying
        // SchedulerHandle so it fires without a daemon restart. Pre-start
        // calls fall through to the boot-time batch in `start()`.
        if (started && handle) handle.add(scheduleEntry);
      }
    },
    async start() {
      if (started) return;
      started = true;
      handle = startScheduler({
        registry: bindings.map(b => b.scheduleEntry),
        runWorkflow: async (scheduleEntry) => {
          const binding = bindings.find(b =>
            b.scheduleEntry.workflowName === scheduleEntry.workflowName
            && b.scheduleEntry.nodeId === scheduleEntry.nodeId);
          if (!binding) return;
          await binding.onEmit(
            scheduleEntry.workflowName,
            scheduleEntry.nodeId,
            { kind: 'schedule', firedAt: Date.now(), trigger: scheduleEntry.trigger },
          );
        },
        setInterval: opts.setInterval,
        clearInterval: opts.clearInterval,
        cronSchedule: opts.cronSchedule,
      });
    },
    async stop() {
      handle?.stop();
      handle = null;
      bindings.length = 0;
      started = false;
    },
    subscriptions: () => bindings.map(b => ({
      kind: 'schedule' as const,
      workflowName: b.scheduleEntry.workflowName,
      nodeId: b.scheduleEntry.nodeId,
      summary: b.scheduleEntry.trigger.type === 'cron'
        ? `cron: ${b.scheduleEntry.trigger.cron ?? '(empty)'}`
        : `interval: ${b.scheduleEntry.trigger.interval ?? 0}ms`,
    })),
  };
}
