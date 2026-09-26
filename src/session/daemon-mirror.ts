// Tier 1 Phase 3 양방향 sync · PR 2 · TUI → daemon mirror.
//
// Bridges the TUI's local session-store (UUID jsonl) to the daemon's
// DaemonSessionHistory (PR 1's register-external endpoint) so a
// TUI-started session is discoverable + resumable from PWA / Telegram /
// other clients via `loadSession(<UUID>)`.
//
// Design:
//   1. On activation, the mirror probes the daemon (HTTP GET
//      /v1/health) once. If unreachable, it disables itself silently —
//      TUI continues standalone, no mirroring overhead per turn.
//   2. When alive, the mirror subscribes to onSessionCreated +
//      onMessageAppended (src/session/index.ts) and fires
//      fire-and-forget POST /v1/sessions/external with the latest
//      delta. Idempotent at the daemon side (PR 1) so duplicate or
//      out-of-order calls don't corrupt state.
//   3. Every error is silently logged + the mirror continues — best-
//      effort observer, never breaks the TUI's primary path.
//
// Activation contract:
//   - Default OFF. Caller (dashboard boot) calls
//     `activateDaemonMirrorIfReachable()` once after env detection.
//   - Returns the deactivation handle (idempotent).
//   - Daemon discovery uses ~/.elanous/elanous.runtime.json (httpPort) and
//     ~/.elanous/acp-token (auth). Same-host assumption matches PR 3
//     (telegram /resume) — cross-host mirror is out of arc scope.

import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { elanousDaemonDir, readElanousDaemonRuntime } from '../elanous-daemon.js';
import {
  loadSession,
  onMessageAppended,
  onSessionCreated,
  type SerializedMessage,
  type SessionMeta,
} from './index.js';
import type { LLMMessage } from '../llm.js';

export interface DaemonMirrorActivation {
  /** Stop forwarding events to the daemon. Idempotent. */
  deactivate(): void;
  /** True after a successful daemon probe; false when probe failed
   *  or activation was never called. Diagnostic-only. */
  active: boolean;
  /** Resolved daemon http base URL (e.g. http://127.0.0.1:31415) or
   *  null when not detected / not active. */
  baseUrl: string | null;
}

export interface DaemonMirrorOpts {
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override the discovery — pass `{ baseUrl, token? }` to skip the
   *  runtime.json + acp-token files. Tests inject this; production
   *  calls the no-arg form. */
  discover?: () => { baseUrl: string; token?: string } | null;
  /** Optional logger. */
  log?: (msg: string) => void;
}

/** Read ~/.elanous/acp-token if it exists. Returns null when the file
 *  is missing (daemon ran with --no-http-auth). */
function readAcpToken(): string | null {
  const path = joinPath(elanousDaemonDir(), 'acp-token');
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf8').trim() || null; }
  catch { return null; }
}

/** Production discovery — runtime.json -> httpPort + acp-token file.
 *  Returns null when daemon isn't reachable or didn't expose HTTP. */
function defaultDiscover(): { baseUrl: string; token?: string } | null {
  const runtime = readElanousDaemonRuntime();
  if (!runtime || !runtime.httpPort) return null;
  const host = runtime.httpHost ?? '127.0.0.1';
  const baseUrl = `http://${host}:${runtime.httpPort}`;
  const token = runtime.httpAuth === 'on' ? readAcpToken() ?? undefined : undefined;
  if (token === undefined) return { baseUrl };
  return { baseUrl, token };
}

/** Convert a TUI SerializedMessage to the LLMMessage shape the daemon
 *  expects on POST /v1/sessions/external. The TUI shape carries extra
 *  metadata (ts, turn_id, tool fields) which we strip — the daemon's
 *  history is purely about LLM context. */
function toLlmMessage(msg: SerializedMessage): LLMMessage | null {
  // LLMMessage doesn't carry 'tool' role — tool turns reach the daemon
  // through tool_call / tool_call_update sessionUpdates, not history.
  // Filter them out at the mirror so the daemon's jsonl stays
  // consumable by streamLLM's getMessages contract.
  if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
    return null;
  }
  if (typeof msg.content !== 'string') return null;
  return { role: msg.role, content: msg.content };
}

/** Probe the daemon's /v1/health endpoint. Resolves true if the
 *  daemon answers within `timeoutMs`, false otherwise. Never throws. */
async function probeDaemon(
  baseUrl: string,
  token: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      const r = await fetchImpl(`${baseUrl}/v1/health`, {
        signal: ctrl.signal,
        headers,
      });
      return r.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** POST a register-external request. Fire-and-forget — caller does
 *  not await. */
function postRegisterExternal(
  baseUrl: string,
  token: string | undefined,
  body: { sessionId: string; messages?: LLMMessage[] },
  fetchImpl: typeof fetch,
  log: (m: string) => void,
): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  fetchImpl(`${baseUrl}/v1/sessions/external`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        log(`mirror: ${r.status} ${r.statusText} ${text}`);
      }
    })
    .catch((e) => { log(`mirror: fetch failed: ${String(e)}`); });
}

/** Activate the daemon mirror. Probes the daemon; on success
 *  subscribes to session/message events and forwards them via HTTP.
 *  Returns an activation handle whose `deactivate()` is idempotent. */
export async function activateDaemonMirrorIfReachable(
  opts: DaemonMirrorOpts = {},
): Promise<DaemonMirrorActivation> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const log = opts.log ?? (() => { /* silent */ });
  const discoverFn = opts.discover ?? defaultDiscover;

  const discovery = discoverFn();
  if (!discovery) {
    return { deactivate: () => { /* never activated */ }, active: false, baseUrl: null };
  }
  const reachable = await probeDaemon(discovery.baseUrl, discovery.token, fetchImpl);
  if (!reachable) {
    log(`mirror: daemon at ${discovery.baseUrl} unreachable — skipping mirror`);
    return { deactivate: () => { /* probe failed */ }, active: false, baseUrl: discovery.baseUrl };
  }

  // Track which session ids we've already pushed an initial register
  // for, so subsequent appends only send the latest message rather
  // than the full history every time.
  const initiatedSessions = new Set<string>();

  const offCreated = onSessionCreated((meta: SessionMeta) => {
    // Pre-register with empty messages so a subsequent loadSession
    // RPC succeeds even before the first user prompt lands.
    postRegisterExternal(
      discovery.baseUrl,
      discovery.token,
      { sessionId: meta.id, messages: [] },
      fetchImpl,
      log,
    );
    initiatedSessions.add(meta.id);
  });

  const offAppended = onMessageAppended((id: string, msg: SerializedMessage) => {
    const llm = toLlmMessage(msg);
    if (!llm) return;
    if (initiatedSessions.has(id)) {
      // Incremental — just the latest message.
      postRegisterExternal(
        discovery.baseUrl,
        discovery.token,
        { sessionId: id, messages: [llm] },
        fetchImpl,
        log,
      );
      return;
    }
    // First sync for a session minted before activation — push the
    // full local history so daemon catches up to current state.
    const loaded = loadSession(id);
    const messages: LLMMessage[] = [];
    if (loaded) {
      for (const m of loaded.messages) {
        const converted = toLlmMessage(m);
        if (converted) messages.push(converted);
      }
    } else {
      messages.push(llm);
    }
    postRegisterExternal(
      discovery.baseUrl,
      discovery.token,
      { sessionId: id, messages },
      fetchImpl,
      log,
    );
    initiatedSessions.add(id);
  });

  return {
    active: true,
    baseUrl: discovery.baseUrl,
    deactivate: () => {
      offCreated();
      offAppended();
      initiatedSessions.clear();
    },
  };
}
