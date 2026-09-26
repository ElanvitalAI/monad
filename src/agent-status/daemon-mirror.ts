// IPC followup (2026-05-13) — TUI AgentStatusStore → daemon mirror.
//
// Bridges the dashboard process's local AgentStatusStore (populated by
// the claude-code JSONL parser + codex heuristic parser in
// `src/dashboard/index.ts`) to the daemon's canonical store via
// `POST /v1/agent-status`. After the daemon receives the transition it
// fans out as an `agent.status` NexusEvent on the `/v1/events` bus, so
// PWA `<StatusChip>` hydrates from external CLI agent state regardless
// of which process detected the transition.
//
// Mirrors `src/session/daemon-mirror.ts` (TUI session → daemon history
// mirror) — same probe-once + fire-and-forget POST pattern. Best-
// effort observer: failures never break the dashboard primary path,
// they only log + skip.
//
// Activation contract:
//   - Default OFF. Dashboard boot calls
//     `activateAgentStatusMirrorIfReachable({ store })` once after env
//     detection.
//   - Returns a deactivation handle (idempotent).
//   - Daemon discovery uses `~/.elanous/elanous.runtime.json` (httpPort) +
//     `~/.elanous/acp-token` (auth). Same-host assumption matches the
//     session mirror's contract.

import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { elanousDaemonDir, readElanousDaemonRuntime } from '../elanous-daemon.js';
import { AgentStatusStore, type AgentStatusRecord } from './store.js';

export interface AgentStatusMirrorActivation {
  /** Stop forwarding events to the daemon. Idempotent. */
  deactivate(): void;
  /** True after a successful daemon probe; false when probe failed
   *  or activation was never called. Diagnostic-only. */
  active: boolean;
  /** Resolved daemon http base URL or null when not active. */
  baseUrl: string | null;
}

export interface AgentStatusMirrorOpts {
  /** AgentStatusStore to subscribe (typically the dashboard's). */
  store: AgentStatusStore;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override discovery — pass `{ baseUrl, token? }` to skip the
   *  runtime.json + acp-token files. Tests inject this; production
   *  uses defaultDiscover(). */
  discover?: () => { baseUrl: string; token?: string } | null;
  /** Optional logger. */
  log?: (msg: string) => void;
}

function readAcpToken(): string | null {
  const path = joinPath(elanousDaemonDir(), 'acp-token');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function defaultDiscover(): { baseUrl: string; token?: string } | null {
  const runtime = readElanousDaemonRuntime();
  if (!runtime || !runtime.httpPort) return null;
  const host = runtime.httpHost ?? '127.0.0.1';
  const baseUrl = `http://${host}:${runtime.httpPort}`;
  const token = runtime.httpAuth === 'on' ? readAcpToken() ?? undefined : undefined;
  if (token === undefined) return { baseUrl };
  return { baseUrl, token };
}

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

interface PushBody {
  agentId: string;
  status: AgentStatusRecord['status'];
  lastEvent?: string;
}

/** Fire-and-forget POST. Caller doesn't await — the mirror is
 *  observational. Errors silently log + drop. */
function postAgentStatus(
  baseUrl: string,
  token: string | undefined,
  body: PushBody,
  fetchImpl: typeof fetch,
  log: (msg: string) => void,
): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  fetchImpl(`${baseUrl}/v1/agent-status`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        log(`agent-status-mirror: ${r.status} ${r.statusText} ${text}`);
      }
    })
    .catch((e) => {
      log(`agent-status-mirror: fetch failed: ${String(e)}`);
    });
}

const DEACTIVATED: AgentStatusMirrorActivation = {
  deactivate: () => { /* no-op */ },
  active: false,
  baseUrl: null,
};

export async function activateAgentStatusMirrorIfReachable(
  opts: AgentStatusMirrorOpts,
): Promise<AgentStatusMirrorActivation> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoverFn = opts.discover ?? defaultDiscover;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const discovery = discoverFn();
  if (!discovery) return DEACTIVATED;
  const reachable = await probeDaemon(discovery.baseUrl, discovery.token, fetchImpl);
  if (!reachable) {
    log(`agent-status-mirror: daemon at ${discovery.baseUrl} unreachable — skipping mirror`);
    return { deactivate: () => { /* probe failed */ }, active: false, baseUrl: discovery.baseUrl };
  }
  const unsubscribe = opts.store.subscribe((agentId, rec) => {
    const body: PushBody = {
      agentId,
      status: rec.status,
      ...(rec.lastEvent !== undefined ? { lastEvent: rec.lastEvent } : {}),
    };
    postAgentStatus(discovery.baseUrl, discovery.token, body, fetchImpl, log);
  });
  let active = true;
  return {
    deactivate() {
      if (!active) return;
      active = false;
      try {
        unsubscribe();
      } catch {
        /* swallow */
      }
    },
    get active() {
      return active;
    },
    baseUrl: discovery.baseUrl,
  };
}
