'use client';

// WT-N-5 P1 — Live camera capture hook.
//
// Wraps `navigator.mediaDevices.getUserMedia({video})` in a React hook
// that:
//   1. Acquires the rear camera ("environment" facing mode preferred,
//      falls back to default if unavailable) on `start()`.
//   2. Mounts an off-screen `<video>` element bound to the MediaStream.
//   3. Drives a 1Hz interval that snapshots the latest video frame to
//      a hidden `<canvas>`, encodes JPEG (quality 0.85), and uploads
//      to the daemon's `/v1/attachments` endpoint.
//   4. Releases the camera + canvas on `stop()` or component unmount.
//
// Why a hook (vs inline in LiveCameraControl): future callers may
// want to reuse the capture pipeline for non-LLM flows — share-target
// preview, voice + camera fusion, scenario assertions. Centralising
// keeps the lifecycle correct (release on unmount, visibilitychange
// pause behaviour) regardless of the consuming UI.
//
// Permission UX: the first `start()` triggers iOS Safari's camera
// permission prompt. Subsequent calls reuse the granted state for
// the same Home Screen PWA install (each Safari tab is a separate
// security context — that's an OS-level decision we can't override).
// Denial → status='denied'; UI hides Start, shows guidance.
//
// Wake Lock: while capture is running, we acquire `navigator.wakeLock`
// via the existing `useWakeLock` hook so iPad doesn't sleep mid-stream
// (which would drop frames + force re-permission on resume).

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugLog } from './debug';
import { uploadAttachment, type AttachmentMeta } from './upload-attachment';

const DEFAULT_CAPTURE_INTERVAL_MS = 1000;
const DEFAULT_JPEG_QUALITY = 0.85;
const DEFAULT_MAX_DIMENSION = 1280;

export type LiveCameraStatus =
  | 'idle'
  | 'requesting'
  | 'streaming'
  | 'denied'
  | 'unsupported'
  | 'error';

export interface LiveCameraState {
  status: LiveCameraStatus;
  /** Number of successful frame uploads this session. Useful for
   *  status pill ("3 frames captured"). Resets on stop(). */
  framesUploaded: number;
  /** Most recent uploaded attachment id — daemon stores this and
   *  the LLM tool (P2) reads it. UI can also use it to drive a
   *  thumbnail preview if desired. */
  lastAttachmentId: string | null;
  /** Last error message, if any. */
  error: string | null;
}

export interface UseLiveCameraOpts {
  /** Daemon base URL (DaemonClient.cfg.baseUrl). When empty, the
   *  hook stays in 'unsupported' so the UI can prompt the user to
   *  configure the daemon connection first. */
  baseUrl: string;
  /** Bearer token for `/v1/attachments` POST. Optional — the
   *  daemon may run with `--no-http-auth`. */
  token?: string;
  /** Capture interval in ms. Default 1000 (1 Hz). The local capture
   *  loop is decoupled from any LLM-driven vision cost — frames are
   *  uploaded so the daemon has the most-recent one available; LLM
   *  tool (P2) decides when to actually consume the frame. */
  intervalMs?: number;
  /** JPEG encode quality (0-1). Default 0.85 — readable for vision
   *  models while keeping payload ~30-80 KB per frame at 720p. */
  jpegQuality?: number;
  /** Max width OR height in pixels. Default 1280. Larger frames are
   *  scaled down before encode (preserves aspect ratio). Vision API
   *  pricing scales with token count, which scales with image size —
   *  1280 is the Anthropic / OpenAI sweet spot. */
  maxDimension?: number;
  /** Optional callback fired after each successful upload. Parent
   *  uses this to ship the attachment id to daemon via the new ACP
   *  ext method `terminal/camera/frame/notify` (P2). */
  onFrameUploaded?: (meta: AttachmentMeta) => void;
}

export interface UseLiveCameraReturn extends LiveCameraState {
  start: () => Promise<void>;
  stop: () => void;
  /** True while capture is actively running — same as
   *  `status === 'streaming'` but easier for `<button disabled={...}>`
   *  consumers. */
  isRunning: boolean;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function fitDimensions(
  videoWidth: number,
  videoHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  if (videoWidth <= maxDimension && videoHeight <= maxDimension) {
    return { width: videoWidth, height: videoHeight };
  }
  const aspect = videoWidth / videoHeight;
  if (videoWidth >= videoHeight) {
    return { width: maxDimension, height: Math.round(maxDimension / aspect) };
  }
  return { width: Math.round(maxDimension * aspect), height: maxDimension };
}

export function useLiveCamera(opts: UseLiveCameraOpts): UseLiveCameraReturn {
  const intervalMs = opts.intervalMs ?? DEFAULT_CAPTURE_INTERVAL_MS;
  const jpegQuality = opts.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  const maxDimension = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;

  const [state, setState] = useState<LiveCameraState>({
    status: 'idle',
    framesUploaded: 0,
    lastAttachmentId: null,
    error: null,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureInFlightRef = useRef(false);
  const onFrameUploadedRef = useRef(opts.onFrameUploaded);
  onFrameUploadedRef.current = opts.onFrameUploaded;
  const optsRef = useRef({ baseUrl: opts.baseUrl, token: opts.token });
  optsRef.current = { baseUrl: opts.baseUrl, token: opts.token };

  const stopInternal = useCallback((): void => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch { /* ignore */ }
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    canvasRef.current = null;
    captureInFlightRef.current = false;
  }, []);

  const captureFrame = useCallback(async (): Promise<void> => {
    if (captureInFlightRef.current) {
      // Drop frame — previous upload still in flight (slow link).
      // Better than queueing which would inflate latency.
      debugLog('webterm.live-cam.frame-dropped', { reason: 'in-flight' });
      return;
    }
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      debugLog('webterm.live-cam.frame-skipped', { reason: 'video-not-ready' });
      return;
    }
    captureInFlightRef.current = true;
    try {
      const fit = fitDimensions(video.videoWidth, video.videoHeight, maxDimension);
      let canvas = canvasRef.current;
      if (!canvas || canvas.width !== fit.width || canvas.height !== fit.height) {
        canvas = createCanvas(fit.width, fit.height);
        canvasRef.current = canvas;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        debugLog('webterm.live-cam.no-ctx');
        return;
      }
      ctx.drawImage(video, 0, 0, fit.width, fit.height);
      const blob: Blob | null = await new Promise((resolve) => {
        canvas!.toBlob((b) => resolve(b), 'image/jpeg', jpegQuality);
      });
      if (!blob) {
        debugLog('webterm.live-cam.toBlob-null');
        return;
      }
      const filename = `live-frame-${Date.now()}.jpg`;
      const result = await uploadAttachment({
        baseUrl: optsRef.current.baseUrl,
        token: optsRef.current.token,
        file: blob,
        filename,
      });
      if (!result.ok) {
        setState((s) => ({ ...s, error: result.reason }));
        debugLog('webterm.live-cam.upload-failed', { reason: result.reason });
        return;
      }
      setState((s) => ({
        ...s,
        framesUploaded: s.framesUploaded + 1,
        lastAttachmentId: result.meta.id,
        error: null,
      }));
      try {
        onFrameUploadedRef.current?.(result.meta);
      } catch (e) {
        debugLog('webterm.live-cam.onFrameUploaded-throw', {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, error: reason }));
      debugLog('webterm.live-cam.capture-error', { reason });
    } finally {
      captureInFlightRef.current = false;
    }
  }, [jpegQuality, maxDimension]);

  const start = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({ ...s, status: 'unsupported', error: 'getUserMedia not available' }));
      return;
    }
    if (!optsRef.current.baseUrl) {
      setState((s) => ({ ...s, status: 'error', error: 'daemon baseUrl not configured' }));
      return;
    }
    if (streamRef.current) return;
    setState((s) => ({ ...s, status: 'requesting', error: null }));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const denied = reason.includes('Permission') || reason.includes('NotAllowed');
      setState((s) => ({
        ...s,
        status: denied ? 'denied' : 'error',
        error: reason,
      }));
      debugLog('webterm.live-cam.getUserMedia-failed', { reason, denied });
      return;
    }
    streamRef.current = stream;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;
    try {
      await video.play();
    } catch (e) {
      debugLog('webterm.live-cam.video-play-failed', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    setState((s) => ({ ...s, status: 'streaming', framesUploaded: 0, error: null }));
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => { void captureFrame(); }, intervalMs);
    debugLog('webterm.live-cam.started', { intervalMs });
  }, [captureFrame, intervalMs]);

  const stop = useCallback((): void => {
    stopInternal();
    setState({ status: 'idle', framesUploaded: 0, lastAttachmentId: null, error: null });
    debugLog('webterm.live-cam.stopped');
  }, [stopInternal]);

  // Cleanup on unmount — drop the camera so the OS indicator clears.
  useEffect(() => () => { stopInternal(); }, [stopInternal]);

  return {
    ...state,
    start,
    stop,
    isRunning: state.status === 'streaming',
  };
}
