'use client';

/** CV-3 Showroom voice phase 2 — barge-in (2026-05-09).
 *
 *  Phase 1 (#2006) shipped turn-taking: TTS speaks the assistant reply
 *  in full before the user can interject. The 4-people-in-a-room UX
 *  needs the inverse — the user can interrupt mid-utterance and pivot
 *  the room. This module wires that inversion with two triggers:
 *
 *    1. **Voice activity (RMS) detection** — the capture worklet
 *       already emits 20ms int16 PCM frames. We compute root-mean-
 *       square amplitude, hold it through a hysteresis band, and emit
 *       once the sustained band crosses a configurable threshold for
 *       ≥150ms. This rejects single-frame spikes (cough, mouse click
 *       through the mic, room AC kick) but reacts well within the
 *       100ms "felt-instant" budget for normal speech.
 *
 *    2. **Spacebar long-press** — the mic-on path costs the user a
 *       click. While TTS is speaking, holding `Space` for 250ms+
 *       triggers the same barge-in flow without flipping mic state by
 *       hand. Short tapping is left alone so screen readers / form
 *       inputs aren't hijacked.
 *
 *  All effects are pure callbacks — wiring lives in the consumer hook
 *  (typically `useShowroomBargeIn` below). The detector can be unit-
 *  tested without a real `AudioContext`.
 */

import { useEffect, useRef } from 'react';
import { debugLog } from '@/lib/debug';

/** Default RMS threshold (0–1 normalized). Calibrated against AGC-on
 *  Web Audio capture — quiet rooms float around 0.005, normal speech
 *  averages 0.05–0.15, loud TTS bleed-through (post-AEC) is ≤0.02. */
const DEFAULT_RMS_THRESHOLD = 0.04;

/** BI-2 (Phase 2 · 2026-05-10) — multiplier applied while TTS is
 *  actively playing back. Acoustic echo post-AEC sits ≤0.02; doubling
 *  the threshold during playback (0.04 → 0.08 default) keeps the
 *  detector quiet to self-echo while still reacting to real speech
 *  (which sits well above 0.05 even in noisy rooms). Tuneable via
 *  `RmsActivityDetectorOpts.speakingThresholdMultiplier`. */
const DEFAULT_SPEAKING_THRESHOLD_MULTIPLIER = 2.0;

/** Sustained-over-window required for activation. Single frame spikes
 *  below this duration are ignored. */
const DEFAULT_SUSTAIN_MS = 150;

/** Spacebar long-press activation. Short presses are passed through to
 *  the focused element so chat input editing is not disturbed. */
const DEFAULT_SPACEBAR_LONGPRESS_MS = 250;

/** Number of int16 LE samples per frame. The capture worklet ships
 *  640-byte frames = 320 samples = 20ms @ 16kHz. */
export const FRAME_SAMPLES_DEFAULT = 320;

/** Compute root-mean-square amplitude of an int16 LE PCM frame as a
 *  0..1 float. Pure — no DOM dependency. Empty / zero-length frames
 *  return 0. */
export function computeFrameRms(pcm: Uint8Array): number {
  if (pcm.byteLength < 2) return 0;
  const samples = pcm.byteLength >> 1;
  // Int16Array view costs zero — same memory.
  const view = new Int16Array(pcm.buffer, pcm.byteOffset, samples);
  let sumSquares = 0;
  for (let i = 0; i < samples; i += 1) {
    const v = view[i]! / 32768;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / samples);
}

export interface RmsActivityDetectorOpts {
  /** Threshold in normalized RMS (0..1). */
  threshold?: number;
  /** Sustained ms required. */
  sustainMs?: number;
  /** Approx ms per frame — defaults to 20 (matches voice-capture). */
  frameMs?: number;
  /** BI-2 — multiplier applied to `threshold` while
   *  `setSpeakingActive(true)`. Default 2.0 (0.04 → 0.08).
   *  1.0 = no ducking (legacy BI-1 behavior). */
  speakingThresholdMultiplier?: number;
}

export interface RmsActivityDetector {
  /** Push one frame; returns `true` exactly once per activation
   *  transition (rising edge). The detector resets to "armed" after
   *  ~500ms of sub-threshold quiet, so a second utterance after a
   *  pause re-arms cleanly. */
  push(pcm: Uint8Array): boolean;
  /** Force the detector back to armed state — useful when the host
   *  pauses TTS or toggles barge-in off. */
  reset(): void;
  /** BI-2 (Phase 2 · 2026-05-10) — flip the speaking-aware mode.
   *  When `active=true` the detector raises its effective threshold
   *  by `speakingThresholdMultiplier` to suppress self-echo from
   *  TTS playback (post-AEC residual). Idempotent — calling with
   *  the same value is a no-op. */
  setSpeakingActive(active: boolean): void;
  /** Diagnostic — current effective threshold (post multiplier).
   *  Useful for tests + dogfood debug. */
  effectiveThreshold(): number;
}

/** Hysteresis-based RMS detector. Public for unit tests; production
 *  consumers go through `useShowroomBargeIn`. */
export function createRmsActivityDetector(
  opts: RmsActivityDetectorOpts = {},
): RmsActivityDetector {
  const baseThreshold = opts.threshold ?? DEFAULT_RMS_THRESHOLD;
  const speakingMultiplier = opts.speakingThresholdMultiplier ?? DEFAULT_SPEAKING_THRESHOLD_MULTIPLIER;
  const sustainMs = opts.sustainMs ?? DEFAULT_SUSTAIN_MS;
  const frameMs = opts.frameMs ?? 20;
  const sustainFrames = Math.max(1, Math.ceil(sustainMs / frameMs));
  // 500ms of sub-threshold quiet to re-arm.
  const cooldownFrames = Math.max(1, Math.ceil(500 / frameMs));

  let aboveCount = 0;
  let belowCount = 0;
  let activated = false;
  let speakingActive = false;

  const currentThreshold = (): number =>
    speakingActive ? baseThreshold * speakingMultiplier : baseThreshold;

  return {
    push(pcm) {
      const rms = computeFrameRms(pcm);
      const t = currentThreshold();
      if (rms >= t) {
        aboveCount += 1;
        belowCount = 0;
        if (!activated && aboveCount >= sustainFrames) {
          activated = true;
          return true;
        }
      } else {
        aboveCount = 0;
        belowCount += 1;
        if (activated && belowCount >= cooldownFrames) {
          activated = false;
        }
      }
      return false;
    },
    reset() {
      aboveCount = 0;
      belowCount = 0;
      activated = false;
    },
    setSpeakingActive(active) {
      if (speakingActive === active) return;
      speakingActive = active;
      // Reset hysteresis counters — the threshold just shifted under
      // us, so any partial activation from the previous mode would be
      // misleading. The detector re-arms cleanly under the new band.
      aboveCount = 0;
      belowCount = 0;
    },
    effectiveThreshold: currentThreshold,
  };
}

export interface UseSpacebarLongPressOpts {
  /** Toggles the keyboard listener. Use `false` while TTS is silent so
   *  ordinary spacebar presses (chat input typing) aren't penalized. */
  enabled: boolean;
  /** Fires once when the threshold is crossed. The handler is given
   *  the raw KeyboardEvent so consumers can `preventDefault()` if they
   *  want to suppress the trailing scroll/click. */
  onActivate: (ev: KeyboardEvent) => void;
  /** Long-press threshold in ms. Default 250. */
  thresholdMs?: number;
  /** Skip activation when the press originates inside a focusable
   *  text input (textarea / input / contenteditable). Default true. */
  ignoreFocusedInput?: boolean;
}

function isTextEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return target.isContentEditable;
}

/** Listen for `Space` long-press at the document level. Fires
 *  `onActivate` once per press; release / cancel re-arms. Respects
 *  text-editable targets by default so users typing into the chat
 *  input aren't interrupted. */
export function useSpacebarLongPress(opts: UseSpacebarLongPressOpts): void {
  const enabledRef = useRef(opts.enabled);
  enabledRef.current = opts.enabled;
  const onActivateRef = useRef(opts.onActivate);
  onActivateRef.current = opts.onActivate;
  const thresholdMs = opts.thresholdMs ?? DEFAULT_SPACEBAR_LONGPRESS_MS;
  const ignoreFocusedInput = opts.ignoreFocusedInput ?? true;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pressed = false;

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (!enabledRef.current) return;
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      if (ev.repeat) return;
      if (ignoreFocusedInput && isTextEditable(ev.target)) return;
      if (pressed) return;
      pressed = true;
      timer = setTimeout(() => {
        if (!pressed) return;
        debugLog('voice.barge-in.spacebar-longpress', { ms: thresholdMs });
        onActivateRef.current(ev);
      }, thresholdMs);
    };
    const reset = (ev?: KeyboardEvent): void => {
      if (ev && ev.code !== 'Space' && ev.key !== ' ') return;
      pressed = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', reset);
    window.addEventListener('blur', () => reset());
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', reset);
      window.removeEventListener('blur', () => reset());
    };
  }, [thresholdMs, ignoreFocusedInput]);
}
