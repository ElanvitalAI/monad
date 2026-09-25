/**
 * Control signals REST surface — mirrors legacy pwa/control-signals.js.
 * Endpoints:
 *   GET  /v1/control-signals         list with filter querystring
 *   POST /v1/control-signals         emit a new signal
 */

import type { DaemonClient } from './daemon-client';

/** Closed urgency enum — must match `src/input/control-signal-request.ts`. */
export const CONTROL_URGENCIES = [
  'background',
  'quick-pass',
  'normal',
  'priority',
  'critical',
] as const;
export type ControlUrgency = (typeof CONTROL_URGENCIES)[number];

export function isControlUrgency(v: unknown): v is ControlUrgency {
  return typeof v === 'string' && (CONTROL_URGENCIES as readonly string[]).includes(v);
}

export interface ControlSignal {
  kind: string;
  urgency: ControlUrgency;
  source?: string;
  createdAt: string;
  scope?: { surface?: string; channel?: string; sessionId?: string };
  payload?: unknown;
}

export interface ControlSignalsResponse {
  total?: number;
  latest?: string;
  countsByKind?: Record<string, number>;
  items?: ControlSignal[];
}

export interface ControlFilter {
  kind?: string;
  surface?: string;
  minUrgency?: string;
  sessionId?: string;
  limit?: string;
}

export interface EmitSignalPayload {
  kind: string;
  urgency: ControlUrgency;
  source?: string;
  mayPreempt?: boolean;
  payload?: unknown;
  scope?: { surface?: string; channel?: string; sessionId?: string };
}

export class ControlSignalsApi {
  constructor(private client: DaemonClient) {}

  async list(filters: ControlFilter = {}): Promise<ControlSignalsResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return this.client.fetchJson(`/v1/control-signals${qs ? `?${qs}` : ''}`);
  }

  emit(body: EmitSignalPayload): Promise<unknown> {
    return this.client.fetchJson('/v1/control-signals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
