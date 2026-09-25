// PLAN-model-intelligence-router-2026-07-10 · Part B / Phase B1 —
// Per-task smart router core (hybrid C).
//
// Classifies one incoming chat/task input into a `ModelTier`
// (budget..loaded). Hybrid: a free rules/heuristic pass runs first; only
// when it is *ambiguous* (low confidence) do we escalate to an injected
// classifier LLM. On any LLM failure we fall back to the heuristic, so the
// router always returns a tier.
//
// Scope guard (PLAN §3.1): this router is only ever consulted when the
// effective model is `auto`/unpinned. An explicit model pin bypasses it
// entirely — the caller (Phase B2) is responsible for that gate; this
// module is pure classification.
//
// Output is a `ModelTier`, NOT a concrete model. The call-site combines it
// with `resolveLlmTier(provider, tier)` to get the concrete model +
// reasoningLevel. Keeping the router provider-agnostic lets one decision
// feed chat-auto and mission-task dispatch alike.
//
// The LLM path reuses the same `LlmRunner` callback abstraction as
// `preset-suggest-llm.ts` so a single runner wiring serves both.

import type { LlmMessage, LlmRunner } from './preset-suggest-llm.js';
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  isModelTier,
  type ModelTier,
} from './types.js';

/** Where the tier decision came from — surfaced for the cost/decision log
 *  (Phase B5) and for `/model` diagnostics. */
export type TierRouteSource = 'heuristic' | 'llm' | 'fallback' | 'default';

/** Normalized router input. Both chat and mission-task call sites flatten
 *  their state into this shape so one classifier serves both. */
export interface RouterInput {
  /** The user prompt / task prompt driving the decision. */
  text: string;
  /** Where the input comes from — light weighting only. */
  kind?: 'chat' | 'task';
  /** For tasks: the dispatch kind (e.g. 'llm-direct', 'subagent'). */
  taskKind?: string;
  /** Rough input size hint in chars; large → long-context / harder tilt.
   *  Defaults to `text.length` when omitted. */
  sizeHint?: number;
  /** Tools available this turn; tool-heavy turns tilt higher. */
  toolCount?: number;
}

export interface TierRoute {
  tier: ModelTier;
  source: TierRouteSource;
  /** Short human-readable reason — feeds the decision log + diagnostics. */
  rationale: string;
  /** 0..1 confidence in this tier. Below `ambiguityThreshold` the hybrid
   *  path escalates to the LLM classifier when one is available. */
  confidence: number;
}

// ── Heuristic signal keywords ───────────────────────────────────────
//
// Deliberately coarse + bilingual (KO/EN) — the heuristic only needs to
// catch the clear cases confidently; genuinely ambiguous inputs are handed
// to the LLM. Keep these lowercase; matching is done on a lowercased copy.

const CHEAP_KEYWORDS = [
  '요약', '정리', '리스트', '목록', '추출', '분류', '번역',
  'summar', 'extract', 'classif', 'translat', 'list ', 'tl;dr', 'tldr', 'rename', 'lint',
];

const HARD_KEYWORDS = [
  '결정', '판단', '분석', '설계', '아키텍처', '디버그', '증명', '전략', '근거', '왜',
  'reason', 'architect', 'design', 'debug', 'prove', 'strateg', 'analy', 'decide', 'decision',
  'root cause', 'trade-off', 'tradeoff', 'why ',
];

// Length thresholds (chars). Short bulk asks tilt cheap; very long inputs
// tilt harder (more context to reconcile).
const SHORT_INPUT = 40;
const LONG_INPUT = 4000;

/** Confidence at/above which the heuristic is trusted outright (no LLM). */
export const DEFAULT_AMBIGUITY_THRESHOLD = 0.6;

function countMatches(haystack: string, needles: readonly string[]): number {
  let n = 0;
  for (const w of needles) if (haystack.includes(w)) n++;
  return n;
}

/** Pure rules pass. Never throws; always returns a tier + confidence.
 *  Confidence is high for clear signals (strong keyword hits or extreme
 *  length) and deliberately low for the muddled middle so the hybrid
 *  wrapper knows when to consult the LLM. */
export function classifyTierHeuristic(input: RouterInput): TierRoute {
  const text = (input.text ?? '').toLowerCase();
  const size = input.sizeHint ?? input.text?.length ?? 0;
  const tools = input.toolCount ?? 0;

  const cheapHits = countMatches(text, CHEAP_KEYWORDS);
  const hardHits = countMatches(text, HARD_KEYWORDS);

  // Strong cheap signal: bulk verb + short, no hard verbs.
  if (cheapHits > 0 && hardHits === 0 && size <= LONG_INPUT) {
    const conf = size <= SHORT_INPUT ? 0.85 : 0.7;
    return {
      tier: 'budget',
      source: 'heuristic',
      confidence: conf,
      rationale: `bulk/extract keyword (${cheapHits}) · ${size}c · no reasoning cue`,
    };
  }

  // Strong hard signal: reasoning/decision verbs, or very long + tool-heavy.
  if (hardHits >= 2 || (hardHits >= 1 && (size >= LONG_INPUT || tools >= 6))) {
    return {
      tier: 'best',
      source: 'heuristic',
      confidence: 0.8,
      rationale: `reasoning cue (${hardHits}) · ${size}c · ${tools} tools`,
    };
  }

  // Weak hard signal: one reasoning verb, normal size → better, but low
  // confidence (the LLM may see nuance the keyword misses).
  if (hardHits === 1) {
    return {
      tier: 'better',
      source: 'heuristic',
      confidence: 0.45,
      rationale: `single reasoning cue · ${size}c`,
    };
  }

  // Trivially short with no signal → budget, fairly confident.
  if (size <= SHORT_INPUT) {
    return {
      tier: 'budget',
      source: 'heuristic',
      confidence: 0.65,
      rationale: `very short (${size}c) · no reasoning cue`,
    };
  }

  // The muddled middle: normal-length prose, no decisive keyword. Balanced
  // with LOW confidence so the hybrid path escalates to the LLM.
  return {
    tier: DEFAULT_MODEL_TIER,
    source: 'heuristic',
    confidence: 0.4,
    rationale: `no decisive signal · ${size}c`,
  };
}

// ── LLM classifier (hybrid escalation) ──────────────────────────────

const TIER_GUIDANCE: Readonly<Record<ModelTier, string>> = {
  budget: 'trivial / bulk / mechanical — summarize, extract, translate, rename, classify',
  balanced: 'ordinary multi-turn work with no special difficulty',
  better: 'moderate reasoning — non-trivial code, multi-step but bounded',
  best: 'hard reasoning — architecture, debugging, decisions with real stakes',
  loaded: 'the hardest / highest-stakes — deep multi-step planning, must be right',
};

export function buildTierClassifyMessages(text: string): LlmMessage[] {
  const tierLines = MODEL_TIERS.map((t) => `- ${t}: ${TIER_GUIDANCE[t]}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        'You route one task to a model TIER by how much reasoning power it needs.',
        'Tiers (cheap → powerful):',
        tierLines,
        '',
        'Respond with ONE JSON object on a single line. Schema:',
        '  {"tier": "<id>", "confidence": <0..1 float>, "reason": "<short>"}',
        'Rules:',
        '  - "tier" MUST be one of: budget, balanced, better, best, loaded.',
        '  - Pick the CHEAPEST tier that can still do the task well — do not over-provision.',
        '  - Output ONLY the JSON object. No preamble, no fences.',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ];
}

/** Parse the classifier reply. Tolerates fences / leading prose. Returns
 *  null on any malformed reply so the caller falls back to the heuristic. */
export function parseTierClassifyReply(raw: string): TierRoute | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const stripped = raw.replace(/```(?:json)?/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stripped.slice(first, last + 1)); }
  catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (!isModelTier(r.tier)) return null;
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 0.7;
  const reason = typeof r.reason === 'string' && r.reason.trim().length > 0
    ? r.reason.trim()
    : 'llm classification';
  return { tier: r.tier, source: 'llm', confidence, rationale: reason };
}

export interface RouteTierOpts {
  /** Heuristic confidence at/above which we skip the LLM. */
  ambiguityThreshold?: number;
  /** Hard wall-clock cap (ms) for the classifier call. Default 4000. */
  timeoutMs?: number;
}

/** Hybrid C entry point. Runs the heuristic; if it is confident (or no
 *  `runLlm` is supplied) returns it; otherwise consults the classifier LLM
 *  and falls back to the heuristic on any failure. Never throws. */
export async function routeTier(
  input: RouterInput,
  runLlm?: LlmRunner,
  opts: RouteTierOpts = {},
): Promise<TierRoute> {
  const heuristic = classifyTierHeuristic(input);
  const threshold = opts.ambiguityThreshold ?? DEFAULT_AMBIGUITY_THRESHOLD;

  if (!runLlm || heuristic.confidence >= threshold) return heuristic;
  if (!input.text || input.text.trim().length === 0) {
    return { ...heuristic, source: 'fallback' };
  }

  const timeoutMs = opts.timeoutMs ?? 4000;
  let raw: string;
  try {
    raw = await withTimeout(runLlm(buildTierClassifyMessages(input.text)), timeoutMs);
  } catch {
    return { ...heuristic, source: 'fallback' };
  }
  const parsed = parseTierClassifyReply(raw);
  if (!parsed) return { ...heuristic, source: 'fallback' };
  return parsed;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error('task-router timeout')), ms);
    promise.then(
      (v) => { clearTimeout(handle); resolve(v); },
      (e: unknown) => { clearTimeout(handle); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
