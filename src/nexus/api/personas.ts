// NEXUS · personas REST handlers (§6.4 · 2026-05-09).
//
// Endpoints
//   GET  /v1/personas              — list all loaded personas
//   GET  /v1/personas/:personaId   — single persona profile
//
// Architecture: read-only thin wrapper over the global PersonaRegistry
// (`src/persona/global-registry.ts`). Disk yaml is the source of truth;
// editing requires text editor + `elanous persona reload` (or fs.watch
// auto-reload). PWA Showroom consumes this for the per-panel persona
// picker (§6.4 Q2 = REST read-only).
//
// PLAN: 내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07` §6.4
// Cross-ref: src/persona/global-registry.ts (singleton accessor)
//            src/persona/types.ts (PersonaProfile shape)

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  awaitGlobalPersonaLoad,
  getGlobalPersonaRegistry,
  reloadGlobalPersonaRegistry,
} from '../../persona/global-registry.js';
import type { PersonaRegistryEvent } from '../../persona/registry.js';
import type { PersonaProfile } from '../../persona/types.js';
import {
  MAX_PERSONA_DESCRIPTION_LENGTH,
  updatePersonaDescription,
} from '../../persona/write-description.js';
import { SSE_HEARTBEAT_MS } from './sse-heartbeat.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function notFound(msg: string): Response {
  return jsonResponse({ error: msg }, 404);
}

/** Wire shape returned to clients. Subset of `PersonaProfile` —
 *  systemPrompt body included so PWA can preview before binding (the
 *  multi-llm-bridge resolves it again at dispatch time, so the wire
 *  is informational only). */
export interface PersonaWire {
  personaId: string;
  displayName: string;
  description?: string;
  brand?: string;
  primaryModel?: string;
  systemPrompt?: string;
  avatarUrl?: string;
  brandColor?: string;
  mentionPatterns?: readonly string[];
}

function toWire(p: PersonaProfile): PersonaWire {
  const wire: PersonaWire = {
    personaId: p.personaId,
    displayName: p.displayName,
  };
  if (p.description) wire.description = p.description;
  if (p.brand) wire.brand = p.brand;
  if (p.models?.primary) wire.primaryModel = p.models.primary;
  if (p.systemPrompt) wire.systemPrompt = p.systemPrompt;
  if (p.avatarUrl) wire.avatarUrl = p.avatarUrl;
  if (p.brandColor) wire.brandColor = p.brandColor;
  if (p.mentionPatterns && p.mentionPatterns.length > 0) {
    wire.mentionPatterns = p.mentionPatterns;
  }
  return wire;
}

export interface PersonaRouteOpts {
  /** Optional auth check — production routes through the same
   *  meta-api `checkAuth` shape; tests pass undefined to skip. */
  checkAuth?: (req: Request) => boolean;
}

/** GET /v1/personas — list all loaded personas.
 *
 *  First call awaits the lazy global load so the PWA picker doesn't
 *  see an empty list during cold-start. Subsequent calls return
 *  immediately from the cached registry. */
export async function handlePersonasList(
  req: Request,
  opts: PersonaRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  // Ensure first-load completes before responding.
  await awaitGlobalPersonaLoad();
  const registry = getGlobalPersonaRegistry();
  const list = registry.list();
  const wire: PersonaWire[] = list
    .map(toWire)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return jsonResponse({ personas: wire, count: wire.length }, 200);
}

/** GET /v1/personas/:personaId — single persona profile. */
export async function handlePersonaGet(
  req: Request,
  personaId: string,
  opts: PersonaRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  await awaitGlobalPersonaLoad();
  const registry = getGlobalPersonaRegistry();
  const persona = registry.get(personaId);
  if (!persona) return notFound(`persona ${personaId} not found`);
  return jsonResponse({ persona: toWire(persona) }, 200);
}

/** R6 Task 3 · §6.4 SSE — `GET /v1/personas/events` returns a long-
 *  lived `text/event-stream` that mirrors the global PersonaRegistry's
 *  load/reload/upsert/remove events. The PWA picker subscribes to
 *  invalidate its TTL cache the moment yaml on disk changes; the gap
 *  between save and refresh drops from ≤60s (TTL polling) to <500ms.
 *
 *  Frame format:
 *    event: <kind>
 *    data: <json payload>
 *
 *  Where `<kind>` is one of `load-dir | reload-all | upsert | remove`
 *  (same shape as `PersonaRegistryEvent`). The first frame is always
 *  a synthetic `event: hello` with `{ count: <current size> }` so a
 *  fresh subscriber gets a baseline immediately.
 *
 *  Connection lifecycle: the response holds the stream open; closing
 *  the request unsubscribes. A 5s heartbeat (`: ping\n\n` · see
 *  `sse-heartbeat.ts`) keeps the connection alive across HTTP
 *  intermediaries that close idle streams sub-12s. */
export function handlePersonasEvents(
  req: Request,
  opts: PersonaRouteOpts = {},
): Response {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const registry = getGlobalPersonaRegistry();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (kind: string, data: unknown): void => {
        try {
          const frame = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch { /* stream closed */ }
      };
      // Hello frame — gives the client an immediate baseline so it
      // doesn't have to chain a separate GET to know the size.
      send('hello', { count: registry.size() });
      unsubscribe = registry.on((event: PersonaRegistryEvent) => {
        send(event.kind, event);
      });
      // Heartbeat — comments are silently ignored by EventSource but
      // keep the underlying TCP/HTTP intermediaries from closing the
      // stream as idle.
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); }
        catch { /* ignore */ }
      }, SSE_HEARTBEAT_MS);
    },
    cancel() {
      if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } }
      if (heartbeat) { try { clearInterval(heartbeat); } catch { /* ignore */ } }
      unsubscribe = null;
      heartbeat = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      // CORS hint — same-origin in production but PWA dev runs on a
      // different port. Conservative: list only what the EventSource
      // client actually needs.
      'access-control-allow-origin': '*',
    },
  });
}

/** Resolve personas dir same way `global-registry.ts` does, so the PATCH
 *  endpoint targets the file the registry will reload. */
function resolvePersonasDir(): string {
  const env = process.env.ELANOUS_PERSONAS_DIR;
  if (env && env.length > 0) return env;
  return join(homedir(), '.elanous', 'personas');
}

/** PATCH /v1/personas/:personaId — update description.
 *
 *  Body: `{ description: "<string, ≤ 280 chars>" }` — empty string clears.
 *  Other fields ignored (yaml surgical edit pattern).
 *
 *  Returns 200 with the updated `PersonaWire` after reload, 400 / 404 /
 *  500 with structured `{ error, reason? }`.
 */
export async function handlePersonaPatch(
  req: Request,
  personaId: string,
  opts: PersonaRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  let body: { description?: unknown };
  try {
    body = (await req.json()) as { description?: unknown };
  } catch {
    return jsonResponse({ error: 'invalid-json' }, 400);
  }
  if (typeof body.description !== 'string') {
    return jsonResponse({ error: 'description-required' }, 400);
  }
  if (body.description.length > MAX_PERSONA_DESCRIPTION_LENGTH * 4) {
    // Guard against pathological inputs before the helper trims.
    return jsonResponse({ error: 'description-too-long' }, 400);
  }

  await awaitGlobalPersonaLoad();
  const registry = getGlobalPersonaRegistry();
  if (!registry.get(personaId)) {
    return notFound(`persona ${personaId} not found`);
  }

  const dir = resolvePersonasDir();
  const result = updatePersonaDescription(dir, personaId, body.description);
  if (!result.ok) {
    const status = result.reason === 'file-not-found' ? 404 : 400;
    return jsonResponse({ error: 'patch-failed', reason: result.reason }, status);
  }

  // Reload so the in-memory registry reflects the new description on the
  // next GET. fs.watch would auto-reload but is async + race-y vs the
  // immediate echo below.
  await reloadGlobalPersonaRegistry();
  const reloaded = getGlobalPersonaRegistry().get(personaId);
  if (!reloaded) {
    return notFound(`persona ${personaId} not found after reload`);
  }
  return jsonResponse({ persona: toWire(reloaded) }, 200);
}

/** Combined dispatcher — `/v1/personas[/:id]` + `/v1/personas/events`.
 *  Returns null when the pathname doesn't match so the caller chains. */
export async function dispatchPersonaRoute(
  req: Request,
  pathname: string,
  opts: PersonaRouteOpts = {},
): Promise<Response | null> {
  const method = req.method.toUpperCase();
  if (pathname === '/v1/personas') {
    if (method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405);
    }
    return handlePersonasList(req, opts);
  }
  // SSE — must come BEFORE the single-persona regex so that the
  // literal "events" segment isn't misread as a personaId.
  if (pathname === '/v1/personas/events') {
    if (method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405);
    }
    return handlePersonasEvents(req, opts);
  }
  const match = pathname.match(/^\/v1\/personas\/([^/]+)$/);
  if (!match) return null;
  const personaId = decodeURIComponent(match[1]!);
  if (method === 'PATCH') {
    return handlePersonaPatch(req, personaId, opts);
  }
  if (method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  return handlePersonaGet(req, personaId, opts);
}
