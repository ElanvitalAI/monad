// Pushcut client — BI-P2.
//
// Thin HTTP wrapper around api.pushcut.io. The iPhone-side
// Pushcut app listens for notifications and can:
//   • display a rich notification (title + text + image)
//   • run a tap-through URL action (opens Safari)
//   • trigger a user-defined iOS Shortcut
//   • return button-tap callbacks via webhook (advanced)
//
// Configuration lives at ~/.config/monad-agent/pushcut.json:
//   {
//     "apiKey": "pc_xxxxxxxxx",
//     "defaultDeviceIds": ["My iPhone"],
//     "allowedNotificationNames": ["monad-confirm", "open-url", …]
//   }
//
// When the file is missing OR apiKey is empty, all helpers return
// `{ok: false, reason: 'pushcut-not-configured'}` so callers can
// gracefully fall back to Telegram/Discord/terminal.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';

export const PUSHCUT_API_BASE = 'https://api.pushcut.io/v1';

export class PushcutUnavailable extends Error {
  constructor(public readonly reason: string) {
    super(`pushcut: ${reason}`);
    this.name = 'PushcutUnavailable';
  }
}

export interface PushcutConfig {
  apiKey: string;
  defaultDeviceIds?: string[];
  allowedNotificationNames?: string[];
}

// FU2 Tier 2 (PLAN-config-unification-elanous-root-2026-05-10):
//   moved from ~/.config/monad-agent/pushcut.json → ~/.elanous/pushcut.json.
import { migrateLegacyHomeFile } from '../storage/legacy-elanous-dir-migrate.js';
export function defaultPushcutConfigPath(): string {
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'pushcut.json'),
    elanousRel: 'pushcut.json',
  });
  return joinPath(homedir(), '.elanous', 'pushcut.json');
}

export function loadPushcutConfig(path = defaultPushcutConfigPath()): PushcutConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PushcutConfig>;
    if (!parsed.apiKey || typeof parsed.apiKey !== 'string') return null;
    return {
      apiKey: parsed.apiKey,
      defaultDeviceIds: Array.isArray(parsed.defaultDeviceIds)
        ? parsed.defaultDeviceIds.filter(x => typeof x === 'string')
        : undefined,
      allowedNotificationNames: Array.isArray(parsed.allowedNotificationNames)
        ? parsed.allowedNotificationNames.filter(x => typeof x === 'string')
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Warn when config is world-readable — the file carries an API key. */
export function configPermissionWarning(path: string): string | null {
  try {
    const st = statSync(path);
    const mode = st.mode & 0o777;
    if (mode & 0o044) {
      return `${path} is world/group-readable (mode ${mode.toString(8)}) — chmod 600 recommended`;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Notification payload ────────────────────────────────────────

export interface PushcutNotificationAction {
  /** Button label shown in the notification. */
  name: string;
  /** URL opened on tap (Safari / any custom scheme). */
  url?: string;
  /** iOS Shortcut name to run on tap. */
  shortcut?: string;
  /** Arbitrary input passed to the shortcut. */
  input?: string;
  /** Mark as destructive (red) or authentication (blue). */
  keepNotification?: boolean;
}

export interface PushcutNotification {
  title?: string;
  text?: string;
  image?: string;
  sound?: string;
  input?: string;
  actions?: PushcutNotificationAction[];
  devices?: string[];
  /** Set when the Shortcut should return a value via callback. */
  defaultAction?: PushcutNotificationAction;
}

export interface PushcutSendResult {
  ok: boolean;
  reason?: string;
  httpStatus?: number;
  body?: string;
}

// ─── Client ──────────────────────────────────────────────────────

export interface PushcutClient {
  readonly configured: boolean;
  /** Trigger a notification by name. Returns {ok,false,reason:…} if
   *  the name isn't on the allowlist OR config is missing. */
  notify(name: string, payload: PushcutNotification): Promise<PushcutSendResult>;
  /** Execute a Pushcut-side action (opens URL / runs Shortcut)
   *  without showing a notification. */
  execute(
    action: 'openUrl' | 'runShortcut',
    payload: { url?: string; shortcut?: string; input?: string },
  ): Promise<PushcutSendResult>;
}

export interface PushcutClientDeps {
  config?: PushcutConfig | null;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** For tests — override logical "now" (unused by MVP). */
  now?: () => number;
}

export function createPushcutClient(deps: PushcutClientDeps = {}): PushcutClient {
  const config = deps.config !== undefined ? deps.config : loadPushcutConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const configured = !!config?.apiKey;

  const post = async (path: string, body: unknown): Promise<PushcutSendResult> => {
    if (!configured || !config) return { ok: false, reason: 'pushcut-not-configured' };
    try {
      const res = await fetchImpl(`${PUSHCUT_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-Key': config.apiKey,
        },
        body: JSON.stringify(body ?? {}),
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) return { ok: false, reason: `http-${res.status}`, httpStatus: res.status, body: text };
      return { ok: true, httpStatus: res.status, body: text };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };

  return {
    configured,
    async notify(name, payload) {
      if (!configured || !config) return { ok: false, reason: 'pushcut-not-configured' };
      if (!name) return { ok: false, reason: 'empty-notification-name' };
      if (config.allowedNotificationNames && !config.allowedNotificationNames.includes(name)) {
        return { ok: false, reason: `notification-not-allowed: ${name}` };
      }
      const devices = payload.devices ?? config.defaultDeviceIds;
      const finalBody: Record<string, unknown> = { ...payload };
      if (devices && devices.length > 0) finalBody.devices = devices;
      return post(`/notifications/${encodeURIComponent(name)}`, finalBody);
    },
    async execute(action, payload) {
      if (!configured || !config) return { ok: false, reason: 'pushcut-not-configured' };
      if (action === 'openUrl') {
        if (!payload.url) return { ok: false, reason: 'missing-url' };
        return post('/execute', { type: 'openUrl', url: payload.url });
      }
      if (action === 'runShortcut') {
        if (!payload.shortcut) return { ok: false, reason: 'missing-shortcut' };
        return post('/execute', {
          type: 'runShortcut',
          shortcut: payload.shortcut,
          input: payload.input,
        });
      }
      return { ok: false, reason: 'unknown-action' };
    },
  };
}

// Singleton — dashboard wires via initPushcutClient at startup.
let _singleton: PushcutClient | null = null;

export function initPushcutClient(deps?: PushcutClientDeps): PushcutClient {
  _singleton = createPushcutClient(deps);
  return _singleton;
}

export function getPushcutClient(): PushcutClient {
  if (!_singleton) _singleton = createPushcutClient();
  return _singleton;
}

export function _resetPushcutClientForTesting(): void {
  _singleton = null;
}
