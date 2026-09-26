// SSH host config — T4-E1.
//
// The fleet is «configuration», not code: the list lives in
// ~/.elanous/ssh-hosts.json (or $ELANOUS_SSH_HOSTS_PATH). With no file the
// fleet is empty — a new install must not try to reach someone else's
// machines. (2026-09-25 public-release cleanup: the five hosts that used
// to be hard-coded here moved into the owner's own ssh-hosts.json.)
//
// Shape of the JSON file (all fields optional except name + host):
//
//   {
//     "hosts": [
//       { "name": "mba",    "host": "mba",    "description": "M2 Air" },
//       { "name": "studio", "host": "studio.tailnet-example.ts.net", "user": "me",
//         "roles": ["llm", "media"] }
//     ]
//   }
//
// `roles` is optional. Known roles: `llm` (runs an OpenAI-compatible local
// LLM on :1234 — community-buzz uses it) and `media` (runs the MLX media
// models the video pipeline calls over ssh).
//
// Last-used-at is tracked in memory (bumped on each connect) so the
// Ctrl+K picker can sort most-recent first without needing a persisted
// mtime.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import { normalizeInputQuery } from '../input/query-match.js';
import { migrateLegacyHomeFile } from '../storage/legacy-elanous-dir-migrate.js';

export interface SshHost {
  name: string;
  host: string;
  user?: string;
  description?: string;
  roles?: string[];
}

export interface SshHostWithRuntime extends SshHost {
  lastUsedAt: number;
}

/** Empty on purpose — the fleet comes from ssh-hosts.json. Kept as an
 *  export so callers that compare against «the default» still compile. */
export const DEFAULT_HOSTS: readonly SshHost[] = Object.freeze([]);

let configPathOverride: string | null = null;
const lastUsedAt = new Map<string, number>();
let cachedList: SshHost[] | null = null;
let testHosts: SshHost[] | null = null;

// FU2 Tier 2: ~/.config/monad-agent/ssh-hosts.json → ~/.elanous/ssh-hosts.json.
function defaultConfigPath(): string {
  const explicit = process.env['ELANOUS_SSH_HOSTS_PATH']?.trim();
  if (explicit) return explicit;
  const xdg = process.env['XDG_CONFIG_HOME']?.trim();
  if (xdg) return joinPath(xdg, 'monad-agent', 'ssh-hosts.json');
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'ssh-hosts.json'),
    elanousRel: 'ssh-hosts.json',
  });
  return joinPath(homedir(), '.elanous', 'ssh-hosts.json');
}

function configPath(): string {
  return configPathOverride ?? defaultConfigPath();
}

export function setSshHostsPathForTesting(path: string | null): void {
  configPathOverride = path;
  cachedList = null;
  lastUsedAt.clear();
}

/** Tests: the fleet to use when no ssh-hosts.json is present (in place of
 *  the empty DEFAULT_HOSTS). A present file still wins. `null` clears it. */
export function setSshHostsForTesting(hosts: readonly SshHost[] | null): void {
  testHosts = hosts ? hosts.map((h) => ({ ...h })) : null;
  cachedList = null;
  lastUsedAt.clear();
}

function parseConfigBody(raw: string): SshHost[] | null {
  try {
    const parsed = JSON.parse(raw) as { hosts?: unknown };
    if (!Array.isArray(parsed.hosts)) return null;
    const out: SshHost[] = [];
    for (const e of parsed.hosts) {
      if (!e || typeof e !== 'object') continue;
      const rec = e as Record<string, unknown>;
      if (typeof rec.name !== 'string' || !rec.name.trim()) continue;
      if (typeof rec.host !== 'string' || !rec.host.trim()) continue;
      const entry: SshHost = { name: rec.name.trim(), host: rec.host.trim() };
      if (typeof rec.user === 'string' && rec.user.trim()) entry.user = rec.user.trim();
      if (typeof rec.description === 'string') entry.description = rec.description;
      if (Array.isArray(rec.roles)) {
        const roles = rec.roles.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map((r) => r.trim());
        if (roles.length > 0) entry.roles = roles;
      }
      out.push(entry);
    }
    return out;
  } catch {
    return null;
  }
}

function fallbackHosts(): SshHost[] {
  return (testHosts ?? DEFAULT_HOSTS).map((h) => ({ ...h }));
}

/** List configured SSH hosts. Reads ~/.elanous/ssh-hosts.json (or
 *  $ELANOUS_SSH_HOSTS_PATH) if present; otherwise returns DEFAULT_HOSTS (empty). Results are memoized
 *  in-process. Call `_resetSshHostsForTesting()` between cases. */
export function listSshHosts(): SshHost[] {
  if (cachedList) return cachedList.slice();
  const path = configPath();
  if (!existsSync(path)) {
    cachedList = fallbackHosts();
    return cachedList.slice();
  }
  try {
    const body = readFileSync(path, 'utf-8');
    const parsed = parseConfigBody(body);
    if (parsed && parsed.length > 0) {
      cachedList = parsed;
      return cachedList.slice();
    }
  } catch { /* fall through */ }
  cachedList = fallbackHosts();
  return cachedList.slice();
}

/** Hosts that declare `role` in ssh-hosts.json, in configured order. */
export function sshHostsWithRole(role: string): SshHost[] {
  return listSshHosts().filter((h) => h.roles?.includes(role));
}

/** The ssh host the video pipeline sends MLX media jobs to:
 *  $ELANOUS_MEDIA_HOST, else the first host with role `media`, else null. */
export function mediaSshHost(): string | null {
  const env = process.env['ELANOUS_MEDIA_HOST']?.trim();
  if (env) return env;
  const h = sshHostsWithRole('media')[0];
  return h ? h.host : null;
}

/** Look up a single host by name (case-insensitive). Returns null
 *  when unknown. */
export function findSshHost(name: string): SshHost | null {
  const needle = normalizeInputQuery(name);
  return listSshHosts().find(h => h.name.toLowerCase() === needle) ?? null;
}

/** Record a host connection timestamp. Last-used-at ordering is
 *  used by the picker modal. */
export function touchSshHost(name: string, now: number = Date.now()): void {
  lastUsedAt.set(name.toLowerCase(), now);
}

/** Snapshot of hosts ordered by most-recent use first; ties fall
 *  back to the configured order. Hosts without a recorded timestamp
 *  sort after any touched host.
 *
 *  The `_now` parameter is kept in the signature as a forward-compat
 *  seam (decay-since-now scoring) but never read by the v1 sort.
 *  Underscore prefix tells the TS lint the parameter is intentionally
 *  unused — call sites that already pass `Date.now()` keep working
 *  without churn. FU8 PR #6 (2026-05-12). */
export function listSshHostsByRecency(_now: number = Date.now()): SshHostWithRuntime[] {
  const hosts = listSshHosts();
  const withRuntime = hosts.map((h, i): SshHostWithRuntime & { __ord: number } => ({
    ...h,
    lastUsedAt: lastUsedAt.get(h.name.toLowerCase()) ?? 0,
    __ord: i,
  }));
  withRuntime.sort((a, b) => {
    if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    return a.__ord - b.__ord;
  });
  return withRuntime.map(({ __ord, ...rest }) => rest);
}

/** Test reset. */
export function _resetSshHostsForTesting(): void {
  cachedList = null;
  testHosts = null;
  lastUsedAt.clear();
  configPathOverride = null;
}
