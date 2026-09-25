// Scheduler-retirement R6 (2026-05-11) — Discord TriggerSource.
//
// Subscribes Discord trigger nodes from a `WorkflowEntry[]` and
// exposes `dispatch(event)` so the AXON Discord bridge (`src/discord
// .ts` event tap) can fan inbound messages / mentions / reactions
// into matching workflows.
//
// Pure: the source itself never touches Discord. The bridge wire is
// a separate concern (follow-up that needs cross-track NOTICE per
// ROADMAP §10 group G). Tests drive `dispatch()` directly with
// synthetic events.

import { isDiscordTriggerNode } from '../schema.js';
import type { DiscordTriggerNode, WorkflowEntry } from '../types.js';
import type { TriggerEmit, TriggerSource, TriggerSubscription } from './source.js';

export interface DiscordEvent {
  kind: 'message' | 'mention' | 'reaction';
  channel: string;
  /** Author id, username, or any string the bridge surfaces. */
  user: string;
  /** Message body (kind=message|mention) or emoji name (kind=reaction). */
  body: string;
  /** Optional raw payload forwarded as the workflow $ARGUMENTS. */
  raw?: unknown;
}

export interface DiscordSource extends TriggerSource {
  readonly kind: 'discord';
  /** Route a normalized Discord event through subscribed entries.
   *  Returns the list of fan-out results (one per matching binding).
   *  Returns empty array before `start()` or when nothing matches. */
  dispatch(event: DiscordEvent): Promise<Array<{ workflowName: string; nodeId: string; ok: boolean; error?: string }>>;
  subscriptions(): TriggerSubscription[];
}

interface Binding {
  entry: WorkflowEntry;
  node: DiscordTriggerNode;
  onEmit: TriggerEmit;
}

export function createDiscordSource(): DiscordSource {
  const bindings: Binding[] = [];
  let started = false;

  return {
    kind: 'discord',
    subscribe(entry, onEmit) {
      // 2026-05-12 — post-start subscribe is supported (the
      // dispatch loop reads `bindings` fresh on every event, so a
      // newly-added binding fires on the next inbound message).
      for (const node of entry.definition.nodes ?? []) {
        if (!isDiscordTriggerNode(node)) continue;
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
          { kind: 'discord', event: event.raw ?? event },
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
      kind: 'discord' as const,
      workflowName: b.entry.definition.name,
      nodeId: b.node.id,
      summary: discordSummary(b.node),
    })),
  };
}

function matches(node: DiscordTriggerNode, event: DiscordEvent): boolean {
  const t = node.discordTrigger;
  if (t.kind !== event.kind) return false;
  if (t.channel && t.channel !== '*' && t.channel !== event.channel) return false;
  if (t.user && t.user !== '*' && t.user !== event.user) return false;
  if (t.pattern) {
    try {
      const re = new RegExp(t.pattern);
      if (!re.test(event.body)) return false;
    } catch {
      // Bad regex — fail closed.
      return false;
    }
  }
  return true;
}

function discordSummary(node: DiscordTriggerNode): string {
  const t = node.discordTrigger;
  const parts = [`discord:${t.kind}`];
  if (t.channel) parts.push(`channel=${t.channel}`);
  if (t.user) parts.push(`user=${t.user}`);
  if (t.pattern) parts.push(`pattern=${t.pattern}`);
  return parts.join(' ');
}
