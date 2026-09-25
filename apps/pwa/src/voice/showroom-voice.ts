'use client';

/** CV-3 Showroom voice integration · phase 1 helpers (2026-05-08).
 *
 *  Pure functions for the multi-panel TTS layer:
 *  - **persona voice picking**: stable hash per panel id → SpeechSynthesisVoice
 *    so the same panel always gets the same voice (codex / claude / gemini
 *    differ even when sharing language). Round-robin within the language-
 *    matching subset of available voices.
 *  - **utterance prefix**: panel name announced before the assistant text
 *    so listeners know who's talking when several panels finalize close
 *    together (e.g., "@codex · 안녕하세요…").
 *
 *  Both helpers are deliberately separate from the React hook so unit
 *  tests can exercise them without `window.speechSynthesis`.
 */

/** Stable 32-bit hash from a string. djb2 variant — collision rate is
 *  fine for the small panel-id pool we're hashing here. */
export function stableHashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Fold into unsigned 32-bit so the modulo below stays positive.
  return h >>> 0;
}

/** Filter `voices` to those matching `language` (e.g. "ko-KR" or "en"),
 *  exact match first, then prefix match. Mirrors `pickVoice` in
 *  use-voice-tts.ts but returns the entire matching subset for picking. */
export function voicesForLanguage(
  voices: readonly SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice[] {
  if (voices.length === 0) return [];
  const lower = language.toLowerCase();
  const exact = voices.filter((v) => v.lang.toLowerCase() === lower);
  if (exact.length > 0) return exact;
  const prefix = lower.split('-')[0]!;
  return voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

/** Pick a stable persona voice for `panelId` from the language-matching
 *  subset. Returns null when no voice matches (caller falls back to the
 *  browser default). */
export function pickPersonaVoice(opts: {
  panelId: string;
  language: string;
  voices: readonly SpeechSynthesisVoice[];
}): SpeechSynthesisVoice | null {
  const candidates = voicesForLanguage(opts.voices, opts.language);
  if (candidates.length === 0) return null;
  const idx = stableHashCode(opts.panelId) % candidates.length;
  return candidates[idx] ?? null;
}

/** Compose the announcement prefix for a panel utterance. Keeps the
 *  prefix short (one breath) — listeners need just enough to know who
 *  speaks next. The mid-dot is unicode (U+00B7) to read as a brief
 *  pause when synthesizers honor punctuation. */
export function showroomUtterancePrefix(displayName: string): string {
  return `@${displayName} · `;
}
