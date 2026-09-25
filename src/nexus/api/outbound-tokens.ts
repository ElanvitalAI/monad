// W7 Z11.a-1 · device token register endpoint.
//   POST   /v1/devices/tokens     — upsert a token
//   DELETE /v1/devices/tokens     — revoke a token (body = {channel, deviceId})
//   GET    /v1/devices/tokens     — counts per channel (debug)

import {
  OUTBOUND_CHANNEL_NAMES,
  type OutboundChannelName,
} from '../../showroom/outbound/types.js';
import type { DeviceTokenStore } from '../../showroom/outbound/token-store.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function isChannel(v: unknown): v is OutboundChannelName {
  return typeof v === 'string' && (OUTBOUND_CHANNEL_NAMES as readonly string[]).includes(v);
}

export interface OutboundTokenRouteOpts {
  tokenStore: DeviceTokenStore;
  checkAuth?: (req: Request) => boolean;
  now?: () => number;
}

export async function handleOutboundTokens(
  req: Request,
  opts: OutboundTokenRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const now = opts.now ?? Date.now;

  if (req.method === 'GET') {
    const counts: Record<string, number> = {};
    for (const ch of OUTBOUND_CHANNEL_NAMES) counts[ch] = opts.tokenStore.count(ch);
    return jsonResponse({ counts }, 200);
  }

  if (req.method === 'POST') {
    let body: unknown;
    try { body = await req.json(); }
    catch { return jsonResponse({ error: 'bad_request', reason: 'invalid JSON' }, 400); }
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'bad_request', reason: 'object body required' }, 400);
    }
    const b = body as Record<string, unknown>;
    if (!isChannel(b.channel)) {
      return jsonResponse({ error: 'bad_request', reason: 'channel must be a known OutboundChannelName' }, 400);
    }
    if (typeof b.deviceId !== 'string' || b.deviceId.length === 0) {
      return jsonResponse({ error: 'bad_request', reason: 'deviceId required' }, 400);
    }
    if (typeof b.token !== 'string' || b.token.length === 0) {
      return jsonResponse({ error: 'bad_request', reason: 'token required' }, 400);
    }
    opts.tokenStore.upsert({
      channel: b.channel,
      deviceId: b.deviceId,
      token: b.token,
      registeredAt: now(),
      ...(b.meta && typeof b.meta === 'object' ? { meta: b.meta as Record<string, unknown> } : {}),
    });
    return jsonResponse({ ok: true }, 200);
  }

  if (req.method === 'DELETE') {
    let body: unknown;
    try { body = await req.json(); }
    catch { return jsonResponse({ error: 'bad_request', reason: 'invalid JSON' }, 400); }
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'bad_request', reason: 'object body required' }, 400);
    }
    const b = body as Record<string, unknown>;
    if (!isChannel(b.channel) || typeof b.deviceId !== 'string') {
      return jsonResponse({ error: 'bad_request', reason: 'channel + deviceId required' }, 400);
    }
    const deleted = opts.tokenStore.delete(b.channel, b.deviceId);
    return jsonResponse({ ok: deleted }, deleted ? 200 : 404);
  }

  return jsonResponse({ error: 'method not allowed' }, 405);
}
