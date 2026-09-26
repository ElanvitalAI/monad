// R-OCR follow-up Phase B (2026-05-09) — OCR provider Settings prefs.
//
// PWA-side localStorage-backed preferences for the camera → notes flow.
// `NoteFromImageModal` reads these to seed initial toggle state so the
// user does not re-flip "LLM 비전" / "손글씨" every capture.
//
// Storage shape (localStorage key `elanous.ocr.prefs`):
//   { defaultUseLlmVision: boolean, defaultPreferHandwriting: boolean }
//
// Why localStorage (not S3 sync via daemon):
//   Pref scope = per-device behavior. A user might want LLM Vision
//   default-on for the iPad (sketches / handwritten notes) and
//   default-off on the Mac (high-quality screenshots → cheap Upstage
//   sufficient). Cross-device sync would force one rule on both.
//   The `ocr-prefs/` S3 prefix in `src/storage/s3.ts` is reserved for
//   a future opt-in sync if the user explicitly asks for it.
//
// Cross-ref:
//   apps/pwa/src/components/notes/NoteFromImageModal.tsx (consumer)
//   apps/pwa/src/components/settings/OcrPrefsCard.tsx (UI)
//   src/storage/s3.ts S3_FEATURE_PREFIXES.ocrPrefs (future sync slot)

const STORAGE_KEY = 'elanous.ocr.prefs';

export interface OcrPrefs {
  defaultUseLlmVision: boolean;
  defaultPreferHandwriting: boolean;
}

export const DEFAULT_OCR_PREFS: OcrPrefs = {
  defaultUseLlmVision: false,
  defaultPreferHandwriting: false,
};

/** Load prefs from localStorage. SSR-safe (returns defaults outside
 *  browser). Corrupt JSON / missing keys → defaults; we never throw. */
export function loadOcrPrefs(): OcrPrefs {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return { ...DEFAULT_OCR_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OCR_PREFS };
    const parsed = JSON.parse(raw) as Partial<OcrPrefs>;
    return {
      defaultUseLlmVision: typeof parsed.defaultUseLlmVision === 'boolean'
        ? parsed.defaultUseLlmVision
        : DEFAULT_OCR_PREFS.defaultUseLlmVision,
      defaultPreferHandwriting: typeof parsed.defaultPreferHandwriting === 'boolean'
        ? parsed.defaultPreferHandwriting
        : DEFAULT_OCR_PREFS.defaultPreferHandwriting,
    };
  } catch {
    return { ...DEFAULT_OCR_PREFS };
  }
}

/** Persist prefs (partial merge with current). SSR-safe (no-op outside
 *  browser). Storage failures swallowed — pref loss is not user-fatal. */
export function saveOcrPrefs(patch: Partial<OcrPrefs>): OcrPrefs {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_OCR_PREFS, ...patch };
  }
  const cur = loadOcrPrefs();
  const merged = { ...cur, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* swallow — quota exceeded / private mode */
  }
  return merged;
}

/** Reset to defaults. Tests + a future "Reset OCR prefs" button use this. */
export function resetOcrPrefs(): OcrPrefs {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return { ...DEFAULT_OCR_PREFS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* swallow */ }
  return { ...DEFAULT_OCR_PREFS };
}
