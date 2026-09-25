// H6 P5 · Agent reply · send-and-await message exchange.
//
// AgentHandoff (H5 P3) launches a NEW target session and transfers a
// source snapshot one-shot. AgentReply is the complementary primitive
// — target is **already alive**, we send a message, wait for the
// response, and return it to the caller. Use cases: plan→exec→review
// cycles inside a H6 P4 agent-room; user asks a specific live agent
// a follow-up question; LLM-autonomous multi-agent workflows.
//
// Design rails (PLAN §5 D1-D11):
//   - D1  Send-and-await · fire-and-forget is v2
//   - D2  Idle-detect · hybrid turn-complete deferred
//   - D3  Reuse findLiveSessionById via deps.lookup
//   - D4  Observer lookup via deps.observerLookup (observer-registry)
//   - D5  Default channel filter = ['message']
//   - D6  Cycle depth cap = 8 · countReplyDepth back-walk
//   - D7  Source optional · 'user' ghost as from in that case
//   - D8  Timeout → partial + warning (NOT an error)
//   - D10 Edge meta: previews + elapsed + depth + warnings

import { debug } from '../debug/log.js';
import {
  defaultAgentGraph,
  type AgentGraph,
  type AgentGraphEdge,
} from './agent-graph.js';
import type { EmbodiedAgentSession } from './embodiment.js';
import type { TransportObserver } from './transport-observer.js';
import { ReplyCapture, defaultSleep } from './reply-capture.js';

export const USER_GHOST_SESSION_ID = 'user';
const DEFAULT_IDLE_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_CHANNELS: readonly string[] = ['message'];
const PREVIEW_CAP = 120;

export interface ReplyOpts {
  readonly fromSessionId?: string;
  readonly toSessionId: string;
  readonly message: string;
  readonly includeChannels?: readonly string[];
  readonly idleMs?: number;
  readonly timeoutMs?: number;
  readonly edgeMeta?: Readonly<Record<string, unknown>>;
}

export interface ReplyResult {
  readonly fromSessionId: string | null;
  readonly toSessionId: string;
  readonly replyText: string;
  readonly channels: Readonly<Record<string, string>>;
  readonly elapsedMs: number;
  readonly cycleDepth: number;
  readonly warnings: readonly string[];
  readonly edge: AgentGraphEdge;
}

export interface ReplyLookup {
  findSession(sessionId: string): EmbodiedAgentSession | undefined;
}

export interface ReplyDeps {
  readonly lookup: ReplyLookup;
  readonly observerLookup?: (sessionId: string) => TransportObserver | undefined;
  readonly graph?: AgentGraph;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxDepth?: number;
}

export class ReplyCycleExceededError extends Error {
  constructor(
    readonly fromSessionId: string,
    readonly toSessionId: string,
    readonly depth: number,
    readonly cap: number,
  ) {
    super(
      `AgentReply · cycle depth ${depth} >= cap ${cap} · chain from=${fromSessionId} to=${toSessionId}`,
    );
    this.name = 'ReplyCycleExceededError';
  }
}

export async function sendReply(
  opts: ReplyOpts,
  deps: ReplyDeps,
): Promise<ReplyResult> {
  const graph = deps.graph ?? defaultAgentGraph;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (!opts.toSessionId || typeof opts.toSessionId !== 'string') {
    throw new Error('sendReply · toSessionId required');
  }
  if (typeof opts.message !== 'string') {
    throw new Error('sendReply · message must be a string');
  }

  // D3 · resolve target in live-session registry.
  const target = deps.lookup.findSession(opts.toSessionId);
  if (!target) {
    throw new Error(`sendReply · target session '${opts.toSessionId}' not found`);
  }
  const hasPty = target.transports.some((t) => t.kind === 'pty');
  if (!hasPty) {
    throw new Error(
      `sendReply · target '${opts.toSessionId}' has no PTY transport · ` +
      `AgentReply requires pty-backed session (v1 · Bundle 2 adds ACP reply path)`,
    );
  }

  // D7 · source optional. When omitted we use the 'user' ghost as the
  // from-side of the edge; cycleDepth starts from the target so a
  // user-initiated reply is depth 0 unless the target is already in
  // a reply cycle (which it shouldn't be for user-driven turns).
  const fromId = opts.fromSessionId ?? USER_GHOST_SESSION_ID;

  // D6 · cycle depth cap. We count the existing reply chain leading
  // *into* the from-side (not into target) because this about-to-
  // record edge will extend the chain by one.
  const existingDepth =
    fromId === USER_GHOST_SESSION_ID ? 0 : graph.countReplyDepth(fromId);
  const newDepth = existingDepth + 1;
  if (newDepth > maxDepth) {
    if (debug.enabled) {
      debug.log('agent.reply.cycle-exceeded', fromId, {
        toSessionId: opts.toSessionId,
        depth: newDepth,
        cap: maxDepth,
      });
    }
    throw new ReplyCycleExceededError(fromId, opts.toSessionId, newDepth, maxDepth);
  }

  // D4 · observer lookup (optional at DI level, best-effort at runtime).
  const observer = deps.observerLookup?.(opts.toSessionId);

  const warnings: string[] = [];
  const capture = new ReplyCapture();
  let delta: Record<string, string> = {};
  let elapsed = 0;

  const startedAt = now();
  if (observer) {
    capture.mark(observer, now);
    try {
      await target.send(opts.message + (opts.message.endsWith('\n') ? '' : '\n'));
    } catch (err) {
      throw new Error(
        `sendReply · target.send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = await capture.collectUntilIdle(observer, {
      idleMs: opts.idleMs ?? DEFAULT_IDLE_MS,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      now,
      sleep,
    });
    delta = { ...result.delta };
    warnings.push(...result.warnings);
    elapsed = now() - startedAt;
  } else {
    // No observer · fall back to raw screen snapshot diff via
    // target.snapshot(). We take pre-snapshot, send, wait fixed
    // timeoutMs, then diff. Quality degraded but still useful.
    warnings.push('observer-missing');
    let pre = '';
    try { pre = await target.snapshot(); } catch { /* ignore */ }
    try {
      await target.send(opts.message + (opts.message.endsWith('\n') ? '' : '\n'));
    } catch (err) {
      throw new Error(
        `sendReply · target.send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await sleep(opts.idleMs ?? DEFAULT_IDLE_MS);
    let post = '';
    try { post = await target.snapshot(); } catch { /* ignore */ }
    elapsed = now() - startedAt;
    const diff = post.length > pre.length ? post.slice(pre.length) : post;
    if (diff.length > 0) delta.message = diff;
    else warnings.push('empty-delta');
  }

  // D5 · filter channels. includeChannels undefined = default
  // ['message']; empty array = "everything".
  const requested = opts.includeChannels;
  const filtered = filterChannels(delta, requested);
  const replyText = joinChannels(filtered);

  // D10 · record edge with preview metadata.
  const meta: Record<string, unknown> = {
    messagePreview: preview(opts.message),
    replyPreview: preview(replyText),
    elapsedMs: elapsed,
    cycleDepth: newDepth,
  };
  if (warnings.length > 0) meta.warnings = [...warnings];
  if (opts.edgeMeta) Object.assign(meta, opts.edgeMeta);

  const edge = graph.recordEdge({
    from: fromId,
    to: opts.toSessionId,
    kind: 'reply',
    meta,
  });

  if (debug.enabled) {
    debug.log('agent.reply', `${fromId} → ${opts.toSessionId}`, {
      elapsedMs: elapsed,
      cycleDepth: newDepth,
      channels: Object.keys(filtered),
      warnings,
      replyBytes: replyText.length,
    });
  }

  return {
    fromSessionId: opts.fromSessionId ?? null,
    toSessionId: opts.toSessionId,
    replyText,
    channels: filtered,
    elapsedMs: elapsed,
    cycleDepth: newDepth,
    warnings,
    edge,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function filterChannels(
  delta: Readonly<Record<string, string>>,
  requested: readonly string[] | undefined,
): Record<string, string> {
  // undefined → default to ['message']; empty [] → pass everything.
  const keys = requested === undefined
    ? DEFAULT_CHANNELS
    : requested.length === 0
      ? Object.keys(delta)
      : requested;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = delta[k];
    if (v && v.length > 0) out[k] = v;
  }
  // If filter produced nothing but delta had content, degrade
  // gracefully — include whatever did arrive so caller can debug.
  if (Object.keys(out).length === 0 && Object.keys(delta).length > 0) {
    for (const [k, v] of Object.entries(delta)) {
      if (v && v.length > 0) out[k] = v;
    }
  }
  return out;
}

function joinChannels(channels: Readonly<Record<string, string>>): string {
  // Preserve channel boundaries so the caller can see multi-channel
  // context. Single-channel → just the body.
  const entries = Object.entries(channels);
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0]![1].trim();
  return entries.map(([k, v]) => `[${k}]\n${v.trim()}`).join('\n\n');
}

function preview(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= PREVIEW_CAP) return trimmed;
  return trimmed.slice(0, PREVIEW_CAP - 1) + '…';
}
