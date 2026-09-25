// Scheduler-retirement R7 (2026-05-11) — Telegram TriggerSource.
//
// Subscribes Telegram trigger nodes from a `WorkflowEntry[]` and
// exposes `dispatch(event)` so the AXON Telegram bridge
// (`src/telegram.ts` polling / webhook tap) can fan inbound
// messages / commands / callback_queries into matching workflows.
//
// Pure: the source never touches Telegram. Bridge wiring is a
// separate follow-up that needs cross-track NOTICE per ROADMAP §10
// group G. Tests drive `dispatch()` with synthetic events.

import { isTelegramTriggerNode } from '../schema.js';
import type { TelegramTriggerNode, WorkflowEntry } from '../types.js';
import type { TriggerEmit, TriggerSource, TriggerSubscription } from './source.js';

export interface TelegramEvent {
  kind: 'message' | 'command' | 'callback_query';
  /** Chat id or username (`@my_group`). */
  chat: string;
  /** Sender id or username. */
  user: string;
  /** Message body / command argument / callback_data. */
  body: string;
  /** Parsed command name without leading `/` (kind=command only). */
  command?: string;
  /** Optional raw payload forwarded as the workflow $ARGUMENTS. */
  raw?: unknown;
}

export interface TelegramSource extends TriggerSource {
  readonly kind: 'telegram';
  /** Route a normalized Telegram event through subscribed entries. */
  dispatch(event: TelegramEvent): Promise<Array<{ workflowName: string; nodeId: string; ok: boolean; error?: string }>>;
  subscriptions(): TriggerSubscription[];
}

interface Binding {
  entry: WorkflowEntry;
  node: TelegramTriggerNode;
  onEmit: TriggerEmit;
}

export function createTelegramSource(): TelegramSource {
  const bindings: Binding[] = [];
  let started = false;

  return {
    kind: 'telegram',
    subscribe(entry, onEmit) {
      // 2026-05-12 — post-start subscribe is supported (the
      // dispatch loop reads `bindings` fresh on every event, so a
      // newly-added binding fires on the next inbound update).
      for (const node of entry.definition.nodes ?? []) {
        if (!isTelegramTriggerNode(node)) continue;
        const dup = bindings.some(b =>
          b.entry.definition.name === entry.definition.name && b.node.id === node.id);
        if (dup) continue;
        bindings.push({ entry, node, onEmit });
      }
    },
    async start() {
      started = true;
    },
    async stop() {
      bindings.length = 0;
      started = false;
    },
    async dispatch(event) {
      if (!started) return [];
      const results: Array<{ workflowName: string; nodeId: string; ok: boolean; error?: string }> = [];
      for (const b of bindings) {
        if (!matches(b.node, event)) continue;
        const r = await b.onEmit(
          b.entry.definition.name,
          b.node.id,
          { kind: 'telegram', event: event.raw ?? event },
        );
        results.push({
          workflowName: b.entry.definition.name,
          nodeId: b.node.id,
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
        });
      }
      return results;
    },
    subscriptions: () => bindings.map(b => ({
      kind: 'telegram' as const,
      workflowName: b.entry.definition.name,
      nodeId: b.node.id,
      summary: telegramSummary(b.node),
    })),
  };
}

function matches(node: TelegramTriggerNode, event: TelegramEvent): boolean {
  const t = node.telegramTrigger;
  if (t.kind !== event.kind) return false;
  if (t.chat && t.chat !== '*' && t.chat !== event.chat) return false;
  if (t.user && t.user !== '*' && t.user !== event.user) return false;
  if (t.kind === 'command' && t.command && t.command !== event.command) return false;
  if (t.pattern) {
    try {
      const re = new RegExp(t.pattern);
      if (!re.test(event.body)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function telegramSummary(node: TelegramTriggerNode): string {
  const t = node.telegramTrigger;
  const parts = [`telegram:${t.kind}`];
  if (t.chat) parts.push(`chat=${t.chat}`);
  if (t.user) parts.push(`user=${t.user}`);
  if (t.command) parts.push(`command=/${t.command}`);
  if (t.pattern) parts.push(`pattern=${t.pattern}`);
  return parts.join(' ');
}
