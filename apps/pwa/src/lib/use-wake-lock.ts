'use client';

// WT-N-6 — Screen Wake Lock hook.
//
// Web Wake Lock API holds the screen awake while the page is visible.
// Useful for /term during long-running commands (vim · log tails ·
// recording sessions) where a phone/iPad would otherwise sleep and
// drop the WS connection.
//
// Behavior:
//   - When `active === true` AND the document is visible, request a
//     'screen' lock. Browser auto-releases on page hide (system
//     contract); we re-request on visibilitychange so the lock comes
//     back when the user returns.
//   - When `active === false`, release explicitly.
//   - Insecure-context Safari (HTTP over LAN IP without TLS) rejects
//     the API — we treat that as silent no-op + report `supported: false`
//     so the UI can hide the toggle entirely.

import { useEffect, useRef, useState } from 'react';
import { debugLog } from './debug';

// Use the lib.dom WakeLockSentinel type via DOM ambient. No re-declare.
type Sentinel = WakeLockSentinel;

export interface WakeLockState {
  /** True when the browser exposes navigator.wakeLock and we're in
   *  a secure context. UI can hide its toggle when false. */
  supported: boolean;
  /** True when a sentinel is currently held. Drops to false when the
   *  page is hidden (browser auto-release) and bounces back on return. */
  held: boolean;
  /** Last error message, if any. Cleared on next successful request. */
  error: string | null;
}

export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>({
    supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    held: false,
    error: null,
  });
  const sentinelRef = useRef<Sentinel | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (typeof navigator === 'undefined') return undefined;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
    if (!wakeLock) {
      setState((s) => ({ ...s, supported: false }));
      return undefined;
    }

    const acquire = async (): Promise<void> => {
      if (!activeRef.current) return;
      if (sentinelRef.current && !sentinelRef.current.released) return;
      try {
        const sentinel = await wakeLock.request('screen');
        sentinelRef.current = sentinel;
        setState({ supported: true, held: true, error: null });
        debugLog('webterm.wake-lock.acquired');
        const onRelease = (): void => {
          sentinelRef.current = null;
          setState((s) => ({ ...s, held: false }));
          debugLog('webterm.wake-lock.auto-released');
        };
        sentinel.addEventListener('release', onRelease);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setState({ supported: true, held: false, error: reason });
        debugLog('webterm.wake-lock.acquire-failed', { reason });
      }
    };

    const release = async (): Promise<void> => {
      const s = sentinelRef.current;
      if (!s || s.released) return;
      try {
        await s.release();
        debugLog('webterm.wake-lock.released');
      } catch { /* swallow — best-effort */ }
      sentinelRef.current = null;
      setState((prev) => ({ ...prev, held: false }));
    };

    if (active) void acquire();
    else void release();

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [active]);

  return state;
}
