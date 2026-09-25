'use client';

// WT-M-1 — multi-device awareness strip.
//
// Two signals:
//   1. **Peer count** — how many ACP connections are attached to the
//      current sessionId (this PWA tab + every other device that loaded
//      `/term`). Polled from `terminal/peers/count` on mount + on
//      tab visibility change. >1 → render "Nx" badge.
//   2. **Foreign input activity** — daemon broadcasts a
//      `terminalInputActivity` envelope each time *any* peer sends
//      `terminal/input`. The originating peer filters by its own
//      `peerId` (via `getPeerId()`); other peers light up a brief
//      "👤 typing" flash so the user understands why the screen
//      scrolled without their typing.
//
// Cheap to render — only the badge / flash live in DOM; no ongoing
// timers when idle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';

interface Props {
  /** Bumps each time XtermView observes a foreign-peer input activity.
   *  Parent passes a counter; we treat any change as "another flash".
   *  Use 0 / undefined for "no activity yet". */
  foreignActivityTick?: number;
  /** Surface peer count to the parent so the minimized tab strip can
   *  render a compact `Nx devices` pill without keeping this row
   *  visible. Fires whenever the polled count changes. */
  onPeerCountChange?: (count: number) => void;
}

const FLASH_TIMEOUT_MS = 1800;

export function MultiDeviceIndicator({ foreignActivityTick, onPeerCountChange }: Props) {
  const { client, sessionId } = useDaemon();
  const [count, setCount] = useState<number>(0);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    onPeerCountChange?.(count);
  }, [count, onPeerCountChange]);
  const acpRef = useRef<ReturnType<typeof client.connectAcp> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-fetch peer count on mount + on tab focus return.
  const refreshCount = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    if (!acpRef.current) acpRef.current = client.connectAcp({ sessionId });
    const acp = acpRef.current;
    try {
      const res = (await acp.send('terminal/peers/count', { sessionId })) as
        | { count?: number }
        | undefined;
      if (typeof res?.count === 'number') {
        setCount(res.count);
        debugLog('webterm.peers.count', { count: res.count });
      }
    } catch (e) {
      debugLog('webterm.peers.count.error', { reason: String(e) });
    }
  }, [client, sessionId]);

  useEffect(() => {
    void refreshCount();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshCount();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshCount]);

  useEffect(() => () => {
    try { acpRef.current?.close(); } catch { /* ignore */ }
    acpRef.current = null;
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Flash on foreign activity tick changes (excluding 0/initial).
  useEffect(() => {
    if (!foreignActivityTick) return;
    setFlashing(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlashing(false);
      flashTimer.current = null;
      // Foreign device active → bump the visible peer count if our
      // cached value is stale (peer joined since last refresh).
      void refreshCount();
    }, FLASH_TIMEOUT_MS);
  }, [foreignActivityTick, refreshCount]);

  // Hide entirely when alone on the session and no recent activity.
  // Saves a row of vertical space on iPad portrait.
  if (count <= 1 && !flashing) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-2 py-0.5 text-[11px]">
      <Users className="h-3 w-3 text-amber-600" aria-hidden />
      {count > 1 && (
        <span className="font-mono text-amber-700 dark:text-amber-400">
          {count} devices
        </span>
      )}
      {flashing && (
        <span className="ml-auto rounded bg-amber-500 px-1.5 py-0.5 font-medium text-white animate-pulse">
          👤 typing
        </span>
      )}
    </div>
  );
}
