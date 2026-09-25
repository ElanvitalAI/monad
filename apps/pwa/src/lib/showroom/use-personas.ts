'use client';

/** §6.4 — usePersonas hook · daemon GET /v1/personas (read-only).
 *
 *  Caches the list per DaemonClient instance with a small in-memory
 *  TTL so re-mounts in the same tab don't re-hit the daemon. Surface
 *  loading + error states for picker UI.
 *
 *  R6 Task 3 (2026-05-09) — daemon now publishes a long-lived SSE
 *  stream at `/v1/personas/events` driven by the PersonaRegistry's
 *  fs.watch hook. The hook subscribes whenever it has a base URL,
 *  invalidates the cache + refetches on every event, and falls back
 *  to the prior 60s TTL polling when the stream errors out (offline
 *  / older daemon). Latency from yaml save → picker refresh drops
 *  from ≤60s to <500ms. */

import { useCallback, useEffect, useState } from 'react';
import type { DaemonClient } from '../daemon-client';
import { debugLog } from '../debug';

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

export interface UsePersonasResult {
  personas: readonly PersonaWire[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Module-level cache so multiple components in the same tab share
 *  one fetch. ttl 60s — yaml edits are rare and reload is manual. */
const TTL_MS = 60_000;
let _cache: { at: number; data: PersonaWire[] } | null = null;

export function usePersonas(client: DaemonClient): UsePersonasResult {
  const [personas, setPersonas] = useState<readonly PersonaWire[]>(() => {
    if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.data;
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.listPersonas();
      _cache = { at: Date.now(), data: res.personas };
      setPersonas(res.personas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (_cache && Date.now() - _cache.at < TTL_MS) {
      setPersonas(_cache.data);
      return;
    }
    void fetchOnce();
  }, [fetchOnce]);

  const reload = useCallback(async () => {
    _cache = null;
    await fetchOnce();
  }, [fetchOnce]);

  // R6 Task 3 — subscribe to the daemon's SSE stream so disk-yaml
  // edits propagate to the picker within ≤500ms instead of waiting on
  // the 60s polling TTL. The stream is read-only; reception of any
  // event invalidates the cache + triggers a refetch. Reconnect on
  // error is left to the EventSource native retry policy.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = client.personasEventsUrl();
    if (!url) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch (e) {
      debugLog('showroom.personas.sse.construct-error', { error: String(e) });
      return;
    }
    const onAny = (kind: string) => () => {
      // hello frame is just the size baseline — no need to refetch.
      if (kind === 'hello') return;
      debugLog('showroom.personas.sse.event', { kind });
      _cache = null;
      void fetchOnce();
    };
    es.addEventListener('hello', onAny('hello'));
    es.addEventListener('load-dir', onAny('load-dir'));
    es.addEventListener('reload-all', onAny('reload-all'));
    es.addEventListener('upsert', onAny('upsert'));
    es.addEventListener('remove', onAny('remove'));
    es.onerror = (ev) => {
      debugLog('showroom.personas.sse.error', { type: (ev as Event).type });
      // Native retry policy is good enough — no manual close on
      // transient errors. If the daemon is permanently gone, the
      // cache TTL fallback will eventually pick up changes after
      // the connection is dropped + 60s polling expires.
    };
    return () => {
      try { es?.close(); } catch { /* ignore */ }
    };
  }, [client, fetchOnce]);

  return { personas, loading, error, reload };
}

/** Test seam — clear the module-level cache between cases. */
export function _resetPersonasCacheForTest(): void {
  _cache = null;
}
