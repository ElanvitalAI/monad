import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMonadConfigDir } from '../monad-config-dir.js';
import { resolveNexusPwa, type NexusPwaResolution } from '../cli/nexus-show.js';
import { readNexusRuntime } from '../nexus/runtime.js';
import { acquireTurn, currentTurnHolder, releaseTurn, turnQueue } from './session-input-arbiter.js';

export const SESSION_TURN_CONTROL_PATH = '/v1/session-turn';

type SessionTurnAction = 'turn' | 'takeover' | 'release';

interface SessionTurnState {
  readonly holder: string | null;
  readonly queue: string[];
}

type SessionTurnControlResult = SessionTurnState & {
  readonly action: SessionTurnAction;
  readonly key?: string;
  readonly granted?: boolean;
  readonly position?: number;
  readonly released?: boolean;
  readonly nextHolder?: string | null;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function state(sessionId: string): SessionTurnState {
  return { holder: currentTurnHolder(sessionId), queue: turnQueue(sessionId) };
}

export async function handleSessionTurnControl(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'method-not-allowed' }, 405);
  let body: { sessionId?: unknown; action?: unknown; key?: unknown };
  try { body = await req.json() as { sessionId?: unknown; action?: unknown; key?: unknown }; }
  catch { return jsonResponse({ error: 'invalid-json' }, 400); }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) return jsonResponse({ error: 'sessionId-required' }, 400);
  if (body.action !== 'turn' && body.action !== 'takeover' && body.action !== 'release') return jsonResponse({ error: 'invalid-action' }, 400);
  if ((body.action === 'takeover' || body.action === 'release') && (typeof body.key !== 'string' || body.key.length === 0)) {
    return jsonResponse({ error: 'subscriberKey-required' }, 400);
  }
  const sessionId = body.sessionId;
  if (body.action === 'turn') return jsonResponse({ action: 'turn', ...state(sessionId) } satisfies SessionTurnControlResult, 200);
  const key = body.key as string;
  if (body.action === 'takeover') {
    const result = acquireTurn(sessionId, key);
    return jsonResponse({ action: 'takeover', key, ...result, ...state(sessionId) } satisfies SessionTurnControlResult, 200);
  }
  const result = releaseTurn(sessionId, key);
  return jsonResponse({ action: 'release', key, ...result, ...state(sessionId) } satisfies SessionTurnControlResult, 200);
}

type SessionTurnControlFetch = (input: string, init: RequestInit) => Promise<Response>;
type SessionTurnRuntimeReader = () => ReturnType<typeof readNexusRuntime>;

export interface SessionTurnControlDeps {
  /** Test seam — resolve the live daemon PWA URL used for turn requests. */
  resolveNexusPwaFn?: () => NexusPwaResolution;
  /** Test seam — read the Nexus daemon runtime sidecar used as the default discovery fallback. */
  readNexusRuntimeFn?: SessionTurnRuntimeReader;
  /** Test seam — send the turn-control HTTP request. */
  fetchFn?: SessionTurnControlFetch;
}

function originFromRuntime(readNexusRuntimeFn: SessionTurnRuntimeReader): string | null {
  const runtime = readNexusRuntimeFn();
  if (!runtime) return null;
  const port = runtime.httpPort;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const host = typeof runtime.httpHost === 'string' && runtime.httpHost.trim().length > 0
    ? runtime.httpHost.trim()
    : '127.0.0.1';
  const connectHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  try {
    return new URL(`http://${connectHost}:${port}/`).origin;
  } catch {
    return null;
  }
}

function daemonOrigin(
  resolveNexusPwaFn: () => NexusPwaResolution,
  readNexusRuntimeFn: SessionTurnRuntimeReader,
  allowRuntimeFallback: boolean,
): string {
  const runtimeOrigin = () => allowRuntimeFallback ? originFromRuntime(readNexusRuntimeFn) : null;
  const configuredOrigin = runtimeOrigin();
  if (configuredOrigin) return configuredOrigin;
  let resolution: NexusPwaResolution;
  try {
    resolution = resolveNexusPwaFn();
  } catch (error) {
    const origin = runtimeOrigin();
    if (origin) return origin;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Nexus daemon could not be found (${detail}); start it with \`monad nexus run\`.`);
  }
  if (!('loopback' in resolution)) {
    const origin = runtimeOrigin();
    if (origin) return origin;
    throw new Error(`Nexus daemon could not be found (${resolution.reason}); start it with \`monad nexus run\`.`);
  }
  try {
    return new URL(resolution.loopback).origin;
  } catch {
    const origin = runtimeOrigin();
    if (origin) return origin;
    throw new Error('Nexus daemon could not be found (invalid PWA URL); start it with `monad nexus run`.');
  }
}

function daemonToken(): string | null {
  const path = join(getMonadConfigDir(), 'acp-token');
  try { return existsSync(path) ? readFileSync(path, 'utf8').trim() : null; } catch { return null; }
}

export async function requestSessionTurnControl(
  sessionId: string,
  action: SessionTurnAction,
  key?: string,
  deps: SessionTurnControlDeps = {},
): Promise<SessionTurnControlResult> {
  const origin = daemonOrigin(
    deps.resolveNexusPwaFn ?? resolveNexusPwa,
    deps.readNexusRuntimeFn ?? readNexusRuntime,
    deps.resolveNexusPwaFn === undefined,
  );
  const token = daemonToken();
  const response = await (deps.fetchFn ?? fetch)(`${origin}${SESSION_TURN_CONTROL_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionId, action, ...(key ? { key } : {}) }),
  });
  const body = await response.json() as SessionTurnControlResult & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `session turn control failed (${response.status})`);
  return body;
}
