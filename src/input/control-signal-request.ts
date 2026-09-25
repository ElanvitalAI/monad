import {
  isInputSourceKind,
  type InputSourceKind,
  type InputSourceRef,
} from './input-source-kind.js';
import type { ControlSignal, SignalUrgency } from './control-signal.js';

export interface ControlSignalEmitRequest {
  kind: string;
  urgency?: SignalUrgency;
  source?: InputSourceRef | 'system' | 'sensor' | 'tool';
  payload?: unknown;
  scope?: {
    sessionId?: string;
    surface?: string;
    channel?: string;
    deviceId?: string;
  };
  mayPreempt?: boolean;
  expiresAt?: string;
}

export type ControlSignalEmitResponse = ControlSignal;

export function normalizeControlSignalEmitSource(
  source: unknown,
): InputSourceRef | 'system' | 'sensor' | 'tool' | null {
  if (source === 'system' || source === 'sensor' || source === 'tool') return source;
  if (!source || typeof source !== 'object') return null;
  const kind = (source as { kind?: unknown }).kind;
  if (!isInputSourceKind(kind)) return null;
  return source as Extract<InputSourceRef, { kind: InputSourceKind }>;
}

export function parseControlSignalEmitBody(
  body: unknown,
): { ok: true; value: ControlSignalEmitRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be an object' };
  const raw = body as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  if (!kind) return { ok: false, reason: 'kind required' };

  const urgency = raw.urgency;
  if (
    urgency !== undefined
    && urgency !== 'background'
    && urgency !== 'normal'
    && urgency !== 'priority'
    && urgency !== 'quick-pass'
    && urgency !== 'critical'
  ) {
    return { ok: false, reason: 'urgency must be background | normal | priority | quick-pass | critical' };
  }

  const source = raw.source === undefined
    ? 'system'
    : normalizeControlSignalEmitSource(raw.source);
  if (!source) {
    return { ok: false, reason: 'source must be system | sensor | tool | valid input source ref' };
  }

  const scope = raw.scope;
  if (scope !== undefined && (!scope || typeof scope !== 'object')) {
    return { ok: false, reason: 'scope must be an object when provided' };
  }

  const expiresAt = typeof raw.expiresAt === 'string' && raw.expiresAt.trim()
    ? raw.expiresAt.trim()
    : undefined;

  return {
    ok: true,
    value: {
      kind,
      source,
      ...(urgency ? { urgency } : {}),
      ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
      ...(scope && typeof scope === 'object'
        ? {
            scope: {
              ...(typeof (scope as { sessionId?: unknown }).sessionId === 'string'
                ? { sessionId: (scope as { sessionId: string }).sessionId }
                : {}),
              ...(typeof (scope as { surface?: unknown }).surface === 'string'
                ? { surface: (scope as { surface: string }).surface }
                : {}),
              ...(typeof (scope as { channel?: unknown }).channel === 'string'
                ? { channel: (scope as { channel: string }).channel }
                : {}),
              ...(typeof (scope as { deviceId?: unknown }).deviceId === 'string'
                ? { deviceId: (scope as { deviceId: string }).deviceId }
                : {}),
            },
          }
        : {}),
      ...(typeof raw.mayPreempt === 'boolean' ? { mayPreempt: raw.mayPreempt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
  };
}
