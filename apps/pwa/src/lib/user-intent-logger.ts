// PWA user-intent logger client — cascade-zyu W2 U1.
// React hook wraps `POST /v1/user-intents/emit`. Mirrors the in-process
// `userIntentLogger().emit(...)` surface used by TUI / Discord / Telegram.

import { useCallback, useMemo } from 'react';

export type UserIntentSurface =
  | 'tui' | 'pwa' | 'ios' | 'watch' | 'airpods' | 'discord' | 'telegram';

export type UserIntentLayer =
  | 'utterance' | 'gesture' | 'selection'
  | 'navigation' | 'ambient' | 'device_state' | 'system';

export interface UserIntentEmitInput {
  surface: UserIntentSurface;
  intent: {
    layer: UserIntentLayer;
    kind: string;
    target?: { kind: string; id?: string; label?: string };
    value?: unknown;
  };
  surface_state?: { route?: string; active_modal?: string; active_panel?: string; focus?: string };
  context?: {
    active_mission_id?: string;
    active_task_id?: string;
    active_workflow_run_id?: string;
    active_showroom_session_id?: string;
    active_template_id?: string;
    active_skill?: string;
  };
  session_id?: string;
}

export interface UserIntentEmitResult {
  ok: boolean;
  event_id?: string;
  ts?: string;
  reason?: string;
}

export interface UserIntentLogger {
  emit(input: UserIntentEmitInput): Promise<UserIntentEmitResult>;
}

/** Module-level singleton — set once by the DaemonProvider so every hook
 *  consumer shares the same baseUrl + auth header. */
let baseUrl: string | null = null;
let authHeader: string | undefined;

export function configureUserIntentLogger(opts: {
  baseUrl: string;
  authHeader?: string;
}): void {
  baseUrl = opts.baseUrl.replace(/\/$/, '');
  authHeader = opts.authHeader;
}

async function postEmit(input: UserIntentEmitInput): Promise<UserIntentEmitResult> {
  if (!baseUrl) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(`${baseUrl}/v1/user-intents/emit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    return await res.json() as UserIntentEmitResult;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** React hook — components call `logger.emit({...})` on user signals. */
export function useUserIntentLogger(): UserIntentLogger {
  const emit = useCallback((input: UserIntentEmitInput) => postEmit(input), []);
  return useMemo(() => ({ emit }), [emit]);
}

/** Imperative API for non-React surfaces (event handlers, service workers). */
export const userIntentLogger: UserIntentLogger = { emit: postEmit };
