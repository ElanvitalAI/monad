// C2 (PWA pre-iOS round 2 HANDOFF #4 · 2026-05-11):
//   Voice barge-in user-tunable preferences (BI-2 RMS detector).
//
// `speakingThresholdMultiplier` controls how aggressively the BI-2 RMS
// detector ignores TTS-induced echo while playback is active. Default
// `2.0` doubles the listening-baseline threshold (0.04 → 0.08) so most
// AEC residual is suppressed. Loud rooms / sensitive mics may need
// higher (3.0+) to stop self-fires; quiet rooms with great AEC may
// prefer 1.5 for a faster cut-in latency.
//
// Storage shape (localStorage key `monad.voice.prefs`):
//   { speakingThresholdMultiplier: number }
//
// Why localStorage (not S3 sync via daemon):
//   Same reasoning as OcrPrefs — pref scope is per-device behavior.
//   Mac with high-quality DSP wants different tuning than iPad with
//   built-in mic. Cross-device sync would force one rule on both.

const STORAGE_KEY = 'monad.voice.prefs';

export interface VoicePrefs {
  /** BI-2 RMS multiplier applied while TTS plays. 1.0 = no ducking
   *  (legacy BI-1 behavior). 2.0 = default. Clamped to [1.0, 5.0]. */
  speakingThresholdMultiplier: number;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  speakingThresholdMultiplier: 2.0,
};

export const SPEAKING_MULTIPLIER_MIN = 1.0;
export const SPEAKING_MULTIPLIER_MAX = 5.0;

function clampMultiplier(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VOICE_PREFS.speakingThresholdMultiplier;
  return Math.min(SPEAKING_MULTIPLIER_MAX, Math.max(SPEAKING_MULTIPLIER_MIN, v));
}

/** Load prefs from localStorage. SSR-safe · corrupt JSON / missing
 *  keys → defaults. Never throws. */
export function loadVoicePrefs(): VoicePrefs {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_VOICE_PREFS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFS };
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    const mult = typeof parsed.speakingThresholdMultiplier === 'number'
      ? clampMultiplier(parsed.speakingThresholdMultiplier)
      : DEFAULT_VOICE_PREFS.speakingThresholdMultiplier;
    return { speakingThresholdMultiplier: mult };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

/** Persist prefs (partial merge with current). SSR-safe. Storage
 *  failures swallowed — pref loss is not user-fatal. */
export function saveVoicePrefs(patch: Partial<VoicePrefs>): VoicePrefs {
  const cur = loadVoicePrefs();
  const merged: VoicePrefs = {
    speakingThresholdMultiplier: typeof patch.speakingThresholdMultiplier === 'number'
      ? clampMultiplier(patch.speakingThresholdMultiplier)
      : cur.speakingThresholdMultiplier,
  };
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return merged;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch { /* swallow */ }
  return merged;
}

/** Reset to defaults. Tests + future "Reset voice prefs" button use this. */
export function resetVoicePrefs(): VoicePrefs {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_VOICE_PREFS };
  }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* swallow */ }
  return { ...DEFAULT_VOICE_PREFS };
}
