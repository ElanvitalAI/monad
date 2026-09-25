// FU.A3 (2026-05-09 night) — Multi-host config hot-reload endpoint.
//
// `GET /v1/llm/hosts` — return the effective host config + source
// label ('override' | 'env' | 'legacy'). apiKey fields are masked
// before serialisation so the response never echoes a secret.
//
// `PUT /v1/llm/hosts` — accept a JSON body with the same shape as
// `MONAD_LLM_HOSTS` and store it as the in-memory override. Validates
// via `parseLlmHostsEnv` so the same parser rules apply (named hosts,
// known kinds, non-empty endpoint, optional apiKey).
//
// `DELETE /v1/llm/hosts` — clear the override. Subsequent
// `GET /v1/llm/models` requests revert to env / legacy.
//
// Security
// - All three methods require `checkAuth` (mutation block · production
//   wiring identical to other settings endpoints).
// - PUT body containing apiKey is honoured but never echoed back. The
//   GET response replaces apiKey with `'[redacted]'` so audit / debug
//   traces stay safe.
// - 401 → unauthorised · 400 → invalid body · 200 → success.

import {
  type LlmHostConfig,
  type LlmHostsSource,
  getEffectiveHosts,
  parseLlmHostsEnv,
  setHostsOverride,
} from './llm-hosts.js';

export interface LlmHostsConfigRouteOpts {
  /** Auth gate — production caller (settings endpoint conventions). */
  checkAuth?: (req: Request) => boolean;
}

interface SerialisedHost {
  name: string;
  kind: string;
  endpoint: string;
  /** When the host has an apiKey, the response surfaces a fixed
   *  redacted marker instead of the value. Absent when no key is
   *  configured (anthropic without apiKey + ANTHROPIC_API_KEY env
   *  both unset · or non-anthropic kinds). */
  apiKey?: '[redacted]';
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
    },
  });
}

/** Strip apiKey from each host. Marks the entry as "key configured"
 *  via a fixed redaction marker so dropdown UI can decide whether to
 *  show "key set" vs "missing-api-key" without seeing the value. */
function serialiseHosts(hosts: LlmHostConfig[]): SerialisedHost[] {
  return hosts.map((h) => {
    const out: SerialisedHost = {
      name: h.name,
      kind: h.kind,
      endpoint: h.endpoint,
    };
    if (h.apiKey && h.apiKey.length > 0) out.apiKey = '[redacted]';
    return out;
  });
}

export async function handleLlmHostsConfig(
  req: Request,
  opts: LlmHostsConfigRouteOpts = {},
): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return corsPreflight();
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  if (method === 'GET') {
    const eff = getEffectiveHosts();
    const body: {
      ok: true;
      source: LlmHostsSource;
      count: number;
      hosts: SerialisedHost[];
      parseError?: string;
      deprecations?: string[];
    } = {
      ok: true,
      source: eff.source,
      count: eff.hosts.length,
      hosts: serialiseHosts(eff.hosts),
    };
    if (eff.parseError !== undefined) body.parseError = eff.parseError;
    if (eff.deprecations !== undefined && eff.deprecations.length > 0) {
      body.deprecations = eff.deprecations;
    }
    return jsonResponse(body, 200);
  }

  if (method === 'PUT') {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      return jsonResponse({
        error: 'invalid-json',
        detail: e instanceof Error ? e.message : String(e),
      }, 400);
    }
    if (!Array.isArray(raw)) {
      return jsonResponse({
        error: 'invalid-body',
        detail: 'body must be a JSON array of host configs',
      }, 400);
    }
    // Round-trip via parseLlmHostsEnv so the same rules / parseError
    // semantics apply. Empty result → reject (no point setting an
    // empty override).
    const parsed = parseLlmHostsEnv(JSON.stringify(raw));
    // parseLlmHostsEnv returns the legacy default when input has 0
    // valid hosts — reject that explicitly so the caller gets a clear
    // 400 instead of silently keeping the default.
    if (parsed.parseError && parsed.hosts.length === 1 && parsed.hosts[0]?.name === 'local') {
      return jsonResponse({
        error: 'no-valid-hosts',
        detail: parsed.parseError,
      }, 400);
    }
    setHostsOverride(parsed.hosts);
    const body: {
      ok: true;
      source: 'override';
      count: number;
      hosts: SerialisedHost[];
      parseError?: string;
      deprecations?: string[];
    } = {
      ok: true,
      source: 'override',
      count: parsed.hosts.length,
      hosts: serialiseHosts(parsed.hosts),
    };
    if (parsed.parseError !== undefined) body.parseError = parsed.parseError;
    if (parsed.deprecations !== undefined && parsed.deprecations.length > 0) {
      body.deprecations = parsed.deprecations;
    }
    return jsonResponse(body, 200);
  }

  if (method === 'DELETE') {
    setHostsOverride(null);
    const eff = getEffectiveHosts();
    return jsonResponse({
      ok: true,
      cleared: true,
      source: eff.source, // now reverts to env / legacy
      count: eff.hosts.length,
      hosts: serialiseHosts(eff.hosts),
    }, 200);
  }

  return jsonResponse({ error: 'method not allowed' }, 405);
}
