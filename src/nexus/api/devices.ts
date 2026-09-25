// W9c Z13-d · GET /v1/devices + POST /v1/templates/capability-preview.
// Cf. Z15.b substrate (#2441) + 내부 문서 §2 Z13-d.
//
// Two endpoints:
//   GET  /v1/devices                       — current fleet snapshot
//   POST /v1/templates/capability-preview  — resolve a template's
//                                            requires.optional + fallback
//                                            chain against the live fleet
//                                            (no template install required;
//                                             useful for marketplace preview
//                                             + UI "what would this give me?"
//                                             chips)

import {
  detectFleet,
  type DeviceCapabilitySet,
  type DeviceFleetSource,
  type DeviceKind,
} from '../../mission-templates/device-detector.js';
import {
  resolveCapabilities,
  type FallbackChainEntry,
  type OptionalRequirement,
} from '../../mission-templates/capability-resolver.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface DevicesRouteOpts {
  fleetSource: DeviceFleetSource;
  /** Override `now()` so tests are deterministic. */
  now?: () => number;
  retentionMs?: number;
  checkAuth?: (req: Request) => boolean;
}

// ⛔ 값은 «잎»이 갖는다(`rest-route-paths.ts`) — PWA 도 같은 값을 읽어야 하는데
//   이 모듈을 브라우저가 import 하면 데몬 그래프가 번들로 딸려 온다.
import { DEVICES_PATH } from './rest-route-paths.js';
export { DEVICES_PATH };
import { TEMPLATE_CAPABILITY_PREVIEW_PATH } from './rest-route-paths.js';
export { TEMPLATE_CAPABILITY_PREVIEW_PATH };

export function isDevicesPath(pathname: string): boolean {
  return pathname === DEVICES_PATH;
}

export function isTemplateCapabilityPreviewPath(pathname: string): boolean {
  return pathname === TEMPLATE_CAPABILITY_PREVIEW_PATH;
}

export async function handleDevices(
  req: Request,
  opts: DevicesRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const fleet = await detectFleet({
    source: opts.fleetSource,
    ...(opts.retentionMs !== undefined ? { retentionMs: opts.retentionMs } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return jsonResponse(snapshotFleet(fleet), 200);
}

export async function handleTemplateCapabilityPreview(
  req: Request,
  opts: DevicesRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid-json' }, 400); }

  const requirements = parseRequirements(body);
  if (!requirements) {
    return jsonResponse({ error: 'optionalRequirements-required' }, 400);
  }
  const fallbackChain = parseFallback(body);

  const fleet = await detectFleet({
    source: opts.fleetSource,
    ...(opts.retentionMs !== undefined ? { retentionMs: opts.retentionMs } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const result = resolveCapabilities({
    optionalRequirements: requirements,
    fleet,
    ...(fallbackChain !== undefined ? { fallbackChain } : {}),
  });
  return jsonResponse({
    enabled: [...result.enablement.enabled],
    degraded: [...result.enablement.degraded],
    decisions: result.enablement.decisions,
    fallbackHits: result.fallbackHits,
    fleet: snapshotFleet(fleet),
  }, 200);
}

function snapshotFleet(fleet: DeviceCapabilitySet) {
  const kinds: Array<{ kind: DeviceKind; count: number; capabilities: string[] }> = [];
  for (const [kind, caps] of fleet.byKind) {
    kinds.push({
      kind,
      count: fleet.count(kind),
      capabilities: [...caps].sort(),
    });
  }
  kinds.sort((a, b) => a.kind.localeCompare(b.kind));
  return {
    totalDevices: fleet.totalDevices,
    snapshotAt: fleet.snapshotAt,
    kinds,
  };
}

function parseRequirements(body: unknown): OptionalRequirement[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { optionalRequirements?: unknown }).optionalRequirements;
  if (!Array.isArray(raw)) return null;
  const out: OptionalRequirement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.device !== 'string') continue;
    if (typeof r.degrade_to !== 'string') continue;
    if (!Array.isArray(r.enables)) continue;
    const capability = r.capability;
    if (typeof capability !== 'string' && !Array.isArray(capability)) continue;
    out.push({
      device: r.device as OptionalRequirement['device'],
      capability: capability as OptionalRequirement['capability'],
      enables: r.enables.filter((x): x is string => typeof x === 'string'),
      degrade_to: r.degrade_to,
    });
  }
  return out;
}

function parseFallback(body: unknown): FallbackChainEntry[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as { fallbackChain?: unknown }).fallbackChain;
  if (!Array.isArray(raw)) return undefined;
  const out: FallbackChainEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.if !== 'string') continue;
    if (typeof r.then !== 'string') continue;
    out.push({ if: r.if, then: r.then });
  }
  return out;
}
