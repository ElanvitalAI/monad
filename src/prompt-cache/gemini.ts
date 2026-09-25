// Gemini context-cache REST client (Phase 1 primitive).
//
// Google Gemini's prompt cache is server-side: POST the system
// instructions + tools + frequently-reused content to
// `/v1beta/cachedContents`, receive a `name` back, then reference
// that name via `cachedContent: <name>` in subsequent generation
// requests. TTL is explicit (default 1h, max 48h) and the server
// charges for storage.
//
// This module is a PRIMITIVE layer only — Gemini's provider in
// llm.ts currently uses the OpenAI-compatible `chat/completions`
// endpoint, which does NOT honor cachedContent references. Wiring
// the native endpoint is a Phase 2 task (requires switching
// GeminiProvider to a different wire format). Until then, callers
// (skill helpers, agent runs) can use this module directly to
// create / inspect / delete caches manually.
//
// API surface:
//   createGeminiCache  — POST /v1beta/cachedContents
//   getGeminiCache     — GET  /v1beta/<name>
//   listGeminiCaches   — GET  /v1beta/cachedContents
//   deleteGeminiCache  — DELETE /v1beta/<name>
//
// All functions take apiKey explicitly (no ambient getGeminiApiKey
// call) so tests can pass a stub and real callers can route via
// whichever config layer they prefer.
//
// Errors: every fn catches fetch-level failures and returns `null`
// (or throws a typed GeminiCacheError for structured failures).

import { GEMINI_NATIVE_API_URL } from '../config.js';

export type GeminiCacheTTL = '5m' | '1h' | '24h' | '48h';

/** TTL tier → seconds (Gemini accepts `{seconds, nanos}` form). */
const TTL_SECONDS: Record<GeminiCacheTTL, number> = {
  '5m': 300,
  '1h': 3600,
  '24h': 86400,
  '48h': 172800,
};

export interface CreateGeminiCacheOpts {
  apiKey: string;
  model: string;                              // e.g. "models/gemini-2.5-flash"
  /** Plain system instructions — we wrap into the Gemini
   *  `systemInstruction` shape internally. */
  system?: string;
  /** OpenAI-style tool list — we translate on the way out. */
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
  /** Contents (conversation) to include in the prefix. When used
   *  alone (no system / tools) the cache captures a document the
   *  session will reference repeatedly. */
  contents?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  ttl?: GeminiCacheTTL;                       // default '1h'
  displayName?: string;
  /** Override the REST base URL (test injection). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface GeminiCacheRecord {
  name: string;
  displayName?: string;
  model?: string;
  createTime?: string;
  updateTime?: string;
  expireTime?: string;
  usageMetadata?: {
    totalTokenCount?: number;
  };
}

export class GeminiCacheError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Gemini cache API ${status}: ${body.slice(0, 200)}`);
    this.name = 'GeminiCacheError';
  }
}

function ensureModelPath(model: string): string {
  // Gemini REST expects `models/<id>`. Accept both bare id and
  // already-prefixed form so callers don't have to remember.
  return model.startsWith('models/') ? model : `models/${model}`;
}

function buildCreateBody(opts: CreateGeminiCacheOpts): Record<string, unknown> {
  const ttl = opts.ttl ?? '1h';
  const body: Record<string, unknown> = {
    model: ensureModelPath(opts.model),
    ttl: `${TTL_SECONDS[ttl]}s`,
  };
  if (opts.displayName) body['displayName'] = opts.displayName;
  if (opts.system) {
    body['systemInstruction'] = { parts: [{ text: opts.system }] };
  }
  if (opts.tools && opts.tools.length > 0) {
    body['tools'] = [{
      functionDeclarations: opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];
  }
  if (opts.contents && opts.contents.length > 0) {
    body['contents'] = opts.contents;
  }
  return body;
}

/** Create a new cachedContents entry. Returns the server's record
 *  on 2xx, null on transport failure. Throws GeminiCacheError on
 *  non-2xx responses. */
export async function createGeminiCache(
  opts: CreateGeminiCacheOpts,
): Promise<GeminiCacheRecord | null> {
  const base = opts.baseUrl ?? GEMINI_NATIVE_API_URL;
  const url = `${base}/cachedContents?key=${encodeURIComponent(opts.apiKey)}`;
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCreateBody(opts)),
    });
  } catch { return null; }
  if (!res.ok) {
    throw new GeminiCacheError(res.status, await res.text().catch(() => ''));
  }
  return (await res.json()) as GeminiCacheRecord;
}

export interface GetGeminiCacheOpts {
  apiKey: string;
  name: string;                                // full "cachedContents/<id>"
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function getGeminiCache(
  opts: GetGeminiCacheOpts,
): Promise<GeminiCacheRecord | null> {
  const base = opts.baseUrl ?? GEMINI_NATIVE_API_URL;
  const url = `${base}/${opts.name}?key=${encodeURIComponent(opts.apiKey)}`;
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: 'GET' });
  } catch { return null; }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GeminiCacheError(res.status, await res.text().catch(() => ''));
  }
  return (await res.json()) as GeminiCacheRecord;
}

export interface ListGeminiCachesOpts {
  apiKey: string;
  pageSize?: number;
  pageToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ListGeminiCachesResult {
  cachedContents: GeminiCacheRecord[];
  nextPageToken?: string;
}

export async function listGeminiCaches(
  opts: ListGeminiCachesOpts,
): Promise<ListGeminiCachesResult | null> {
  const base = opts.baseUrl ?? GEMINI_NATIVE_API_URL;
  const params = new URLSearchParams({ key: opts.apiKey });
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const url = `${base}/cachedContents?${params.toString()}`;
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: 'GET' });
  } catch { return null; }
  if (!res.ok) {
    throw new GeminiCacheError(res.status, await res.text().catch(() => ''));
  }
  const body = await res.json() as { cachedContents?: GeminiCacheRecord[]; nextPageToken?: string };
  return {
    cachedContents: body.cachedContents ?? [],
    nextPageToken: body.nextPageToken,
  };
}

export interface DeleteGeminiCacheOpts {
  apiKey: string;
  name: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function deleteGeminiCache(
  opts: DeleteGeminiCacheOpts,
): Promise<boolean> {
  const base = opts.baseUrl ?? GEMINI_NATIVE_API_URL;
  const url = `${base}/${opts.name}?key=${encodeURIComponent(opts.apiKey)}`;
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: 'DELETE' });
  } catch { return false; }
  if (res.status === 404) return false;          // already gone is fine
  if (!res.ok) {
    throw new GeminiCacheError(res.status, await res.text().catch(() => ''));
  }
  return true;
}

// ── Body-builder export for testing ────────────────────────────────

/** Exported for unit tests — lets them assert the exact wire shape
 *  without spinning up a mock server. */
export { buildCreateBody as _buildCreateBody };
