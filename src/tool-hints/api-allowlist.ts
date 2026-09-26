// API-call allowlist + rate limiter.
//
// Shared by the api_call native tool (P9) and the /api-allow slash
// command (P13). Two independent defenses:
//
// 1. Allowlist — the LLM cannot hit arbitrary URLs. Hosts must be
//    explicitly added via /api-allow or the config file. Empty list
//    by default (fail-closed).
//
// 2. Rate limiter — token bucket; caps runaway tool loops. 30 calls
//    per host per minute + 200 calls total per minute. Configurable.
//
// Storage — allowlist is file-backed (~/.config/monad-agent/
// api-allow.json) plus an in-memory session ring for /api-allow add
// without writing to disk. Rate buckets are in-process.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join as joinPath } from 'node:path';
import { migrateLegacyHomeFile } from '../storage/legacy-elanous-dir-migrate.js';

// ─── Allowlist ──────────────────────────────────────────────────

/** Per-hostname policy. The simplest form is 'allow' (wildcard). A
 *  future extension can add per-path allowlists per host — keep the
 *  entry shape open for that. */
export interface AllowEntry {
  host: string;              // lowercase hostname; '*' for any
  addedAt: number;
  reason?: string;
}

export interface AllowlistFileV1 {
  version: 1;
  entries: AllowEntry[];
}

let configPathOverride: string | null = null;
let sessionOnlyEntries: AllowEntry[] = [];
let cachedPersistent: AllowEntry[] | null = null;

// FU2 Tier 2: ~/.config/monad-agent/api-allow.json → ~/.elanous/api-allow.json.
function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return joinPath(xdg, 'monad-agent', 'api-allow.json');
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'api-allow.json'),
    elanousRel: 'api-allow.json',
  });
  return joinPath(homedir(), '.elanous', 'api-allow.json');
}

function configPath(): string {
  return configPathOverride ?? defaultConfigPath();
}

export function setAllowlistPathForTesting(path: string | null): void {
  configPathOverride = path;
  cachedPersistent = null;
  sessionOnlyEntries = [];
  rateBuckets.clear();
}

function loadPersistent(): AllowEntry[] {
  if (cachedPersistent) return cachedPersistent;
  const path = configPath();
  if (!existsSync(path)) { cachedPersistent = []; return cachedPersistent; }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      cachedPersistent = []; return cachedPersistent;
    }
    cachedPersistent = (parsed.entries as unknown[]).filter(isValidEntry) as AllowEntry[];
    return cachedPersistent;
  } catch {
    cachedPersistent = [];
    return cachedPersistent;
  }
}

function savePersistent(entries: AllowEntry[]): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const body: AllowlistFileV1 = { version: 1, entries };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
  renameSync(tmp, path);
  cachedPersistent = entries;
}

function isValidEntry(x: unknown): x is AllowEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.host === 'string' && typeof e.addedAt === 'number';
}

/** Normalize a URL-or-hostname into a lowercase hostname. Returns
 *  null for obviously broken input (IDN / port edge cases are left
 *  to the caller). */
export function hostOf(urlOrHost: string): string | null {
  const raw = urlOrHost.trim();
  if (!raw) return null;
  if (raw === '*') return '*';
  try {
    // If it parses as a URL, use the hostname. If not, treat the
    // input as a hostname itself.
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export function listAllowed(): AllowEntry[] {
  return [...loadPersistent(), ...sessionOnlyEntries];
}

export interface AddAllowOpts {
  reason?: string;
  /** When true, entry lives only for this process lifetime — handy for
   *  one-off `/api-allow add github.com` without committing to a
   *  permanent policy. */
  sessionOnly?: boolean;
}

export function addAllowed(hostOrUrl: string, opts: AddAllowOpts = {}): AllowEntry | null {
  const host = hostOf(hostOrUrl);
  if (!host) return null;
  // De-dup: same host already present in either bucket is a no-op.
  const persistent = loadPersistent();
  const existingPer = persistent.find(e => e.host === host);
  const existingSess = sessionOnlyEntries.find(e => e.host === host);
  if (existingPer) return existingPer;
  if (existingSess) return existingSess;
  const entry: AllowEntry = { host, addedAt: Date.now(), reason: opts.reason };
  if (opts.sessionOnly) {
    sessionOnlyEntries.push(entry);
  } else {
    savePersistent([...persistent, entry]);
  }
  return entry;
}

export function removeAllowed(hostOrUrl: string): boolean {
  const host = hostOf(hostOrUrl);
  if (!host) return false;
  const persistent = loadPersistent();
  const pIdx = persistent.findIndex(e => e.host === host);
  if (pIdx >= 0) {
    savePersistent(persistent.filter((_, i) => i !== pIdx));
    return true;
  }
  const sIdx = sessionOnlyEntries.findIndex(e => e.host === host);
  if (sIdx >= 0) {
    sessionOnlyEntries.splice(sIdx, 1);
    return true;
  }
  return false;
}

export function isAllowed(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const all = listAllowed();
  // '*' wildcard matches any host.
  if (all.some(e => e.host === '*')) return true;
  return all.some(e => e.host === host);
}

// ─── Rate limiter ───────────────────────────────────────────────

interface Bucket {
  // Ring of timestamps (ms) for the last N calls. Trimmed on check.
  calls: number[];
}

const WINDOW_MS = 60_000;
const DEFAULT_PER_HOST_LIMIT = 30;
const DEFAULT_GLOBAL_LIMIT = 200;

let perHostLimit = DEFAULT_PER_HOST_LIMIT;
let globalLimit = DEFAULT_GLOBAL_LIMIT;
const rateBuckets = new Map<string, Bucket>();
const globalBucket: Bucket = { calls: [] };

export function setRateLimitsForTesting(opts: { perHost?: number; global?: number } = {}): void {
  perHostLimit = opts.perHost ?? DEFAULT_PER_HOST_LIMIT;
  globalLimit = opts.global ?? DEFAULT_GLOBAL_LIMIT;
  rateBuckets.clear();
  globalBucket.calls = [];
}

/** Check-and-consume — returns true if the call is within budget and
 *  deducts one token. Returns false without deducting when either
 *  bucket is full. */
export function consumeRateToken(url: string, now: number = Date.now()): { ok: true } | { ok: false; reason: string } {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: 'invalid url' };
  const windowStart = now - WINDOW_MS;

  // Trim the global bucket first.
  globalBucket.calls = globalBucket.calls.filter(ts => ts > windowStart);
  if (globalBucket.calls.length >= globalLimit) {
    return { ok: false, reason: `global rate limit reached (${globalLimit}/min)` };
  }

  let bucket = rateBuckets.get(host);
  if (!bucket) { bucket = { calls: [] }; rateBuckets.set(host, bucket); }
  bucket.calls = bucket.calls.filter(ts => ts > windowStart);
  if (bucket.calls.length >= perHostLimit) {
    return { ok: false, reason: `per-host rate limit reached for ${host} (${perHostLimit}/min)` };
  }

  bucket.calls.push(now);
  globalBucket.calls.push(now);
  return { ok: true };
}

/** Inspect remaining budget without consuming. */
export function rateLimitStatus(url: string, now: number = Date.now()): { hostRemaining: number; globalRemaining: number } {
  const host = hostOf(url);
  const windowStart = now - WINDOW_MS;
  const global = globalBucket.calls.filter(ts => ts > windowStart).length;
  const hostCalls = host ? rateBuckets.get(host)?.calls.filter(ts => ts > windowStart).length ?? 0 : 0;
  return {
    hostRemaining: Math.max(0, perHostLimit - hostCalls),
    globalRemaining: Math.max(0, globalLimit - global),
  };
}
