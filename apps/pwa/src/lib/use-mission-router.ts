'use client';

// useMissionRouter — P2-1 (2026-05-14) PWA hook mirroring the iOS
// MissionRouterService. Debounces input changes 300 ms before POSTing
// to `/v1/llm/route/predict`. Cancellation via AbortController so a
// fast typist's stale response never paints the chip after the
// keystroke that superseded it.
//
// Sticky short-circuit: when `sticky` is true the chip stops showing
// a mission tag (locked backend wins regardless of intent) — caller
// drops the call entirely by guarding the predict effect.

import { useCallback, useEffect, useRef, useState } from 'react';

export type MissionAttachmentKind = 'image' | 'audio' | 'video' | 'document';

export interface MissionPrediction {
  mission: string;
  provider: string;
  model?: string;
  confidence: number;
  tier: 1 | 2 | 3;
}

interface Options {
  /** Daemon base URL · usually `http://localhost:31415` or tailnet URL. */
  baseUrl?: string;
  /** Bearer token from useDaemon().config.token. */
  token?: string;
  /** Skip predict calls — used when sticky is on. */
  enabled?: boolean;
  /** Debounce window · defaults to 300 ms (same as iOS). */
  debounceMs?: number;
}

export interface MissionRouterHandle {
  prediction: MissionPrediction | null;
  inflight: boolean;
  error: string | null;
  predict: (text: string, attachments?: MissionAttachmentKind[]) => void;
  clear: () => void;
}

export function useMissionRouter(opts: Options = {}): MissionRouterHandle {
  const { baseUrl, token, enabled = true, debounceMs = 300 } = opts;
  const [prediction, setPrediction] = useState<MissionPrediction | null>(null);
  const [inflight, setInflight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancelInflight = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    cancelInflight();
    setPrediction(null);
    setError(null);
  }, [cancelInflight]);

  const predict = useCallback(
    (text: string, attachments: MissionAttachmentKind[] = []) => {
      cancelInflight();
      if (!enabled || !baseUrl) {
        setPrediction(null);
        return;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0 && attachments.length === 0) {
        setPrediction(null);
        return;
      }
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        const ac = new AbortController();
        abortRef.current = ac;
        setInflight(true);
        try {
          const url = `${baseUrl}/v1/llm/route/predict`;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token && token.length > 0) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              text,
              attachments: attachments.map((kind) => ({ kind })),
            }),
            signal: ac.signal,
          });
          if (ac.signal.aborted) return;
          if (!res.ok) {
            setError(`http-${res.status}`);
            return;
          }
          const body = (await res.json()) as MissionPrediction;
          setPrediction(body);
          setError(null);
        } catch (err) {
          if (ac.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        } finally {
          if (abortRef.current === ac) abortRef.current = null;
          setInflight(false);
        }
      }, debounceMs);
    },
    [baseUrl, token, enabled, debounceMs, cancelInflight],
  );

  // Clean up on unmount.
  useEffect(() => {
    return () => cancelInflight();
  }, [cancelInflight]);

  return { prediction, inflight, error, predict, clear };
}
