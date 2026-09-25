'use client';

// Phase 1 (PWA chat ↔ voice 일원화 · 2026-05-07) — voice lifecycle hook
// extracted from voice-control-bar.tsx so ChatLayout (헤더 mic toggle)
// and ChatInput (inline mic) can share one socket+capture+playback
// triple. The legacy VoiceControlBar wraps the same hook so /VoicePanel
// keeps working until Phase 2 deletes it.
//
// Q2=B2 design — `onTranscript` fires only on STT `final` events so
// ChatLayout can route the utterance straight into `handleSubmit` for
// auto-send. Partial / assistant transcripts are dropped here (chat
// history will surface assistant text via the streaming chat runtime).

import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceCapture, type VoiceCaptureHandle } from './voice-capture';
import { createVoicePlayback, type VoicePlaybackHandle } from './voice-playback';
import { createVoiceSocket, type VoiceSocketHandle, type VoiceSocketState } from './voice-websocket';
import { createRmsActivityDetector, type RmsActivityDetector } from './barge-in';
import { loadVoicePrefs } from '@/lib/voice-prefs';
import { debugLog } from '@/lib/debug';

export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface UseVoiceControllerOpts {
  /** Daemon WS URL — typically `client.voiceWsUrl()`. Empty string = not configured. */
  wsUrl: string;
  /** Bearer token forwarded to the daemon hello frame. */
  token?: string;
  /** STT final transcript callback. Phase 1 wires this to ChatLayout's
   *  `handleSubmit` for auto-send (Q2=B2). */
  onTranscript?: (text: string) => void;
  /** Phase 2 barge-in — fires when the RMS activity detector crosses
   *  threshold + sustain band. The host typically wires this to the
   *  layout-level TTS hook's `cancelInFlight()`. The detector runs
   *  whenever capture is active; gate the side-effect on the host
   *  side (e.g., only react while TTS is speaking). */
  onSpeechActivity?: () => void;
}

export interface UseVoiceControllerResult {
  phase: VoicePhase;
  errorMsg: string | null;
  active: boolean;
  /** Allocate playback + socket + capture and start streaming. */
  start: () => Promise<void>;
  /** Finalize the upstream stream and tear down all transport state. */
  stop: () => Promise<void>;
  /** Convenience — start when idle / stop when active. */
  toggle: () => Promise<void>;
  /** Phase 2 barge-in — ensure capture is live without flipping the
   *  user-visible toggle off. No-op when already active. Resolves once
   *  the mic has actually started streaming (or rejected with the
   *  capture error). The `start` path itself is reused so behavior is
   *  identical to a manual mic-on click. */
  forceListen: () => Promise<void>;
  /** BI-1 manual barge-in (Phase D · 2026-05-09) — user clicked the
   *  cut-in button while TTS was speaking. Cancels local playback +
   *  sends UPSTREAM_INTERRUPT so the daemon aborts the in-flight STT/
   *  dispatch + flushes the TTS queue. The mic stays open so the
   *  user's next utterance lands in a fresh STT session. No-op when
   *  not currently speaking (idle/listening/error states pass-through). */
  interrupt: () => void;
}

/** Pure server-state → UI phase mapping. Exported for unit testing. */
export function mapServerState(s: string): VoicePhase {
  switch (s) {
    case 'connecting': return 'connecting';
    case 'streaming':  return 'listening';
    case 'closing':    return 'idle';
    case 'closed':     return 'idle';
    default:           return 'idle';
  }
}

/** -6dB attenuation on the mic GainNode while TTS plays. Combined with
 *  the BI-2 RMS detector's `speakingThresholdMultiplier` (default 2.0)
 *  the effective AEC-residual margin is ~4× of the listening baseline. */
export const MIC_DUCK_GAIN = 0.5;

/** Pure phase → mic-gain mapping. Exported so the BI-2 ducking wire is
 *  test-friendly without spinning up the full hook. */
export function micGainForPhase(phase: VoicePhase): number {
  return phase === 'speaking' ? MIC_DUCK_GAIN : 1;
}

/** Pure socket-state → UI phase mapping. `null` = defer to server state. */
export function mapSocketState(s: VoiceSocketState): VoicePhase | null {
  if (s === 'connecting') return 'connecting';
  if (s === 'error') return 'error';
  if (s === 'closed') return 'idle';
  return null;
}

export function useVoiceController(opts: UseVoiceControllerOpts): UseVoiceControllerResult {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  const captureRef = useRef<VoiceCaptureHandle | null>(null);
  const playbackRef = useRef<VoicePlaybackHandle | null>(null);
  const socketRef = useRef<VoiceSocketHandle | null>(null);
  // BI-2 — speaking-aware threshold flip on every phase transition.
  // useEffect would re-run after render; we want this synchronous on
  // phase change so the next pushed frame already sees the new band.
  // Sync via a small wrapper around setPhase further down.

  // Keep onTranscript in a ref so consumer prop-identity changes don't
  // re-trigger start/stop. The socket callback reads the latest value.
  const onTranscriptRef = useRef(opts.onTranscript);
  useEffect(() => {
    onTranscriptRef.current = opts.onTranscript;
  }, [opts.onTranscript]);

  // Phase 2 — RMS activity detector lives across start/stop cycles so
  // the cooldown state survives a brief mic re-arm. The detector is
  // reset on stop so the next session begins armed.
  const onSpeechActivityRef = useRef(opts.onSpeechActivity);
  useEffect(() => {
    onSpeechActivityRef.current = opts.onSpeechActivity;
  }, [opts.onSpeechActivity]);
  const rmsDetectorRef = useRef<RmsActivityDetector | null>(null);
  if (rmsDetectorRef.current === null) {
    // C2 (PWA pre-iOS round 2 follow-up · 2026-05-11):
    //   honour the user's `speakingThresholdMultiplier` slider so loud /
    //   quiet rooms can tune BI-2 sensitivity. Read once at hook init —
    //   detector is reset/replaced on hot-reload during dev.
    const prefs = loadVoicePrefs();
    rmsDetectorRef.current = createRmsActivityDetector({
      speakingThresholdMultiplier: prefs.speakingThresholdMultiplier,
    });
  }
  // BI-2 (auto VAD barge-in · Phase 2 · 2026-05-10) — track the latest
  // phase in a ref so the per-frame onFrame handler (defined inside
  // start()) can read it without stale-closure races. Also drives the
  // detector's speaking-aware threshold (raised while TTS plays so
  // self-echo doesn't false-trigger).
  const phaseRef = useRef<VoicePhase>('idle');
  // Wrap every setPhase call so the ref + detector mode stay in sync
  // synchronously. This is the synchronous equivalent of a useEffect
  // that watches `phase`; doing it inline avoids a one-tick delay
  // during which a frame could fire under the old threshold.
  const setPhaseSync = useCallback((next: VoicePhase): void => {
    const prev = phaseRef.current;
    phaseRef.current = next;
    rmsDetectorRef.current?.setSpeakingActive(next === 'speaking');
    // BI-2 ducking (2026-05-10) — drop mic input -6dB while TTS plays
    // so AEC residual stays well below the speaking-mode RMS band even
    // in less acoustically isolated environments. Only fire on phase
    // transitions: `onDownstreamPcm` calls setPhaseSync('speaking') for
    // every ~20ms PCM frame, and we don't want to cancel/re-ramp the
    // gain that often. Capture handle is null until `start()` resolves;
    // capture itself initialises gain at 1.0.
    if (micGainForPhase(prev) !== micGainForPhase(next)) {
      try { captureRef.current?.setMicGain(micGainForPhase(next)); } catch { /* swallow */ }
    }
    setPhase(next);
  }, []);

  const teardown = useCallback(async (): Promise<void> => {
    try { socketRef.current?.close(); } catch { /* ignore */ }
    try { await captureRef.current?.stop(); } catch { /* ignore */ }
    try { await playbackRef.current?.close(); } catch { /* ignore */ }
    captureRef.current = null;
    playbackRef.current = null;
    socketRef.current = null;
  }, []);

  // Cleanup on unmount — guard against leaked WS / mic stream when the
  // host route unmounts mid-session.
  useEffect(() => {
    return () => { void teardown(); };
  }, [teardown]);

  const start = useCallback(async (): Promise<void> => {
    setErrorMsg(null);
    setPhaseSync('connecting');
    try {
      const playback = createVoicePlayback({
        onError: (err) => setErrorMsg(err.message),
      });
      playbackRef.current = playback;

      const socket = createVoiceSocket({
        url: opts.wsUrl,
        ...(opts.token ? { token: opts.token } : {}),
        hello: { surface: 'pwa', userAgent: navigator.userAgent },
        onDownstreamPcm: (pcm) => {
          playback.enqueue(pcm);
          setPhaseSync('speaking');
        },
        onState: (s) => setPhaseSync(mapServerState(s)),
        onTranscript: (evt) => {
          if (evt.kind === 'final') {
            onTranscriptRef.current?.(evt.text);
          }
        },
        onError: (e) => {
          setPhaseSync('error');
          setErrorMsg(e.error);
        },
        onSocketState: (s) => {
          const mapped = mapSocketState(s);
          if (mapped) setPhaseSync(mapped);
        },
      });
      socketRef.current = socket;

      const capture = await startVoiceCapture({
        onFrame: (pcm) => {
          socket.sendUpstreamPcm(pcm);
          // Phase 2 barge-in (BI-1) — host-side callback fires on RMS
          // rising edge so consumers can cancel their local TTS / UI.
          // BI-2 (Phase 2 · 2026-05-10) — the controller itself ALSO
          // fires the BI-1 server-side cancel transport
          // (UPSTREAM_INTERRUPT) when the detector activates *while
          // TTS is playing*. Combined effect:
          //   - host TTS cancel via onSpeechActivity (legacy)
          //   - server STT abort via interrupt() (auto · NEW in BI-2)
          //   - phase 'speaking' → 'listening' so UI flips out of cut-in
          //     button mode
          // Detector itself is speaking-aware (raised threshold during
          // playback) so self-echo from TTS doesn't false-trigger.
          const detector = rmsDetectorRef.current;
          if (detector && detector.push(pcm)) {
            debugLog('voice.barge-in.rms-fire');
            const cb = onSpeechActivityRef.current;
            try { cb?.(); } catch { /* host callback isolation */ }
            if (phaseRef.current === 'speaking') {
              try { playbackRef.current?.cancel(); } catch { /* swallow */ }
              try { socketRef.current?.sendInterrupt(); } catch { /* swallow */ }
              setPhaseSync('listening');
              debugLog('voice.barge-in.auto-fire');
            }
          }
        },
        onError: (err) => {
          setPhaseSync('error');
          setErrorMsg(err.message);
        },
      });
      captureRef.current = capture;
      setActive(true);
      setPhaseSync('listening');
    } catch (err) {
      setPhaseSync('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      await teardown();
    }
  }, [opts.wsUrl, opts.token, teardown, setPhaseSync]);

  const stop = useCallback(async (): Promise<void> => {
    setActive(false);
    socketRef.current?.finalize();
    await teardown();
    rmsDetectorRef.current?.reset();
    setPhaseSync('idle');
  }, [teardown, setPhaseSync]);

  const toggle = useCallback(async (): Promise<void> => {
    if (active) await stop();
    else await start();
  }, [active, start, stop]);

  const forceListen = useCallback(async (): Promise<void> => {
    if (active) return;
    await start();
  }, [active, start]);

  const interrupt = useCallback((): void => {
    // BI-1 manual barge-in (Phase D) — only meaningful while playback
    // is happening. Cancel local playback first (gives instant audible
    // feedback) then notify the daemon. If the socket is closed (mic
    // not active / dropped) sendInterrupt() is a no-op and we just
    // return state to listening.
    try { playbackRef.current?.cancel(); } catch { /* swallow */ }
    try { socketRef.current?.sendInterrupt(); } catch { /* swallow */ }
    if (phaseRef.current === 'speaking') {
      setPhaseSync('listening');
      debugLog('voice.barge-in.manual-fire');
    }
  }, [setPhaseSync]);

  return { phase, errorMsg, active, start, stop, toggle, forceListen, interrupt };
}
