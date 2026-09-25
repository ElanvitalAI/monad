'use client';

// WT-N-5 P2 — Live camera capture + ACP notify wiring.
//
// One toggle button + status pill that drives the `useLiveCamera`
// hook. While streaming:
//   - Off-screen `<video>` element holds the MediaStream
//   - 1Hz capture loop snapshots → JPEG blob → POST /v1/attachments
//   - **P2**: each upload triggers ACP `terminal/camera/frame/notify`
//     so the daemon's `live-camera-registry` Map updates. The LLM
//     tool `LiveCameraFrame` then reads from that Map.
//
// UI states:
//   idle        → "📹 Live" button (start)
//   requesting  → "Requesting…" disabled
//   streaming   → "■ Stop" red + frame counter pill
//   denied      → "Denied" disabled + tooltip with iOS Settings hint
//   unsupported → not rendered (caller hides the button entirely)
//   error       → red border + error message tooltip
//
// Wake lock: while streaming, the parent should pass `active=true`
// to `useWakeLock` so the screen doesn't sleep mid-capture. We keep
// that in the consuming component (TerminalControls / TerminalPanel)
// rather than inside this control so it composes cleanly with other
// wake-lock consumers (recording, voice, etc.).

import { useCallback, useEffect, useRef } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { useLiveCamera } from '@/lib/use-live-camera';
import type { AttachmentMeta } from '@/lib/upload-attachment';
import { debugLog } from '@/lib/debug';

interface Props {
  /** Optional override — if provided, bypasses the default ACP
   *  notify wire and lets the caller decide what to do with each
   *  uploaded frame. Most callers leave this undefined to get the
   *  P2 LLM-tool wire automatically. */
  onFrameUploaded?: (meta: AttachmentMeta) => void;
}

export function LiveCameraControl({ onFrameUploaded }: Props) {
  const { config, client, sessionId } = useDaemon();

  // P2 — lazy ACP connection used for `terminal/camera/frame/notify`.
  // Only opened once the user actually starts the stream so we don't
  // spend a WS slot on the toolbar mount of every PWA load.
  const acpRef = useRef<ReturnType<typeof client.connectAcp> | null>(null);
  useEffect(() => () => {
    try { acpRef.current?.close(); } catch { /* ignore */ }
    acpRef.current = null;
  }, []);

  const handleFrame = useCallback(async (meta: AttachmentMeta): Promise<void> => {
    if (onFrameUploaded) {
      try { onFrameUploaded(meta); } catch { /* swallow override-throw */ }
      return;
    }
    if (!sessionId) return;
    if (!acpRef.current) acpRef.current = client.connectAcp({ sessionId });
    try {
      await acpRef.current.send('terminal/camera/frame/notify', {
        sessionId,
        attachmentId: meta.id,
        ts: meta.createdAt ?? Date.now(),
      });
    } catch (e) {
      debugLog('webterm.live-cam.notify-failed', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }, [client, sessionId, onFrameUploaded]);

  const camera = useLiveCamera({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
    onFrameUploaded: handleFrame,
  });

  // Hide the button entirely when the browser doesn't expose
  // getUserMedia or when the daemon baseUrl isn't configured —
  // showing a permanently-disabled button is just confusing.
  if (camera.status === 'unsupported' || !config.baseUrl) {
    return null;
  }

  if (camera.status === 'denied') {
    return (
      <button
        type="button"
        disabled
        className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
        title="Camera permission denied. Enable in iOS Settings → Safari → Camera, then reload."
        data-testid="live-camera-denied"
      >
        Camera denied
      </button>
    );
  }

  if (!camera.isRunning) {
    return (
      <button
        type="button"
        disabled={camera.status === 'requesting'}
        onClick={() => { void camera.start(); }}
        className="rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
        title="Start live camera — uploads a 1Hz frame stream so the agent can see what you point at"
        data-testid="live-camera-start"
      >
        {camera.status === 'requesting' ? 'Requesting…' : '📹 Live'}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => camera.stop()}
        className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900"
        title="Stop live camera"
        data-testid="live-camera-stop"
      >
        ■ Stop
      </button>
      <span
        className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        data-testid="live-camera-stats"
        aria-live="polite"
      >
        {camera.framesUploaded}f
        {camera.error ? <span className="ml-1 text-rose-500">err</span> : null}
      </span>
    </>
  );
}
