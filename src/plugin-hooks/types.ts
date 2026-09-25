// ── PX-3 P1: HookHandler + HookCtx ──
//
// A handler is an in-process function or a shell-command wrapper. Both
// flavours reduce to the same HookHandler shape so the dispatcher
// doesn't care how the output was produced.

import type { HookEvent, HookEventMap } from './events.js';

/** Context threaded to every invoke. pluginId lets listeners log /
 *  audit the source of a hook output; logger is plain-text warn/info/
 *  error sinks routed to the dashboard log pane; state is the plugin's
 *  own PluginStateApi (PX-2) so hooks can persist cross-session
 *  derived data; abortSignal fires when the dispatch is timing out or
 *  a prior hook in the chain called abort(). */
export interface HookCtx {
  pluginId: string;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  state?: import('../plugin-state/api.js').PluginStateApi;
  abortSignal: AbortSignal;
}

/** Reserved priority range (0-9) is for built-in first-responders:
 *  Andon (PFC S3.1), Budget guard (PFC S2), TerminationCheck.
 *  Registering a user-plugin hook with priority <10 emits a warning
 *  via dispatcher.register; we don't hard-enforce so a test can still
 *  assert ordering without tripping it. */
export const RESERVED_PRIORITY_MAX = 9;
export const DEFAULT_PRIORITY = 100;
export const DEFAULT_TIMEOUT_MS = 2000;

export interface HookHandler<E extends HookEvent = HookEvent> {
  /** Stable id across register calls — `<pluginId>:<handlerName>`.
   *  The dispatcher uses it for dedup + unregister addressing. */
  id: string;
  /** Event this handler consumes. */
  event: E;
  /** Lower = earlier. 0-9 reserved. Default 100. */
  priority: number;
  /** Hard cap on invoke() duration. Default 2000ms. */
  timeoutMs?: number;
  /** Optional matcher — for ToolCall hooks this is the toolName(s)
   *  the handler applies to; for Turn/Message it's usually unset. The
   *  matcher semantics are dispatcher-interpreted (string equality
   *  against a synthetic 'subject' field per event). */
  matcher?: string | readonly string[];
  /** Called per dispatch. May return synchronously. Throws / rejects
   *  are caught by the dispatcher and logged; the chain continues. */
  invoke(
    input: HookEventMap[E]['input'],
    ctx: HookCtx,
  ): HookEventMap[E]['output'] | Promise<HookEventMap[E]['output']>;
}

/** Outcome of a full chain invocation. Merged fields from every hook
 *  are collapsed by the dispatcher's event-specific reducer (see
 *  dispatcher.ts::mergeOutput*). When `abort` is set, chain stopped
 *  early and `abort.from` names the handler that triggered it. */
export interface ChainOutcome<Out> {
  output: Out;
  /** First handler that returned an abort directive (for audit). */
  abort?: { reason: string; from: string };
  /** Per-handler audit rows — lets tests + the log pane show
   *  individual timings. */
  steps: readonly ChainStep[];
}

export interface ChainStep {
  handlerId: string;
  priority: number;
  status: 'ok' | 'error' | 'timeout' | 'abort';
  durationMs: number;
  /** For status === 'error' or 'timeout', the diagnostic message. */
  message?: string;
  /** The output keys this hook actually produced — helpful for
   *  tracing which Andon / Budget / custom hook injected what. */
  outputKeys?: readonly string[];
}
