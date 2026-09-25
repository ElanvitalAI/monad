// M2-4 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Per-task preset suggester (MVP heuristic).
//
// Given a chunk of text (task title · memo · intake decomposition
// description), suggest which use-case preset best fits. Examples:
//
//   "Doctor's notes from today's appointment"        → medical_dictation
//   "Engineering standup Mon AM"                     → meeting
//   "Live subtitle the keynote stream"               → live_caption
//   "Read background podcast during overnight tasks" → sleep_mode
//   "Reminder · pick up milk"                        → casual_chat
//
// MVP uses keyword heuristics — no LLM call, no network. Returns a
// confidence score 0..1 derived from match count so callers can
// surface only high-confidence suggestions (typical UX: show when
// confidence ≥ 0.4 · auto-apply when ≥ 0.8).
//
// LLM-backed version (v2) will route the same input through the
// active LLM tier and replace this function transparently.

import type { PresetId } from './preset-catalog.js';

interface RuleSpec {
  preset: PresetId;
  /** Lowercased keyword/phrase that contributes a match. */
  keywords: readonly string[];
  /** Per-keyword weight — useful when a single strong term (e.g.
   *  "medical") should outrank a half-dozen weaker matches. */
  weight: number;
}

// Order matters only when scores tie — we surface the *most specific*
// preset first by listing the niche ones (medical · live · sleep)
// before the broader buckets (meeting · casual).
const RULES: readonly RuleSpec[] = [
  {
    preset: 'medical_dictation',
    weight: 2,
    keywords: [
      'medical', 'legal', 'doctor', 'patient', 'clinic', 'clinical',
      'prescription', 'diagnosis', 'symptom', 'treatment', 'medication',
      'lawyer', 'attorney', 'court', 'deposition', 'contract', 'plaintiff',
      'dictation', 'transcript',
      '의료', '환자', '진단', '처방', '법률', '변호', '계약', '판례',
    ],
  },
  {
    preset: 'live_caption',
    weight: 2,
    keywords: [
      'live', 'caption', 'captioning', 'subtitle', 'stream', 'broadcast',
      'keynote', 'webinar', 'realtime', 'real-time',
      '자막', '실시간', '생방송',
    ],
  },
  {
    preset: 'sleep_mode',
    weight: 2,
    keywords: [
      'overnight', 'background', 'sleep mode', 'night',
      'while sleeping', 'while away', 'no api', 'offline',
      '심야', '오프라인', '백그라운드', '취침',
    ],
  },
  {
    preset: 'meeting',
    weight: 1,
    keywords: [
      'meeting', 'standup', 'stand-up', 'review', 'sync', 'planning',
      '1:1', 'one-on-one', 'retro', 'kickoff', 'call', 'discussion',
      'minutes', 'agenda', 'notes',
      '회의', '미팅', '주간', '워크샵', '워크숍', '회식',
    ],
  },
  {
    preset: 'casual_chat',
    weight: 1,
    // Deliberately specific — 'note'/'quick' would over-match common
    // English. We keep the list short so casual_chat earns its hits.
    keywords: [
      'reminder', 'todo', 'casual chat', 'casual',
      'ping', 'dm', 'sms',
      '메모', '리마인더', '문자', '메시지', '잡담',
    ],
  },
];

export interface PresetSuggestion {
  preset: PresetId;
  /** 0..1 — higher = more matches contributed by the winning preset. */
  confidence: number;
  /** Words that contributed to the winning preset's score · useful
   *  for "we suggested medical_dictation because we saw 'patient',
   *  'prescription'" hover hints. */
  matchedKeywords: readonly string[];
}

const CASUAL_FALLBACK: PresetSuggestion = {
  preset: 'casual_chat',
  confidence: 0,
  matchedKeywords: [],
};

/** Suggest a preset for the given text. Always returns *something* —
 *  callers should inspect `confidence` (≥ 0.4 typical threshold) to
 *  decide whether to surface the suggestion. */
export function suggestPresetForText(text: string): PresetSuggestion {
  if (typeof text !== 'string') return CASUAL_FALLBACK;
  const haystack = text.toLowerCase();
  if (haystack.trim().length === 0) return CASUAL_FALLBACK;

  // Tally weighted matches per preset.
  const scores = new Map<PresetId, { score: number; matches: string[] }>();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (!haystack.includes(kw)) continue;
      const entry = scores.get(rule.preset) ?? { score: 0, matches: [] };
      entry.score += rule.weight;
      entry.matches.push(kw);
      scores.set(rule.preset, entry);
    }
  }

  if (scores.size === 0) return CASUAL_FALLBACK;

  // Winner = highest score · ties broken by RULES order.
  let winner: { preset: PresetId; score: number; matches: string[] } | null = null;
  for (const rule of RULES) {
    const s = scores.get(rule.preset);
    if (!s) continue;
    if (!winner || s.score > winner.score) {
      winner = { preset: rule.preset, score: s.score, matches: s.matches };
    }
  }
  if (!winner) return CASUAL_FALLBACK;

  // Confidence: cap at 1.0 around 5 weighted matches — beyond that
  // the suggestion is already very confident.
  const confidence = Math.min(1, winner.score / 5);
  return {
    preset: winner.preset,
    confidence,
    matchedKeywords: winner.matches,
  };
}
