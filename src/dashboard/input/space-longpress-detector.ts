// PR-S1V.D4 (sprint 21-Parallel-Voice · 2026-04-29) — Space long-press
// detector for dictation-first UX.
//
// Detects "Space hold" intent without relying on the kitty `>3u`
// release-event protocol. The dashboard's idle key dispatch runs in
// `>1u` mode so Space release events aren't naturally available; this
// detector reconstructs hold/release semantics from the OS key-repeat
// stream that `>1u` *does* deliver:
//
//   tap         press (one keystroke · no repeats within gap window)
//   long-press  press → repeat → repeat → ... → no follow-up keystroke
//                within `repeatGapMs` (treated as release) OR a
//                non-Space keystroke arrives (treated as cancel-by-other)
//
// The detector itself doesn't talk to audio-capture or kitty levels —
// it just notifies the host via callbacks (`onLongPress` / `onLongRelease`
// / `onTap`). The host (voice-input-host) is responsible for kicking
// off the dictation lifecycle on `onLongPress`, finalising on
// `onLongRelease`, and ignoring `onTap`.
//
// Reference: PLAN-voice-and-dictation-unified-2026-04-29.md §5.1 + §11
// Phase D4 + risk §10 (Typing 중 false-trigger 완화 = threshold 보수적
// 250ms 시작 · cursor inline cue · char fallback).

import { debug } from '../../debug/log.js';

// ── Public types ──────────────────────────────────────────────────

export interface SpaceLongPressDetectorOpts {
  /** Hold duration that flips the detector from "tap" to "long-press".
   *  Conservative default 250 ms — see PLAN §10. Tests pass shorter
   *  values for deterministic timing. */
  thresholdMs?: number;
  /** Gap after the last Space keystroke before the detector concludes
   *  the user released. Must be > the OS key-repeat interval (typically
   *  30-60 ms). 80 ms is generous enough to survive a missed repeat
   *  without making release feel laggy. */
  repeatGapMs?: number;
  /** Test seam — `setTimeout` substitute for deterministic clocks. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Test seam — `Date.now` substitute. */
  now?: () => number;

  /** Threshold reached. Host kicks off dictation here (audio capture
   *  start · kitty `>3u` toggle if desired · indicator). */
  onLongPress?: () => void;
  /** Long-press concluded (gap or other-key cancel). Host finalises
   *  dictation (capture stop · STT · chat-main inject). */
  onLongRelease?: () => void;
  /** Threshold *not* reached before release/cancel — i.e. ordinary
   *  Space tap. Host ignores; the chat input already received the
   *  Space char in its own write path. */
  onTap?: () => void;
  /** PR-S1V.D5+ — fires the moment `noteSpaceKey` transitions
   *  idle → pending (the very first press of a new sequence). Host
   *  emits a subtle "listening…" indicator here so the user gets
   *  immediate visual feedback during the 0..thresholdMs window
   *  before the detector commits to recording. Without this, the
   *  600 ms wait feels like the chord did nothing. Mirrors Gemini
   *  CLI's "possible-hold" UX phase. */
  onPressFirst?: () => void;
}

export interface SpaceLongPressDetector {
  /** Forward every Space keystroke (press *or* repeat — `>1u` doesn't
   *  distinguish, and the detector treats them identically). */
  noteSpaceKey(): void;
  /** Explicit release — only meaningful when the host enabled `>3u`
   *  after `onLongPress` fired. Without `>3u`, release is inferred
   *  from `repeatGapMs` and this is a no-op. */
  noteRelease(): void;
  /** Any non-Space keystroke. Cancels a pending press (treated as
   *  tap) or ends an in-flight long-press (treated as release). */
  noteOtherKey(): void;
  /** Snapshot of internal state for tests + log inspection. */
  getState(): SpaceLongPressState;
  /** Tear down — clears any pending timers. */
  dispose(): void;
}

export type SpaceLongPressState = 'idle' | 'pending' | 'fired';

// ── Implementation ────────────────────────────────────────────────

// PR-S1V.D5 (2026-04-29) — Gemini hybrid pattern. Threshold 600 ms +
// release grace 300 ms matches Gemini CLI's `useVoiceMode` constants
// (HOLD_DELAY_MS · RELEASE_DELAY_MS) which are tuned to keep short
// taps as ordinary char input and treat sustained holds as PTT. Earlier
// values (250/80) fired the threshold too eagerly for typing-heavy
// surfaces and the gap inferred release before users finished a
// sentence. Gemini's matching pair is the most-validated reference for
// this exact UX.
const DEFAULT_THRESHOLD_MS = 600;
const DEFAULT_REPEAT_GAP_MS = 300;

export function createSpaceLongPressDetector(
  opts: SpaceLongPressDetectorOpts = {},
): SpaceLongPressDetector {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const repeatGapMs = opts.repeatGapMs ?? DEFAULT_REPEAT_GAP_MS;
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms) as unknown);
  const clearTimer =
    opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = opts.now ?? Date.now;

  let state: SpaceLongPressState = 'idle';
  let firstPressAt = 0;
  let thresholdHandle: unknown = null;
  let gapHandle: unknown = null;

  function log(event: string, data?: unknown): void {
    if (debug.enabled) debug.log('voice.longpress', event, data);
  }

  function clearThresholdTimer(): void {
    if (thresholdHandle !== null) {
      try { clearTimer(thresholdHandle); } catch { /* best-effort */ }
      thresholdHandle = null;
    }
  }

  function clearGapTimer(): void {
    if (gapHandle !== null) {
      try { clearTimer(gapHandle); } catch { /* best-effort */ }
      gapHandle = null;
    }
  }

  /** Schedule (or reschedule) the gap timer that infers release. */
  function armGapTimer(): void {
    clearGapTimer();
    gapHandle = setTimer(() => {
      gapHandle = null;
      if (state === 'fired') {
        log('release.gap-inferred', { heldMs: now() - firstPressAt });
        state = 'idle';
        opts.onLongRelease?.();
      } else if (state === 'pending') {
        // Threshold timer hadn't fired yet — treat as ordinary tap.
        log('tap.gap-inferred', { heldMs: now() - firstPressAt });
        clearThresholdTimer();
        state = 'idle';
        opts.onTap?.();
      }
    }, repeatGapMs);
  }

  function fireThreshold(): void {
    thresholdHandle = null;
    if (state !== 'pending') return;
    log('long-press.fire', { thresholdMs, heldMs: now() - firstPressAt });
    state = 'fired';
    opts.onLongPress?.();
    // After firing we still need a gap timer running; the next
    // noteSpaceKey will refresh it, otherwise this one will conclude
    // the long-press on natural release.
    armGapTimer();
  }

  function noteSpaceKey(): void {
    if (state === 'idle') {
      // First press of a new sequence.
      firstPressAt = now();
      state = 'pending';
      log('press.first');
      thresholdHandle = setTimer(fireThreshold, thresholdMs);
      // PR-S1V.D5+ — fire pending-phase callback so host can emit
      // a "listening…" HUD indicator during the 0..threshold window.
      // Without it, the user has no feedback that their press was
      // registered until the threshold fires (~600 ms later).
      opts.onPressFirst?.();
    } else {
      log('press.repeat', { state, heldMs: now() - firstPressAt });
    }
    armGapTimer();
  }

  function noteRelease(): void {
    if (state === 'fired') {
      log('release.explicit', { heldMs: now() - firstPressAt });
      clearGapTimer();
      state = 'idle';
      opts.onLongRelease?.();
    } else if (state === 'pending') {
      log('tap.explicit', { heldMs: now() - firstPressAt });
      clearThresholdTimer();
      clearGapTimer();
      state = 'idle';
      opts.onTap?.();
    }
    // idle → release is a no-op (e.g. spurious release before any press).
  }

  function noteOtherKey(): void {
    if (state === 'idle') return;
    if (state === 'fired') {
      log('release.other-key', { heldMs: now() - firstPressAt });
      clearGapTimer();
      state = 'idle';
      opts.onLongRelease?.();
    } else {
      log('tap.other-key', { heldMs: now() - firstPressAt });
      clearThresholdTimer();
      clearGapTimer();
      state = 'idle';
      opts.onTap?.();
    }
  }

  function getState(): SpaceLongPressState {
    return state;
  }

  function dispose(): void {
    clearThresholdTimer();
    clearGapTimer();
    state = 'idle';
  }

  return { noteSpaceKey, noteRelease, noteOtherKey, getState, dispose };
}

/** Convenience predicate — chat input / dashboard input handlers can
 *  use this to decide whether to forward a key to the detector at all.
 *  The detector itself doesn't filter (a non-matching `noteSpaceKey`
 *  call would corrupt state) so callers must gate. Mouse events are
 *  never Space; we still gate explicitly to keep call-sites self-
 *  documenting.
 *
 *  PR-S1V.D4-β (2026-04-29) — chord changed from plain `Space` to
 *  `Ctrl+Shift+Space`. Rationale: D4-α dogfood showed plain `Space`
 *  hold polluted the chat input buffer with OS key-repeat chars
 *  (`"    "` accumulation) before the threshold fired. Modifier-only
 *  chords like `Ctrl+Shift+Space` carry no char input and don't
 *  conflict with typing, so the detector can safely run inside chat
 *  input focus. The `Ctrl+Shift+V` voice-mode chord shares the same
 *  prefix, keeping the mental model "Ctrl+Shift+<X>" → voice-related.
 */
export function isDictationHoldKey(
  key: { name?: string; mouse?: unknown; ctrl?: boolean; alt?: boolean; shift?: boolean },
): boolean {
  if (key.mouse) {
    if (debug.enabled) debug.log('voice.predicate.reject', 'mouse-event');
    return false;
  }
  // PR-S1V.D5 — accept either chord:
  //   - `Ctrl+Shift+Space` (canonical · D4-β)
  //   - `Ctrl+Shift+D` / `Ctrl+Shift+ㅇ` (Korean IME equivalent · D4-trial)
  // Ghostty intercepts Ctrl+Shift+Space at the terminal layer in some
  // configurations, so we accept the letter-D fallback too. Both share
  // the same Ctrl+Shift+ prefix as Ctrl+Shift+V (voice mode) so the
  // mental model "Ctrl+Shift+<X>" → voice-related stays intact. The
  // user's terminal/keymap decides which one actually reaches us.
  const isCanonicalSpaceChord = key.name === 'space';
  const isLetterDChord = key.name === 'd' || key.name === 'D' || key.name === 'ㅇ';
  if (!isCanonicalSpaceChord && !isLetterDChord) {
    if (debug.enabled) {
      debug.log('voice.predicate.reject', 'wrong-key-name', {
        name: key.name, expected: 'space|d|D|ㅇ',
      });
    }
    return false;
  }
  if (!key.ctrl) {
    if (debug.enabled) debug.log('voice.predicate.reject', 'missing-ctrl', { name: key.name });
    return false;
  }
  if (!key.shift) {
    if (debug.enabled) debug.log('voice.predicate.reject', 'missing-shift', { name: key.name });
    return false;
  }
  if (key.alt) {
    if (debug.enabled) debug.log('voice.predicate.reject', 'alt-modifier', { name: key.name });
    return false;
  }
  if (debug.enabled) debug.log('voice.predicate.accept', 'chord-match', { name: key.name });
  return true;
}

/** PR-S1V.D4-γ (2026-04-29) — plain `Space` (no modifiers) hold-to-talk
 *  predicate. Used **outside chat-main focus** only — browse pane,
 *  dashboard background, VW non-terminal pane, etc. — where Space has
 *  no char-input role and the typing-collision risk that drove the
 *  D4-α → D4-β chord change doesn't apply.
 *
 *  unified PLAN §5.3: "browse / pane / dashboard background → long-
 *  press Space → dictation · chat-main input auto-open 후 transcript
 *  insert". This predicate is the gate for that path; the detector
 *  itself reuses the same lifecycle as the `Ctrl+Shift+Space` chord.
 *
 *  Per §5.4 the dashboard wiring layer is responsible for excluding
 *  PTY / terminal panes — this predicate doesn't see surface focus
 *  and would happily say `true` for a Space in a terminal context.
 */
export function isPlainSpaceHoldKey(
  key: { name?: string; mouse?: unknown; ctrl?: boolean; alt?: boolean; shift?: boolean },
): boolean {
  if (key.mouse) return false;
  if (key.name !== 'space') return false;
  if (key.ctrl || key.alt || key.shift) return false;
  return true;
}

/**
 * @deprecated PR-S1V.D4-β renamed to `isDictationHoldKey` (Ctrl+Shift+
 *  Space chord). For the original plain-Space predicate revived in
 *  D4-γ for outside-input use, see `isPlainSpaceHoldKey`. Remove this
 *  alias once we're confident no external caller relies on the old name.
 */
export const isSpaceKeyForLongPress = isDictationHoldKey;
