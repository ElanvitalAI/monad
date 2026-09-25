// User-intent OTel sink — cascade-zyu W2 U1.
// Wraps the in-process OtelGenAISink (MSS) so UserIntentEvent records flow to
// the same OTLP collector as `llm.*` traces. Opt-in via `MSS_USER_INTENT_OTEL=1`.

import type { UserIntentEvent } from '../types.js';
import type { UserIntentSink } from '../logger.js';

export interface UserIntentOtelSinkOptions {
  /** OTLP/HTTP endpoint — typically `http://collector:4318/v1/logs`. */
  endpoint: string;
  /** `service.name` resource attribute. Default `monad-agent`. */
  serviceName?: string;
  /** HTTP delivery override (test seam). */
  send?: (body: string) => Promise<void>;
}

const DEFAULT_SERVICE_NAME = 'monad-agent';

async function defaultSend(endpoint: string, body: string): Promise<void> {
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function buildOtlpLog(event: UserIntentEvent, serviceName: string): unknown {
  return {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
          { key: 'monad.monad_id', value: { stringValue: event.monad_id } },
          ...(event.session_id
            ? [{ key: 'monad.session_id', value: { stringValue: event.session_id } }]
            : []),
        ],
      },
      scopeLogs: [{
        scope: { name: 'monad.user-intent' },
        logRecords: [{
          timeUnixNano: String(BigInt(new Date(event.ts).getTime()) * 1_000_000n),
          severityText: 'INFO',
          body: { stringValue: event.intent.kind },
          attributes: [
            { key: 'user_intent.surface', value: { stringValue: event.surface } },
            { key: 'user_intent.layer', value: { stringValue: event.intent.layer } },
            { key: 'user_intent.kind', value: { stringValue: event.intent.kind } },
            { key: 'user_intent.event_id', value: { stringValue: event.event_id } },
            ...(event.trace_id
              ? [{ key: 'trace_id', value: { stringValue: event.trace_id } }]
              : []),
          ],
        }],
      }],
    }],
  };
}

/** Build a UserIntentSink that emits OTLP log records. Returns null when
 *  the endpoint is unset so callers don't have to inline the env check. */
export function buildOtelUserIntentSink(
  opts: UserIntentOtelSinkOptions | null,
): UserIntentSink | null {
  if (!opts || !opts.endpoint) return null;
  const send = opts.send ?? ((body: string) => defaultSend(opts.endpoint, body));
  const serviceName = opts.serviceName ?? DEFAULT_SERVICE_NAME;
  return {
    name: 'otel',
    write(event) {
      try {
        const payload = buildOtlpLog(event, serviceName);
        void send(JSON.stringify(payload)).catch(() => { /* silent drop */ });
      } catch { /* never throw — sinks are best-effort */ }
    },
  };
}

/** Read the opt-in env vars and produce a sink (or null when disabled). */
export function bootOtelUserIntentSinkFromEnv(env: NodeJS.ProcessEnv): UserIntentSink | null {
  if (env.MSS_USER_INTENT_OTEL !== '1') return null;
  const endpoint = env.MSS_OTEL_ENDPOINT?.trim();
  if (!endpoint) return null;
  return buildOtelUserIntentSink({
    endpoint,
    ...(env.MSS_OTEL_SERVICE_NAME ? { serviceName: env.MSS_OTEL_SERVICE_NAME } : {}),
  });
}
