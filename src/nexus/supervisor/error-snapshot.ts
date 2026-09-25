// NEXUS · error snapshot writer (Phase N-3 cleanup PR γ')
//
// When supervisor.restart layer marks a tab `crashed` (halt-pattern hit
// or maxPerHour exceeded) it pushes a `tab.halt` event. This module
// turns that event into a structured `errors/<tabId>/<ts>.json` file
// the PWA + TUI surface as a fail modal with suggestedActions guiding
// the user to a fix.
//
// Read path lives in src/nexus/api/errors.ts (`/v1/nexus/errors`).

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { nexusErrorsDir } from '../paths.js';
import { pushEvent, type NexusState, type NexusEvent } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusEventBus } from '../api/event-bus.js';
import type { TabKind, TabState, TabStatus } from '../kinds/types.js';
import { debug } from '../../debug/log.js';

export interface SuggestedAction {
  /** Stable identifier (PWA tracks dismissal per id). */
  id: string;
  label: string;
  action:
    | { type: 'tab-restart'; tabId: string }
    | { type: 'tab-stop'; tabId: string }
    | { type: 'switch-edit'; switchId: string }
    | { type: 'shell-hint'; command: string; description?: string }
    | { type: 'docs'; url: string };
}

export interface ErrorSnapshot {
  /** ms since epoch when the snapshot was written. */
  ts: number;
  isoTs: string;
  tabId: string;
  kind: TabKind | string;
  status: TabStatus | string;
  reason: 'halt-pattern' | 'max-restart-per-hour' | 'unknown';
  pattern?: string;
  lastError?: string;
  pid?: number;
  restartCount?: number;
  suggestedActions: SuggestedAction[];
}

export interface WriteSnapshotOpts {
  /** Override timestamp (tests). Default: Date.now(). */
  now?: number;
}

export function writeErrorSnapshot(
  tab: TabState,
  detail: Record<string, unknown>,
  opts: WriteSnapshotOpts = {},
): ErrorSnapshot {
  const ts = opts.now ?? Date.now();
  const isoTs = new Date(ts).toISOString();
  const reason = (detail.reason === 'halt-pattern' || detail.reason === 'max-restart-per-hour')
    ? detail.reason
    : 'unknown';
  const pattern = typeof detail.pattern === 'string' ? detail.pattern : undefined;
  const lastError = typeof detail.error === 'string'
    ? detail.error
    : tab.lastError;
  const snapshot: ErrorSnapshot = {
    ts,
    isoTs,
    tabId: tab.spec.id,
    kind: tab.spec.kind,
    status: tab.status,
    reason,
    suggestedActions: deriveSuggestedActions(tab, reason, pattern, lastError),
  };
  if (pattern) snapshot.pattern = pattern;
  if (lastError) snapshot.lastError = lastError;
  if (tab.pid !== undefined) snapshot.pid = tab.pid;
  if (typeof tab.restartCount === 'number') snapshot.restartCount = tab.restartCount;

  const dir = nexusErrorsDir(tab.spec.id);
  try {
    mkdirSync(dir, { recursive: true });
    const path = joinPath(dir, `${ts}.json`);
    writeFileSync(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    if (debug.enabled) {
      debug.log('nexus.errors.snapshot.write', tab.spec.id, { reason, pattern });
    }
  } catch { /* best-effort — snapshot is observability, never blocks restart */ }

  return snapshot;
}

/** Subscribe a snapshot writer to the event bus. Returns an unsubscribe.
 *  The caller is expected to invoke the unsubscribe at shutdown so the
 *  closure does not retain references to a dead state. */
export interface SubscribeOpts {
  state: NexusState;
  registry: TabRegistry;
  eventBus: NexusEventBus;
  /** Override now (tests). */
  now?: () => number;
}

export function subscribeErrorSnapshotWriter(opts: SubscribeOpts): () => void {
  return opts.eventBus.subscribe((ev: NexusEvent) => {
    if (ev.kind !== 'tab.halt') return;
    const tabId = ev.tabId;
    if (!tabId) return;
    const tab = opts.registry.get(tabId);
    if (!tab) return;
    const snapshot = writeErrorSnapshot(tab, ev.detail ?? {}, opts.now ? { now: opts.now() } : {});
    pushEvent(opts.state, {
      kind: 'tab.halt',
      tabId,
      detail: { ...(ev.detail ?? {}), snapshotWritten: true, snapshotTs: snapshot.ts },
    });
  }, ['tab.halt']);
}

// ---------------------------------------------------------------------------
// Read path helpers — used by /v1/nexus/errors endpoints
// ---------------------------------------------------------------------------

export interface ListSnapshotsOpts {
  /** Default 50. Caller may override to widen / narrow. */
  limit?: number;
  /** Filter by tab id. */
  tabId?: string;
}

export interface SnapshotListEntry {
  tabId: string;
  ts: number;
  isoTs: string;
  reason: ErrorSnapshot['reason'];
  status: string;
  kind: string;
  pattern?: string;
}

export function listErrorSnapshots(opts: ListSnapshotsOpts = {}): SnapshotListEntry[] {
  const root = nexusErrorsDir();
  if (!existsSync(root)) return [];
  const limit = opts.limit ?? 50;

  const tabDirs: string[] = opts.tabId
    ? [opts.tabId]
    : safeListDir(root);

  const all: SnapshotListEntry[] = [];
  for (const tabDir of tabDirs) {
    const dir = nexusErrorsDir(tabDir);
    if (!existsSync(dir)) continue;
    const files = safeListDir(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const body = readFileSync(joinPath(dir, file), 'utf-8');
        const parsed = JSON.parse(body) as ErrorSnapshot;
        if (typeof parsed.ts !== 'number' || typeof parsed.tabId !== 'string') continue;
        const entry: SnapshotListEntry = {
          tabId: parsed.tabId,
          ts: parsed.ts,
          isoTs: parsed.isoTs,
          reason: parsed.reason,
          status: parsed.status,
          kind: parsed.kind,
        };
        if (parsed.pattern) entry.pattern = parsed.pattern;
        all.push(entry);
      } catch { /* skip malformed */ }
    }
  }
  all.sort((a, b) => b.ts - a.ts);   // newest first
  return all.slice(0, limit);
}

export function readErrorSnapshot(tabId: string, ts: number): ErrorSnapshot | null {
  const path = joinPath(nexusErrorsDir(tabId), `${ts}.json`);
  if (!existsSync(path)) return null;
  try {
    const body = readFileSync(path, 'utf-8');
    return JSON.parse(body) as ErrorSnapshot;
  } catch {
    return null;
  }
}

export function deleteErrorSnapshot(tabId: string, ts: number): boolean {
  const path = joinPath(nexusErrorsDir(tabId), `${ts}.json`);
  if (!existsSync(path)) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}

function safeListDir(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

// ---------------------------------------------------------------------------
// SuggestedActions table — per kind + per halt-pattern + fallback.
// Each branch returns a small set the user can act on without context-switching.
// ---------------------------------------------------------------------------

function deriveSuggestedActions(
  tab: TabState,
  reason: ErrorSnapshot['reason'],
  pattern: string | undefined,
  lastError: string | undefined,
): SuggestedAction[] {
  const id = tab.spec.id;
  const restart: SuggestedAction = {
    id: 'tab-restart',
    label: 'Restart this tab',
    action: { type: 'tab-restart', tabId: id },
  };
  const stop: SuggestedAction = {
    id: 'tab-stop',
    label: 'Stop this tab',
    action: { type: 'tab-stop', tabId: id },
  };

  // Halt-pattern specific guidance per kind.
  if (reason === 'halt-pattern' && pattern) {
    if (tab.spec.kind === 'pwa-host' && /EADDRINUSE/.test(pattern)) {
      return [
        {
          id: 'shell-lsof',
          label: 'Find the process holding the port',
          action: { type: 'shell-hint', command: `lsof -nP -iTCP:$port -sTCP:LISTEN`, description: 'Replace $port with the configured value.' },
        },
        {
          id: 'switch-edit-port',
          label: 'Change tabs.pwa-host:1.port',
          action: { type: 'switch-edit', switchId: 'tabs.pwa-host:1.port' },
        },
        restart,
      ];
    }
    if (tab.spec.kind === 'channel-bot' && /401|403|Unauthorized|Forbidden/.test(pattern)) {
      return [
        {
          id: 'switch-edit-token',
          label: 'Rotate the bot token',
          action: { type: 'switch-edit', switchId: `tabs.${id}.tokenRef` },
        },
        restart,
      ];
    }
    if (tab.spec.kind === 'daemon' && /external/i.test(pattern)) {
      return [
        {
          id: 'shell-stop-daemon',
          label: 'Stop the external `monad serve`',
          action: { type: 'shell-hint', command: 'monad serve --stop', description: 'Run from any shell — the lock file holder receives SIGTERM.' },
        },
        restart,
      ];
    }
    return [
      {
        id: 'view-logs',
        label: 'View the tab\'s log tail',
        action: { type: 'docs', url: `/v1/nexus/tabs/${encodeURIComponent(id)}/logs` },
      },
      restart,
      stop,
    ];
  }

  if (reason === 'max-restart-per-hour') {
    return [
      {
        id: 'view-logs',
        label: 'View the tab\'s log tail',
        action: { type: 'docs', url: `/v1/nexus/tabs/${encodeURIComponent(id)}/logs` },
      },
      {
        id: 'wait-and-retry',
        label: 'Wait for the rolling window to reset',
        action: { type: 'docs', url: '/docs/feature/FEATURE-monad-nexus.md#supervisor' },
      },
      restart,
    ];
  }

  // Fallback — generic recover.
  void lastError;
  return [restart, stop];
}
