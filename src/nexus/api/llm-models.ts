// micro.3 (2026-05-09) — LLM model list proxy.
// FU.A1 (2026-05-09 night) — Multi-host resolver (LM Studio · vLLM ·
// Ollama). Configure via `ELANOUS_LLM_HOSTS` JSON. Backward-compat:
// `ELANOUS_LLM_MODELS_ENDPOINT` still works as the single-host default.
//
// `GET /v1/llm/models` — fans out to all configured hosts in
// parallel and surfaces aggregated models + per-host status. The
// Showroom header dropdown reads this so users can pick a non-default
// model without DevTools localStorage editing, grouped by host.

import {
  type LlmHostConfig,
  type LlmHostFetchResult,
  type LlmHostModel,
  fetchAllHosts,
  getEffectiveHosts,
  resolveLegacyEndpoint,
} from './llm-hosts.js';

export interface LlmModelsRouteOpts {
  /** Optional auth gate — production caller. */
  checkAuth?: (req: Request) => boolean;
  /** Override the LM Studio base URL (single-host shortcut for
   *  legacy callers / tests). When `ELANOUS_LLM_HOSTS` is set the env
   *  config takes precedence. */
  endpoint?: string;
  /** Override the host config directly (test convenience — bypasses
   *  env parsing). */
  hosts?: LlmHostConfig[];
  /** Hard wall-clock cap per host. Default 1500ms — `/v1/models` and
   *  `/api/tags` are directory reads on the host side (sub-50ms typical). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

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
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
    },
  });
}

/** Legacy single-host endpoint resolver. Kept exported for tests
 *  that pre-date the multi-host fan-out. */
export function resolveLlmModelsEndpoint(opts: LlmModelsRouteOpts): string {
  const env = process.env.ELANOUS_LLM_MODELS_ENDPOINT;
  if (env && env.length > 0) return env.replace(/\/+$/, '');
  return (opts.endpoint ?? 'http://localhost:1234/v1').replace(/\/+$/, '');
}

/** Pick the host config: explicit opts.hosts > in-memory override >
 *  ELANOUS_LLM_HOSTS env > legacy single-host. The override layer
 *  (FU.A3) lets the runtime hot-swap the config without restart. */
function resolveHosts(opts: LlmModelsRouteOpts): {
  hosts: LlmHostConfig[];
  parseError?: string;
  legacy: boolean;
} {
  if (opts.hosts && opts.hosts.length > 0) {
    return { hosts: opts.hosts, legacy: false };
  }
  // FU.A3 — runtime override > env > legacy. Honour opts.endpoint
  // only when no override AND no env (back-compat path for legacy
  // resolveLlmModelsEndpoint callers).
  const eff = getEffectiveHosts();
  if (eff.source !== 'legacy') {
    return eff.parseError !== undefined
      ? { hosts: eff.hosts, parseError: eff.parseError, legacy: false }
      : { hosts: eff.hosts, legacy: false };
  }
  // Legacy single-host fallback — opts.endpoint > legacy resolver.
  const legacyEndpoint = opts.endpoint
    ? opts.endpoint.replace(/\/+$/, '')
    : resolveLegacyEndpoint();
  const base = legacyEndpoint.endsWith('/v1')
    ? legacyEndpoint.slice(0, -3)
    : legacyEndpoint;
  return {
    hosts: [{ name: 'local', kind: 'lm-studio', endpoint: base }],
    legacy: true,
  };
}

/** Sort merged models: primary alphabetical by id, embeddings last
 *  (caller usually wants chat models). Stable across hosts so
 *  duplicate ids from multiple hosts appear adjacent for the
 *  caller's awareness. */
function sortModels(models: LlmHostModel[]): LlmHostModel[] {
  return [...models].sort((a, b) => {
    const aE = /embed/i.test(a.id) ? 1 : 0;
    const bE = /embed/i.test(b.id) ? 1 : 0;
    if (aE !== bE) return aE - bE;
    return a.id.localeCompare(b.id);
  });
}

export async function handleLlmModels(
  req: Request,
  opts: LlmModelsRouteOpts = {},
): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return corsPreflight();
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const { hosts, parseError, legacy } = resolveHosts(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results: LlmHostFetchResult[] = await fetchAllHosts(hosts, { timeoutMs });
  const merged = results.flatMap((r) => r.models);
  const sorted = sortModels(merged);

  // Surface a top-level error code if every configured host failed
  // (back-compat with single-host caller expectations: `error` set ⇒
  // dropdown should show the failure state).
  const allFailed = results.length > 0 && results.every((r) => r.error !== undefined);
  const firstError = results.find((r) => r.error)?.error;

  // Legacy `endpoint` field — preserved so existing PWA / curl callers
  // that read `endpoint` keep working. For multi-host configs we
  // expose the first host's endpoint here; the per-host detail is in
  // `hosts[]`.
  const legacyEndpoint = legacy
    ? resolveLegacyEndpoint()
    : `${hosts[0]?.endpoint ?? ''}/v1`;

  return jsonResponse({
    ok: !allFailed,
    endpoint: legacyEndpoint,
    count: sorted.length,
    models: sorted,
    hosts: results.map((r) => ({
      name: r.host,
      kind: r.kind,
      endpoint: r.endpoint,
      count: r.count,
      ...(r.error !== undefined ? { error: r.error } : {}),
    })),
    ...(allFailed ? { error: firstError ?? 'all-hosts-unreachable' } : {}),
    ...(parseError !== undefined ? { configWarning: parseError } : {}),
  }, 200);
}
