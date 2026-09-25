// Node-catalog N4.1 + N4.2 (2026-05-11) — Schedule + Webhook trigger
// executors (schema-only v1).
//
// Daemon-side cron / dynamic HTTP route registration is deferred to a
// follow-up that touches `nexus/daemon/scheduler.ts` + `src/nexus/api/
// http-server.ts` + user-config (`workflows.schedules.<name>`,
// `workflows.webhooks.<name>`). v1 = manifest pass-through: the
// trigger declares the entry point, the executor emits the descriptor
// as output so authors can declare the trigger now and wire daemon
// dispatch later without rewriting the workflow.

import type {
  ChatTriggerNode,
  DiscordTriggerNode,
  ManualTriggerNode,
  NodeExecContext,
  NodeOutput,
  ScheduleTriggerNode,
  TelegramTriggerNode,
  WebhookTriggerNode,
  WorkflowDeps,
} from '../types.js';

export async function executeScheduleTriggerNode(
  node: ScheduleTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  return {
    ok: true,
    output: {
      kind: 'schedule',
      ...node.scheduleTrigger,
    },
    durationMs: 0,
  };
}

export async function executeWebhookTriggerNode(
  node: WebhookTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  return {
    ok: true,
    output: {
      kind: 'webhook',
      method: node.webhookTrigger.method,
      path: node.webhookTrigger.path,
      // Auth descriptor surfaces type only; secret values stay in YAML
      // (the executor doesn't need to echo them downstream).
      ...(node.webhookTrigger.auth ? { authType: node.webhookTrigger.auth.type } : {}),
    },
    durationMs: 0,
  };
}

export async function executeDiscordTriggerNode(
  node: DiscordTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const { kind, channel, user, pattern } = node.discordTrigger;
  return {
    ok: true,
    output: {
      kind: 'discord',
      eventKind: kind,
      ...(channel !== undefined ? { channel } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(pattern !== undefined ? { pattern } : {}),
    },
    durationMs: 0,
  };
}

export async function executeManualTriggerNode(
  node: ManualTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  return {
    ok: true,
    output: {
      kind: 'manual',
      ...(node.manualTrigger.description !== undefined ? { description: node.manualTrigger.description } : {}),
    },
    durationMs: 0,
  };
}

export async function executeChatTriggerNode(
  node: ChatTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const { path, auth, sessionMode, streaming } = node.chatTrigger;
  return {
    ok: true,
    output: {
      kind: 'chat',
      path,
      sessionMode: sessionMode ?? 'stateless',
      streaming: streaming === true,
      ...(auth ? { authType: auth.type } : {}),
    },
    durationMs: 0,
  };
}

export async function executeTelegramTriggerNode(
  node: TelegramTriggerNode,
  _ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const { kind, chat, user, command, pattern } = node.telegramTrigger;
  return {
    ok: true,
    output: {
      kind: 'telegram',
      eventKind: kind,
      ...(chat !== undefined ? { chat } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(command !== undefined ? { command } : {}),
      ...(pattern !== undefined ? { pattern } : {}),
    },
    durationMs: 0,
  };
}
