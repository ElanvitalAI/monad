import { createHash, timingSafeEqual } from 'node:crypto';
import { getOpenAiRelaySharedSecret } from '../../config.js';
import { debug } from '../../debug/log.js';
import { resolveFreshGrokCredential, type GrokCredential } from '../../grok/credential.js';

export const OPENAI_RELAY_PATH = '/v1/chat/completions';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAiRelayDeps {
  getSharedSecret?: () => string | undefined;
  resolveCredential?: () => GrokCredential | null;
  fetch?: FetchLike;
  log?: (event: string, data: Record<string, unknown>) => void;
}

function jsonResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requestModel(req: Request): Promise<string | undefined> {
  try {
    const body = await req.clone().json() as { model?: unknown };
    return typeof body.model === 'string' ? body.model : undefined;
  } catch {
    return undefined;
  }
}

function relayHeaders(credential: GrokCredential): Headers {
  const headers = new Headers(credential.headers);
  headers.set('authorization', `Bearer ${credential.token}`);
  headers.set('content-type', 'application/json');
  return headers;
}

function constantTimeSecretMatches(authorization: string | null, sharedSecret: string): boolean {
  const receivedSecret = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  const expectedDigest = createHash('sha256').update(sharedSecret).digest();
  const receivedDigest = createHash('sha256').update(receivedSecret).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
}

/**
 * Relays OpenAI-compatible chat completions only through the Grok subscription proxy.
 * Returns undefined when the route does not match so the caller may continue dispatch.
 */
export async function tryHandleOpenAiRelay(
  req: Request,
  url: URL,
  deps: OpenAiRelayDeps = {},
): Promise<Response | undefined> {
  if (url.pathname !== OPENAI_RELAY_PATH) return undefined;
  if (req.method !== 'POST') return jsonResponse('method-not-allowed', 405);

  const log = deps.log ?? ((event, data) => debug.log('nexus.openai-relay', event, data));
  const sharedSecret = (deps.getSharedSecret ?? getOpenAiRelaySharedSecret)();
  if (!sharedSecret) {
    log('rejected', { reason: 'relay-disabled' });
    return jsonResponse('relay-disabled: shared secret is not configured', 503);
  }

  const authorization = req.headers.get('authorization');
  if (!constantTimeSecretMatches(authorization, sharedSecret)) {
    log('rejected', { reason: 'invalid-authentication' });
    return jsonResponse('invalid-authentication', 401);
  }

  // ⭐ 만료를 «호출자가 기억하지 않는다» — 자격 획득 «안»에 갱신이 접혀 있는 층을 쓴다.
  //   ⛔ `resolveGrokCredential` 을 부르면 만료 토큰을 그대로 실어 보내고, 업스트림이
  //   401(PermissionDenied)을 내는데 릴레이 자신은 `forward` 로 «정상」처럼 보인다
  //   (2026-08-23 실측: /healthz 200 · 로그 forward · 그런데 본문은 만료 오류였다).
  const credential = (deps.resolveCredential ?? resolveFreshGrokCredential)();
  if (!credential || credential.kind !== 'subscription') {
    log('rejected', { reason: 'subscription-credential-required' });
    return jsonResponse('subscription-credential-required', 503);
  }

  const model = await requestModel(req);
  log('forward', { ...(model ? { model } : {}), credentialSource: credential.source });
  try {
    return await (deps.fetch ?? fetch)(`${credential.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: relayHeaders(credential),
      body: req.body,
      duplex: 'half',
    } as RequestInit);
  } catch {
    log('upstream-error', { ...(model ? { model } : {}) });
    return jsonResponse('upstream-request-failed', 502);
  }
}
