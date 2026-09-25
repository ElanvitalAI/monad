// PLAN-model-intelligence-router-2026-07-10 · Part B / Phase B3 —
// User-nuance tier adjustment.
//
// On top of the content router's tier, an explicit nuance in the SAME
// message can nudge the tier: "이건 신중히" / "정확하게" bumps up, "대충
// 빨리" / "just quickly" drops down. This is a cheap keyword pass (runs
// per auto turn, so no LLM) that returns a delta; the router applies it and
// clamps to the tier range. The heavier LLM intent path already exists in
// `nl-tier-switch.ts` for the explicit chat switch command — this is the
// lightweight inline signal for auto routing.

import { MODEL_TIERS, modelTierRank, type ModelTier } from './types.js';

const ESCALATE = [
  '신중', '중요', '정확', '꼼꼼', '제대로', '반드시', '깊게', '깊이',
  'careful', 'important', 'precise', 'thorough', 'double-check', 'double check',
  'make sure', 'high quality', 'best effort', 'get it right',
];

const DEESCALATE = [
  '대충', '빨리', '간단', '대강', '가볍게', '적당히',
  'quick', 'quickly', 'rough', 'draft', 'just ', 'simple', 'cheap', 'fast ',
];

export interface NuanceSignal {
  /** Tier delta to apply (-2..+2). */
  delta: number;
  matched: string[];
}

function hits(haystack: string, needles: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of needles) if (haystack.includes(w)) out.push(w);
  return out;
}

/** Detect an inline nuance signal. Pure + cheap. A message with both
 *  escalate and de-escalate cues nets out (they cancel). */
export function detectNuanceDelta(text: string): NuanceSignal {
  const t = (text ?? '').toLowerCase();
  const up = hits(t, ESCALATE);
  const down = hits(t, DEESCALATE);
  let delta = 0;
  if (up.length) delta += up.length >= 2 ? 2 : 1;
  if (down.length) delta -= down.length >= 2 ? 2 : 1;
  return { delta, matched: [...up, ...down] };
}

/** Apply a tier delta, clamped to the tier range. */
export function adjustTier(tier: ModelTier, delta: number): ModelTier {
  if (!delta) return tier;
  const rank = modelTierRank(tier);
  const next = Math.max(0, Math.min(MODEL_TIERS.length - 1, rank + delta));
  return MODEL_TIERS[next]!;
}
