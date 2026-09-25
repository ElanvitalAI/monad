// Scheduler retirement R2 (2026-05-11) — generic TriggerSource interface.
//
// Foundation for the daemon-side trigger registry (#2255). R6 Discord +
// R7 Telegram trigger nodes implement the same interface so daemon /
// registry orchestration is uniform.
//
// Pure: a `TriggerSource` is a runtime adapter — `start()` connects to
// the upstream channel (cron tick, HTTP listener, Discord/Telegram
// bridge), `subscribe()` records a workflow → callback binding, and
// `stop()` releases. The daemon (src/workflow-runtime/daemon.ts) calls
// these in a fixed lifecycle on boot/shutdown.

import type { WorkflowEntry } from '../types.js';

export type TriggerKind = 'schedule' | 'webhook' | 'discord' | 'telegram' | 'chat';

/** Result of dispatching a workflow run from a trigger emit. */
export interface TriggerEmitResult {
  ok: boolean;
  runId?: string;
  error?: string;
  /** Surface-unification v2.1 (2026-05-11) — last-node output. The
   *  daemon's emit closure captures `outputs[lastNode]` from the
   *  runWorkflow result so chat triggers can echo the workflow's
   *  reply back to the caller. Empty for non-chat triggers; webhooks
   *  / discord / telegram fan-out is fire-and-forget and clients
   *  poll `/v1/workflows/runs/<runId>` for the actual result. */
  output?: string;
}

/** Callback the source invokes when an upstream event fires. The
 *  `payload` is opaque metadata forwarded as the workflow's
 *  `$ARGUMENTS` JSON. */
export type TriggerEmit = (
  workflowName: string,
  nodeId: string,
  payload: unknown,
) => Promise<TriggerEmitResult>;

/** A `TriggerSource` represents one upstream channel adapter (cron
 *  ticker, HTTP server, Discord bridge, Telegram bridge, ...). The
 *  daemon owns the lifecycle: subscribe entries → start → ... → stop. */
export interface TriggerSource {
  /** Channel id — used by registry + tests. */
  readonly kind: TriggerKind;
  /** Register a workflow → upstream subscription. Multiple workflows
   *  may register simultaneously. Implementations should de-duplicate
   *  by `(workflowName, nodeId)`. */
  subscribe(entry: WorkflowEntry, onEmit: TriggerEmit): void;
  /** Connect upstream. Called once after every workflow has subscribed.
   *  Must be idempotent. */
  start(): Promise<void>;
  /** Disconnect upstream + release all subscriptions. Must be
   *  idempotent so the daemon can call it during graceful shutdown
   *  even if the source failed to start. */
  stop(): Promise<void>;
}

/** Snapshot describing one active subscription for `daemon.status()`. */
export interface TriggerSubscription {
  kind: TriggerKind;
  workflowName: string;
  nodeId: string;
  /** Human-readable summary — `'cron: 0 9 * * *'` or `'POST /hook'`. */
  summary: string;
}
