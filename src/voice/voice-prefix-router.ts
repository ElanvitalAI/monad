// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice transcript
// brand prefix detection + strip helper.
//
// Voice mode 의 Space hold 후 STT 결과 text 의 prefix 가 brand 명시
// (`코덱스에게 ...`, `gemini, ...`) 이면 해당 brand pane 으로 routing.
// Prefix 없으면 focused pane fallback. 4-pane mixed room 시나리오에서
// 자연 발화 패턴 지원.
//
// Reference: PLAN-voice-input-bridge-s1v4-2026-04-29.md §7.

export type VoiceBrand = 'codex' | 'claude' | 'gemini' | 'elanous';

export const VOICE_BRANDS: readonly VoiceBrand[] = [
  'codex',
  'claude',
  'gemini',
  'elanous',
] as const;

export interface VoicePrefixRouteResult {
  /** Detected brand · null when no prefix found. */
  brand: VoiceBrand | null;
  /** Transcript with the detected prefix stripped (trimmed). When no
   *  prefix is detected this equals the original input. */
  text: string;
  /** Was a prefix actually detected and stripped? */
  matched: boolean;
}

// ── Prefix patterns ────────────────────────────────────────────────

// Each brand has a list of (Korean + English) prefixes. Korean prefixes
// require a postposition (~에게/~한테/~,) so a bare brand mention inside
// a sentence ("코덱스 결과 보여줘" — talking *about* codex) is NOT
// stripped. English prefixes accept a comma or "to <brand>".
//
// Order: longest match first within each brand to avoid partial-strip
// when a longer postposition variant exists ("코덱스에게는" should match
// the "코덱스에게" form, not "코덱스" alone).
type PrefixSpec = readonly { pattern: RegExp; }[];

function brandPrefixes(brand: VoiceBrand, koreanRoots: readonly string[], englishRoots: readonly string[]): { brand: VoiceBrand; specs: PrefixSpec } {
  const specs: { pattern: RegExp }[] = [];

  // Korean: <root>에게(는)?, <root>한테(는)?, <root>(이)?,? then space.
  for (const root of koreanRoots) {
    // 가장 긴 form 부터 — 매치 시 자동 strip 안전
    specs.push({ pattern: new RegExp(`^\\s*${root}(?:에게는|한테는|에게|한테|에)\\s+`, 'i') });
    // Bare root + comma (예: "코덱스, react 만들어줘")
    specs.push({ pattern: new RegExp(`^\\s*${root}\\s*,\\s+`, 'i') });
  }

  // English: "<root>," 또는 "to <root>" 형태
  for (const root of englishRoots) {
    specs.push({ pattern: new RegExp(`^\\s*to\\s+${root}\\s*,?\\s+`, 'i') });
    specs.push({ pattern: new RegExp(`^\\s*${root}\\s*,\\s+`, 'i') });
  }

  return { brand, specs };
}

const PREFIX_TABLE = [
  brandPrefixes('codex',  ['코덱스', '코덱'],            ['codex']),
  brandPrefixes('claude', ['클로드', '클라우드'],         ['claude']),
  brandPrefixes('gemini', ['제미니', '지미니', '제미나이'], ['gemini']),
  brandPrefixes('elanous',  ['엘라누스'],                    ['elanous']),
] as const;

// ── routeVoiceTranscript ────────────────────────────────────────────

/**
 * Detect a brand prefix at the start of `text` and return the matched
 * brand + the text with the prefix stripped. Order:
 *   1. Try every (brand, pattern) — first match wins.
 *   2. Korean postposition forms are tried before bare-with-comma so
 *      "코덱스에게" beats "코덱스," when both could fire.
 *   3. No match → `{ brand: null, text: <original trimmed>, matched: false }`.
 *
 * The matcher is **case-insensitive** (English) and **whitespace-tolerant**.
 * Korean patterns rely on full-width characters so case folding is moot.
 */
export function routeVoiceTranscript(text: string): VoicePrefixRouteResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { brand: null, text: '', matched: false };
  }

  for (const { brand, specs } of PREFIX_TABLE) {
    for (const { pattern } of specs) {
      const match = trimmed.match(pattern);
      if (match) {
        const stripped = trimmed.slice(match[0].length).trim();
        return { brand, text: stripped, matched: true };
      }
    }
  }

  return { brand: null, text: trimmed, matched: false };
}

// ── Test helpers / introspection ────────────────────────────────────

/** Brands the router can route to. Exposed for UI / tests. */
export function getSupportedBrands(): readonly VoiceBrand[] {
  return VOICE_BRANDS;
}
