// Service Worker Phase 3 — push subscription store.
//
// Each PWA install that opts into notifications POSTs its
// `PushSubscription` JSON to the daemon. We persist the lot under
// `~/.elanous/push-subs.json` (0o600) so subscriptions survive daemon
// restarts. Storing inline JSON (vs sqlite) follows the same
// pragmatic choice as `~/.elanous/pushcut/bindings.json` — small N,
// easy to inspect, no migration framework needed.
//
// Why a per-subscription `id` (not just the endpoint URL): keeps
// the public API tidy (`DELETE /v1/push/subscribe/<id>`) without
// leaking endpoint shapes that vary per browser (FCM vs Apple vs
// Firefox have different URL conventions).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { debug } from '../debug/log.js';
import { getElanousConfigDir } from '../elanous-config-dir.js';

export interface PushSubscriptionRecord {
  id: string;
  /** Browser-side `PushSubscription.toJSON()` shape. We don't
   *  type-check the inner fields — `web-push` (Node) accepts the
   *  whole envelope as-is when sending. */
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
    expirationTime?: number | null;
  };
  /** Optional friendly label so /settings UI can show "iPhone 15"
   *  vs raw endpoint URLs. */
  label?: string;
  createdAt: number;
}

interface SubscriptionsFile {
  version: 1;
  subscriptions: PushSubscriptionRecord[];
}

const FILE_VERSION = 1;

function defaultPath(): string {
  // Mirror `elanousDaemonDir()` — keep all per-host state under one
  // dir so existing backup tooling sweeps it together.
  return `${getElanousConfigDir()}/push-subs.json`;
}

function defaultFile(): SubscriptionsFile {
  return { version: FILE_VERSION, subscriptions: [] };
}

function readFile(path: string): SubscriptionsFile {
  if (!existsSync(path)) return defaultFile();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SubscriptionsFile>;
    if (parsed.version !== FILE_VERSION) return defaultFile();
    return {
      version: FILE_VERSION,
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    };
  } catch (e) {
    if (debug.enabled) {
      debug.log('webpush.subs', 'parse-failed', {
        reason: e instanceof Error ? e.message : String(e),
      }, { level: 'error' });
    }
    return defaultFile();
  }
}

function writeFile(path: string, file: SubscriptionsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  // Defensive — re-stat to verify mode in case the file already
  // existed with looser perms (e.g. user copy-pasted from a backup).
  try {
    const s = statSync(path);
    if ((s.mode & 0o077) !== 0) {
      // Best-effort — older filesystems don't expose chmod via fs.
      const { chmodSync } = require('node:fs') as typeof import('node:fs');
      chmodSync(path, 0o600);
    }
  } catch { /* swallow */ }
}

let pathOverride: string | null = null;

export function _setPushSubsPathForTest(path: string | null): void {
  pathOverride = path;
}

function path(): string {
  return pathOverride ?? defaultPath();
}

function newSubscriptionId(now: number): string {
  return `push-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface AddSubscriptionInput {
  subscription: PushSubscriptionRecord['subscription'];
  label?: string;
  /** Optional clock injection — tests pin createdAt + id derivation. */
  now?: () => number;
}

export function addSubscription(input: AddSubscriptionInput): PushSubscriptionRecord {
  const now = (input.now ?? Date.now)();
  const file = readFile(path());
  // Dedup by endpoint — re-subscription from the same browser tab
  // arrives with a fresh id but the same endpoint. Replace in place
  // so `~/.elanous/push-subs.json` doesn't grow on every reload.
  const existing = file.subscriptions.findIndex(
    (s) => s.subscription.endpoint === input.subscription.endpoint,
  );
  const record: PushSubscriptionRecord = {
    id: existing >= 0 ? file.subscriptions[existing]!.id : newSubscriptionId(now),
    subscription: input.subscription,
    ...(input.label ? { label: input.label } : {}),
    createdAt: existing >= 0 ? file.subscriptions[existing]!.createdAt : now,
  };
  if (existing >= 0) {
    file.subscriptions[existing] = record;
  } else {
    file.subscriptions.push(record);
  }
  writeFile(path(), file);
  if (debug.enabled) {
    debug.log('webpush.subs', existing >= 0 ? 'replace' : 'add', {
      id: record.id,
      endpoint: record.subscription.endpoint.slice(0, 60),
    });
  }
  return record;
}

export function removeSubscription(id: string): boolean {
  const file = readFile(path());
  const before = file.subscriptions.length;
  file.subscriptions = file.subscriptions.filter((s) => s.id !== id);
  if (file.subscriptions.length === before) return false;
  writeFile(path(), file);
  if (debug.enabled) {
    debug.log('webpush.subs', 'remove', { id });
  }
  return true;
}

export function listSubscriptions(): PushSubscriptionRecord[] {
  return readFile(path()).subscriptions;
}
