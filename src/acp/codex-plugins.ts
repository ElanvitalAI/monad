// PLAN-codex-app-server-hermes-parity §5 Phase H2·1 (2026-05-16) —
// query codex app-server's `plugin/list` RPC and project the response
// into the minimal shape the BackendPickerChip sub-chips need. Mirror
// of Hermes hermes_cli/codex_runtime_plugin_migration.py:450
// (`_query_codex_plugins`) ported to TS.
//
// Response shape (codex 0.130.0):
//   { marketplaces: [{ name, plugins: [{ name, installed, availability, enabled }] }] }
// Filter:
//   installed === true && (availability === 'AVAILABLE' || availability missing)
// Output:
//   [{ name, marketplace, enabled }]
//
// Results are cached per client with a 5-minute TTL. Codex
// installations don't churn quickly and a BackendPickerChip re-render
// should not trigger a fresh RPC roundtrip every time.

import type { CodexAppServerClient } from './codex-app-server-client.js';

export interface CodexPlugin {
  /** Plugin slug as reported by codex (e.g. "gmail", "google-calendar"). */
  name: string;
  /** Marketplace identifier (e.g. "openai-curated"). */
  marketplace: string;
  /** Whether codex has the plugin enabled. Defaults to true for installed
   *  plugins per Hermes parity. */
  enabled: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  plugins: ReadonlyArray<CodexPlugin>;
}

const cache = new WeakMap<CodexAppServerClient, CacheEntry>();

export interface FetchCodexPluginsOpts {
  /** Override the clock for testing. Default `Date.now`. */
  now?: () => number;
  /** Skip the cache and force a fresh RPC. Default false. */
  noCache?: boolean;
}

/** Query codex `plugin/list` and project the response into the
 *  BackendPickerChip-ready shape. Cached per client for 5 min.
 *
 *  Returns an empty array when:
 *    - `client` is null/undefined (no active codex session)
 *    - the RPC throws (timeout / closed / codex error) — soft-fail
 *      with stale cache if available, otherwise [] */
export async function fetchCodexPlugins(
  client: CodexAppServerClient | null | undefined,
  opts: FetchCodexPluginsOpts = {},
): Promise<ReadonlyArray<CodexPlugin>> {
  if (!client) return [];
  const now = opts.now ?? Date.now;
  const t = now();
  if (!opts.noCache) {
    const cached = cache.get(client);
    if (cached && cached.expiresAt > t) return cached.plugins;
  }
  let resp: unknown;
  try {
    resp = await client.request<Record<string, never>, unknown>('plugin/list', {});
  } catch {
    const cached = cache.get(client);
    return cached?.plugins ?? [];
  }
  const plugins = parseCodexPluginsResponse(resp);
  cache.set(client, { expiresAt: t + CACHE_TTL_MS, plugins });
  return plugins;
}

/** Pure projector — exported for unit tests so we can assert the
 *  filter logic without touching the RPC client. */
export function parseCodexPluginsResponse(
  resp: unknown,
): ReadonlyArray<CodexPlugin> {
  if (!resp || typeof resp !== 'object') return [];
  const marketplaces = (resp as { marketplaces?: unknown }).marketplaces;
  if (!Array.isArray(marketplaces)) return [];
  const seen = new Set<string>();
  const out: CodexPlugin[] = [];
  for (const m of marketplaces) {
    if (!m || typeof m !== 'object') continue;
    const market = m as Record<string, unknown>;
    const marketName =
      typeof market.name === 'string' && market.name.length > 0
        ? market.name
        : 'openai-curated';
    const plugins = market.plugins;
    if (!Array.isArray(plugins)) continue;
    for (const raw of plugins) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      if (p.installed !== true) continue;
      const availabilityRaw =
        typeof p.availability === 'string' ? p.availability : '';
      const availability = availabilityRaw.toUpperCase();
      if (availability.length > 0 && availability !== 'AVAILABLE') continue;
      const name = typeof p.name === 'string' ? p.name : '';
      if (name.length === 0) continue;
      const key = `${name}@${marketName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        marketplace: marketName,
        enabled: p.enabled !== false,
      });
    }
  }
  return out;
}

/** Test helper — drop the cache entry for a specific client. */
export function clearCodexPluginsCache(client: CodexAppServerClient): void {
  cache.delete(client);
}
