// Node-catalog N4.3 (2026-05-11) — HTTP request executor.
//
// v1: method/url/headers/body + basic + bearer auth. Native `fetch`,
// no new dep. Output is parsed JSON when the response's content-type
// starts with `application/json`; raw text otherwise. `ok` mirrors
// the HTTP status (< 400 = success). On non-2xx the partial response
// body is preserved on `output` so downstream `$node.output` reads
// still surface the server's error message.
//
// `url`, `headers.*`, and `body` are interpolated through the
// standard variable surface so authors can chain calls:
//
//   http:
//     method: GET
//     url: https://api.example.com/users/$detect.output.userId
//     headers: { Accept: 'application/json' }

import type {
  HttpRequestNode,
  NodeExecContext,
  NodeOutput,
  WorkflowDeps,
} from '../types.js';
import { interpolate } from '../variables.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Pure: encode `basic` auth as `Authorization: Basic <base64>`.
 *  Exposed for unit tests. Uses Node's globalThis Buffer when
 *  available, otherwise falls back to btoa. */
export function basicAuthHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(raw, 'utf8').toString('base64')
      : btoa(raw);
  return `Basic ${encoded}`;
}

export async function executeHttpRequestNode(
  node: HttpRequestNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const interpCtx = {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  };

  const url = interpolate(node.http.url, interpCtx).text;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.http.headers ?? {})) {
    headers[k] = interpolate(v, interpCtx).text;
  }
  if (node.http.auth) {
    if (node.http.auth.type === 'basic') {
      headers['Authorization'] = basicAuthHeader(
        node.http.auth.username,
        node.http.auth.password,
      );
    } else if (node.http.auth.type === 'bearer') {
      headers['Authorization'] = `Bearer ${node.http.auth.token}`;
    }
  }

  const body = node.http.body !== undefined ? interpolate(node.http.body, interpCtx).text : undefined;

  // Compose abort signal from the optional run signal + per-node
  // timeout. AbortSignal.timeout() is supported on Node 18+ and all
  // modern browsers; we combine with `any` when both are present.
  const timeout = node.http.timeout ?? node.idle_timeout ?? DEFAULT_TIMEOUT_MS;
  const signals: AbortSignal[] = [];
  if (ctx.signal) signals.push(ctx.signal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AS = (AbortSignal as unknown) as { timeout?: (ms: number) => AbortSignal; any?: (s: AbortSignal[]) => AbortSignal };
  if (AS.timeout) signals.push(AS.timeout(timeout));
  const signal = signals.length === 0 ? undefined
    : signals.length === 1 ? signals[0]
      : AS.any ? AS.any(signals) : signals[0];

  let response: Response;
  try {
    response = await fetch(url, {
      method: node.http.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  let parsedBody: unknown;
  if (contentType.toLowerCase().startsWith('application/json')) {
    try {
      parsedBody = await response.json();
    } catch (err) {
      return {
        ok: false,
        output: '',
        error: `http: response content-type=application/json but body failed to parse: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationMs: Date.now() - startedAt,
      };
    }
  } else {
    parsedBody = await response.text();
  }

  const ok = response.status < 400;
  return {
    ok,
    output: parsedBody,
    ...(ok ? {} : { error: `http ${response.status} ${response.statusText}` }),
    durationMs: Date.now() - startedAt,
  };
}
