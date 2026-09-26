// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M3 — Dashboard HUD
// segment → daemon mirror.
//
// Bridges the dashboard process's local HudState (`src/panes/hud.ts`,
// populated by 11 setSegment call-sites in `src/dashboard/index.ts`)
// to the daemon's HudStore via `POST /v1/hud-segment`. After the
// daemon receives the segment it fans out as a `hud.segment`
// NexusEvent on `/v1/events`, so PWA `<ChatHud>` (M4) hydrates from
// dashboard-only writers.
//
// Mirrors `src/agent-status/daemon-mirror.ts` 1:1 — same probe-once +
// fire-and-forget POST pattern. Best-effort observer: probe failures
// or POST errors never break the dashboard primary path, they only
// log + skip.
//
// Two filters live here (not on the daemon):
//  - **TUI-only segments**: chord · mode · chat-mode · conv-hover ·
//    tr-pane-modal · copied · voice-state — semantically nonsensical
//    on PWA (mouse hover labels · keyboard chord progress · already
//    covered by VoiceOverlay). Source-side drop saves wire bytes.
//  - **ANSI codes**: HUD values may carry ANSI color escapes (`C.muted`
//    etc.). PWA renders via the `tone` enum, not raw ANSI — strip
//    before POST so the browser never sees `\x1b[31m...\x1b[0m`.

import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { elanousDaemonDir, readElanousDaemonRuntime } from '../elanous-daemon.js';
import type { HudState, HudSubscriber } from '../panes/hud.js';
import { subscribe as subscribeHud } from '../panes/hud.js';

export interface HudMirrorActivation {
  /** Stop forwarding HUD segments to the daemon. Idempotent. */
  deactivate(): void;
  /** True after a successful daemon probe; false when probe failed
   *  or activation was never called. Diagnostic-only. */
  active: boolean;
  /** Resolved daemon http base URL or null when not active. */
  baseUrl: string | null;
}

export interface HudMirrorOpts {
  /** HudState to subscribe (typically the dashboard's). */
  hud: HudState;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override discovery — tests inject `{ baseUrl, token? }` to skip
   *  the runtime.json + acp-token files. */
  discover?: () => { baseUrl: string; token?: string } | null;
  /** Optional logger. */
  log?: (msg: string) => void;
  /** Optional segment-key drop list override. Default = TUI-only
   *  segments (see DEFAULT_DROPPED_SEGMENT_KEYS). Tests can pass an
   *  empty set to assert every segment forwards. */
  droppedKeys?: ReadonlySet<string>;
}

/** TUI-only segments that have no PWA equivalent or duplicate an
 *  existing PWA primitive. Forwarding them costs wire bytes without
 *  user-visible value. */
export const DEFAULT_DROPPED_SEGMENT_KEYS: ReadonlySet<string> = new Set([
  'chord', // keyboard chord progress — TUI input only
  'mode', // chat-only mode toggle — PWA is always chat-only
  'chat-mode', // CONTROL vs NORMAL — TUI keyboard mode
  'conv-hover', // mouse hover label — TUI mouse only
  'tr-pane-modal', // TUI modal hint
  'copied', // clipboard toast — PWA owns its own clipboard UX
  'voice-state', // listening/speaking phase — covered by VoiceOverlay
]);

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
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

interface UpsertBody {
  key: string;
  value: string;
  priority?: number;
}

interface ClearBody {
  key: string;
  clear: true;
}

function postHudSegment(
  baseUrl: string,
  token: string | undefined,
  body: UpsertBody | ClearBody,
  fetchImpl: typeof fetch,
  log: (msg: string) => void,
): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  fetchImpl(`${baseUrl}/v1/hud-segment`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        log(`hud-mirror: ${r.status} ${r.statusText} ${text}`);
      }
    })
    .catch((e) => {
      log(`hud-mirror: fetch failed: ${String(e)}`);
    });
}

const DEACTIVATED: HudMirrorActivation = {
  deactivate: () => { /* no-op */ },
  active: false,
  baseUrl: null,
};

export async function activateHudMirrorIfReachable(
  opts: HudMirrorOpts,
): Promise<HudMirrorActivation> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoverFn = opts.discover ?? defaultDiscover;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const dropped = opts.droppedKeys ?? DEFAULT_DROPPED_SEGMENT_KEYS;
  const discovery = discoverFn();
  if (!discovery) return DEACTIVATED;
  const reachable = await probeDaemon(discovery.baseUrl, discovery.token, fetchImpl);
  if (!reachable) {
    log(`hud-mirror: daemon at ${discovery.baseUrl} unreachable — skipping mirror`);
    return { deactivate: () => { /* probe failed */ }, active: false, baseUrl: discovery.baseUrl };
  }
  const handler: HudSubscriber = (event) => {
    if (dropped.has(event.key)) return;
    if (event.kind === 'set') {
      const value = stripAnsi(event.segment.value);
      const body: UpsertBody = { key: event.key, value };
      if (event.segment.priority !== undefined) body.priority = event.segment.priority;
      postHudSegment(discovery.baseUrl, discovery.token, body, fetchImpl, log);
    } else {
      const body: ClearBody = { key: event.key, clear: true };
      postHudSegment(discovery.baseUrl, discovery.token, body, fetchImpl, log);
    }
  };
  const unsubscribe = subscribeHud(opts.hud, handler);
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
