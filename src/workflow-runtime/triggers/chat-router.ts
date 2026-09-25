// Surface-unification v2 (2026-05-11) — chat trigger router.
//
// Routes `POST /v1/workflows/chat<path>` requests through the registered
// chat trigger nodes. Mirrors `webhook-router.ts` (registry + auth +
// JSON body lookup) but returns the workflow's last-node output as the
// chat response body instead of a 202 + runId.

import type { ChatTriggerNode } from '../types.js';

export interface ChatRegistryEntry {
  workflowName: string;
  nodeId: string;
  trigger: ChatTriggerNode['chatTrigger'];
}

export interface ChatRouterRequest {
  /** Path under `/v1/workflows/chat` (with leading `/`). */
  path: string;
  /** Optional Authorization header. */
  authorization?: string;
  /** Parsed JSON body — `{ message: string, sessionId?: string }`. */
  body: { message?: string; sessionId?: string };
}

/** Surface-unification v2.1 (2026-05-11) — streaming SSE frame. The
 *  chat router emits per-event SSE frames so the caller's browser /
 *  curl sees per-node progress without waiting for the workflow to
 *  finish. `event` and `data` map directly to the SSE wire spec. */
export interface ChatStreamFrame {
  event: string;
  data: string;
}

export interface ChatRouterResponse {
  status: number;
  /** Non-streaming response — JSON body when stream is absent. */
  body: Record<string, unknown>;
  /** Streaming response — when set the caller serves text/event-stream
   *  instead of application/json. Caller is responsible for iterating
   *  the async iterable + encoding each frame. */
  stream?: AsyncIterable<ChatStreamFrame>;
}

export interface ChatRouterOpts {
  registry: ChatRegistryEntry[];
  /** Per-entry non-streaming workflow runner. Returns the last node's
   *  output string (or an error). Used when `trigger.streaming` is
   *  false / undefined. */
  runWorkflow: (entry: ChatRegistryEntry, message: string, sessionId: string | undefined) =>
    Promise<{ ok: true; output: string; runId: string } | { ok: false; error: string }>;
  /** Per-entry streaming runner. Returns an async iterable of SSE
   *  frames the caller pipes straight to the HTTP response. Optional —
   *  when undefined and `trigger.streaming` is true, the router falls
   *  back to non-streaming. */
  runStream?: (entry: ChatRegistryEntry, message: string, sessionId: string | undefined) =>
    AsyncIterable<ChatStreamFrame>;
}

export function buildChatRouter(opts: ChatRouterOpts) {
  // Index registry by path for O(1) lookup. Mutable so post-start
  // `register` / `unregister` calls can add/remove paths without
  // re-building the router (lazy-discovery support · 2026-05-12).
  const byPath = new Map<string, ChatRegistryEntry>();
  for (const entry of opts.registry) {
    byPath.set(entry.trigger.path, entry);
  }

  async function dispatch(req: ChatRouterRequest): Promise<ChatRouterResponse> {
    const entry = byPath.get(req.path);
    if (!entry) {
      return { status: 404, body: { error: 'not_found', path: req.path } };
    }
    // V2.2-2 (2026-05-12) — bearer gate accepts either the `auth.token`
    // (existing) or the `hostedUi.bearer` (new) so the hosted chat
    // page can share a URL-embedded token without the workflow author
    // having to duplicate the secret. Comparison is constant-time to
    // avoid leaking presence/length of valid tokens via timing.
    const acceptedTokens: string[] = [];
    if (entry.trigger.auth?.type === 'bearer') acceptedTokens.push(entry.trigger.auth.token);
    if (entry.trigger.hostedUi?.bearer) acceptedTokens.push(entry.trigger.hostedUi.bearer);
    if (acceptedTokens.length > 0) {
      const presented = stripBearer(req.authorization);
      const ok = presented !== null && acceptedTokens.some((t) => constantTimeEqual(presented, t));
      if (!ok) return { status: 401, body: { error: 'unauthorized' } };
    }
    const message = req.body.message;
    if (typeof message !== 'string' || message.length === 0) {
      return { status: 400, body: { error: 'bad_request', reason: '`message` (string) required' } };
    }
    // Surface-unification v2.1 (2026-05-11) — streaming path. When the
    // trigger opts in + the caller supplied a stream runner, hand back
    // the async iterable so the caller can emit text/event-stream.
    if (entry.trigger.streaming === true && opts.runStream) {
      const stream = opts.runStream(entry, message, req.body.sessionId);
      return { status: 200, body: { ok: true, streaming: true }, stream };
    }
    const result = await opts.runWorkflow(entry, message, req.body.sessionId);
    if (!result.ok) {
      return { status: 500, body: { error: result.error } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        response: result.output,
        runId: result.runId,
        workflowName: entry.workflowName,
      },
    };
  }

  // Attach register / unregister so callers can mutate the routing
  // table after the router has been built. The dispatch closure
  // already reads from the shared `byPath` Map, so additions take
  // effect on the very next request.
  const router = dispatch as ChatRouter;
  router.register = (entry: ChatRegistryEntry): void => {
    byPath.set(entry.trigger.path, entry);
  };
  router.unregister = (path: string): boolean => byPath.delete(path);
  router.paths = (): readonly string[] => Array.from(byPath.keys());
  return router;
}

export type ChatRouter = {
  (req: ChatRouterRequest): Promise<ChatRouterResponse>;
  register(entry: ChatRegistryEntry): void;
  unregister(path: string): boolean;
  paths(): readonly string[];
};

/** Parse a `Bearer <token>` header. Returns null when the header is
 *  missing, the wrong scheme, or the token slice is empty. */
function stripBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

/** Constant-time string equality. Always touches every byte of `b` so
 *  the running time depends only on `b.length` (not on `a` or on the
 *  matching prefix length). Returns false when the lengths differ
 *  without scanning, which is fine — length is not a secret. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
