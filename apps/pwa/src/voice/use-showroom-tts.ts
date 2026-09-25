'use client';

/** CV-3 Showroom voice integration · phase 1 hook (2026-05-08).
 *
 *  Layout-level TTS orchestrator. Subscribes to the dmPanelStates map
 *  and detects per-panel `streaming: true → false` transitions where a
 *  fresh assistant message landed (i.e., one more entry than the prior
 *  snapshot). For each detected message it speaks via Web Speech API
 *  with the panel's persona voice (see `showroom-voice.ts`).
 *
 *  Why layout-level (not per-panel) — `window.speechSynthesis` has a
 *  single global queue. Concentrating speak() calls in one place lets us
 *  reason about ordering (panels that finalize within the same React
 *  tick get queued in panel-order) and lets the caller mute everyone
 *  with one toggle. Per-panel hooks would still share the same queue
 *  but multiply the wiring cost.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/chat-runtime';
import type { ShowroomPanel } from '@/lib/showroom/types';
import { panelDisplayName } from '@/lib/showroom/runtime';
import { debugLog } from '@/lib/debug';
import {
  pickPersonaVoice,
  showroomUtterancePrefix,
} from './showroom-voice';

export interface ShowroomPanelTtsState {
  messages: ChatMessage[];
  partial: string;
  streaming: boolean;
  error: string | null;
}

export interface UseShowroomTtsOpts {
  /** Layout-owned panel state map (same shape as ShowroomLayout's
   *  `dmPanelStates`). Hook compares each tick to its prior snapshot
   *  and speaks the new assistant message, if any. */
  panelStates: Readonly<Record<string, ShowroomPanelTtsState>>;
  /** Panels currently mounted in the layout — used for display name +
   *  persona voice id. Order matters for round-robin voice picks. */
  panels: readonly ShowroomPanel[];
  /** Master toggle. When `false`, in-flight speech is cancelled and new
   *  messages are dropped (no enqueue). */
  enabled: boolean;
  /** BCP-47 language hint for voice picking. Matches the chat path
   *  default ('ko-KR'). */
  language?: string;
}

export interface UseShowroomTtsResult {
  /** Web Speech API availability — useful for UI to grey out the toggle
   *  when the runtime can't speak. */
  supported: boolean;
  /** True while the global SpeechSynthesis queue holds at least one
   *  utterance owned by this hook. Phase 2 barge-in reads this to know
   *  whether a cancel + STT activation is meaningful. */
  speaking: boolean;
  /** Cancel every utterance this hook has put on the global queue.
   *  No-op when nothing is speaking. Returns the number of utterances
   *  that were active at the moment of cancel — diagnostic for the
   *  caller that wants to log barge-in efficacy. */
  cancelInFlight: () => number;
}

function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/** Compute the diff against the prior snapshot — returns the panels
 *  that just finalized a NEW assistant message this tick.
 *
 *  Detection rule: prior `streaming = true` AND current `streaming =
 *  false` AND messages length grew. The grew-by check is what makes
 *  the hook tolerate idempotent re-renders.
 */
export function detectNewlyFinalizedAssistantMessages(
  prev: Readonly<Record<string, ShowroomPanelTtsState>>,
  next: Readonly<Record<string, ShowroomPanelTtsState>>,
): Array<{ panelId: string; text: string }> {
  const out: Array<{ panelId: string; text: string }> = [];
  for (const [panelId, cur] of Object.entries(next)) {
    const before = prev[panelId];
    const wasStreaming = before?.streaming ?? false;
    const stoppedStreaming = wasStreaming && !cur.streaming;
    const grew = (cur.messages.length ?? 0) > (before?.messages.length ?? 0);
    if (!stoppedStreaming || !grew) continue;
    const last = cur.messages[cur.messages.length - 1];
    if (!last || last.role !== 'assistant') continue;
    const text = last.text.trim();
    if (!text) continue;
    out.push({ panelId, text });
  }
  return out;
}

export function useShowroomTts(opts: UseShowroomTtsOpts): UseShowroomTtsResult {
  const supported = isSpeechSynthesisSupported();
  const language = opts.language ?? 'ko-KR';
  const enabledRef = useRef(opts.enabled);
  enabledRef.current = opts.enabled;

  // Track utterances we own so phase 2 barge-in can react to "is the
  // panel actually speaking right now?" without poking into the global
  // speechSynthesis state. Counter is incremented on enqueue and
  // decremented on the utterance's end / error / cancel events.
  const inFlightCountRef = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const refreshSpeaking = useCallback((): void => {
    setSpeaking(inFlightCountRef.current > 0);
  }, []);

  const cancelInFlight = useCallback((): number => {
    if (!supported) return 0;
    const cancelled = inFlightCountRef.current;
    if (cancelled === 0) return 0;
    debugLog('voice.tts.cancel-in-flight', { cancelled });
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    inFlightCountRef.current = 0;
    refreshSpeaking();
    return cancelled;
  }, [supported, refreshSpeaking]);

  // Cancel in-flight speech when the master toggle flips off.
  useEffect(() => {
    if (!supported) return;
    if (!opts.enabled) {
      cancelInFlight();
    }
  }, [opts.enabled, supported, cancelInFlight]);

  const prevStatesRef = useRef<Record<string, ShowroomPanelTtsState>>({});
  // Force voice list refresh on `voiceschanged` so we don't miss the
  // first-tick async load some browsers (Chrome) ship with.
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!supported) return;
    const refresh = (): void => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !enabledRef.current) {
      // Update snapshot so re-enable doesn't re-speak everything pent up.
      prevStatesRef.current = opts.panelStates;
      return;
    }
    const finalized = detectNewlyFinalizedAssistantMessages(
      prevStatesRef.current,
      opts.panelStates,
    );
    prevStatesRef.current = opts.panelStates;
    if (finalized.length === 0) return;
    const voices = voicesRef.current;
    for (const { panelId, text } of finalized) {
      const panel = opts.panels.find((p) => p.id === panelId);
      if (!panel) continue;
      const displayName = panelDisplayName(panel, opts.panels);
      const prefix = showroomUtterancePrefix(displayName);
      const utterance = new SpeechSynthesisUtterance(prefix + text);
      const voice = pickPersonaVoice({
        panelId,
        language,
        voices,
      });
      if (voice) utterance.voice = voice;
      utterance.lang = language;
      const finalize = (): void => {
        if (inFlightCountRef.current > 0) {
          inFlightCountRef.current -= 1;
        }
        refreshSpeaking();
      };
      utterance.onend = finalize;
      utterance.onerror = finalize;
      try {
        window.speechSynthesis.speak(utterance);
        inFlightCountRef.current += 1;
        refreshSpeaking();
      } catch { /* ignore */ }
    }
  }, [opts.panelStates, opts.panels, supported, language, refreshSpeaking]);

  return { supported, speaking, cancelInFlight };
}
