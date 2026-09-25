// ── Skill router ──
//
// Phase 1 of the "natural language → skill" hybrid (PLAN §Task 4 E).
// Pure scoring: given a user's free-text input and an index of skill
// metadata, return the best-matching skill(s) by counting trigger
// keyword occurrences. Description words are a weaker secondary
// signal with a capped contribution.
//
// Phase 2 (LLM router) can bolt on top of this by calling
// `detectSkillTrigger` first and only invoking an LLM classifier when
// the result is ambiguous (two top candidates with the same score,
// or a borderline confidence).
//
// Design constraints:
//   - Pure function — no disk access, no provider calls. Tests drive
//     it with hand-rolled SkillIndexEntry[].
//   - Case-insensitive substring match (works for Korean + English).
//   - Empty trigger list → skill is INELIGIBLE for auto-routing, but
//     may still match weakly via description. (Author opts in by
//     setting `triggers:` in frontmatter.)
//   - Deterministic tie-breaking: alphabetical on name so the log
//     output doesn't reshuffle across runs.

import type { SkillIndexEntry } from './index.js';
import { tierMeetsMin, type SkillTier } from './runner.js';

export interface SkillCandidate {
  name: string;
  /** Raw float score: sum of matched-trigger weights + capped
   *  description-word bonus. Explicit triggers weigh 1.0, extracted
   *  (Phase 3) weigh 0.6. Comparable within one detection call; not
   *  calibrated across runs. */
  score: number;
  /** Explicit trigger keywords that matched (for hint display and
   *  `shouldAutoRoute` gating — auto-route requires at least one
   *  explicit match). */
  matchedTriggers: string[];
  /** Phase-3 extracted-from-description triggers that matched. Shown
   *  in the hint when no explicit match is available, but never
   *  gates auto-route on its own. */
  matchedExtractedTriggers: string[];
  /** True when the skill's frontmatter declared autoTrigger. The
   *  dashboard uses this to decide whether to offer auto-execution
   *  vs a suggestion-only hint. */
  autoTrigger: boolean;
  /** Session 21 — minimum tier the skill declared. Session 21 router
   *  propagates this onto candidates so `shouldAutoRoute` can gate
   *  auto-execution on active-model capability. Undefined = legacy
   *  SKILL.md with no declaration; treated as T2. */
  minTier?: SkillTier;
  /** Kept so the suggestion log can print a one-liner. */
  description: string;
}

export interface DetectResult {
  /** All candidates with score > 0, sorted by (score desc, name asc). */
  candidates: SkillCandidate[];
  /** Highest-scoring candidate, or null when nothing matched. Convenience
   *  — equal to `candidates[0] ?? null`. */
  top: SkillCandidate | null;
  /** True when the top candidate strictly outscored every other
   *  candidate. False for ties at the top, which the caller should
   *  treat as ambiguous (show a picker, fall through to LLM, etc.). */
  unambiguous: boolean;
}

export interface DetectOptions {
  /** Minimum score for a candidate to be surfaced. Defaults to 0.6
   *  so a single extracted-trigger hit qualifies (an explicit hit
   *  scores 1.0 and clears it handily). */
  minScore?: number;
  /** Max bonus points a skill can pick up from description-word matches.
   *  Caps noise from skills whose description happens to contain common
   *  words ("요약", "help", …) shared by many inputs. */
  descriptionCap?: number;
  /** Minimum description-word length for the bonus to count. Shorter
   *  words are too noisy to be a useful signal. */
  descriptionMinWordLen?: number;
  /** Weight per explicit-trigger hit. Default 1.0 — authored intent
   *  is the strongest signal available. */
  explicitTriggerWeight?: number;
  /** Weight per extracted-trigger hit (Phase 3). Default 0.6 so an
   *  extracted-only match is surfaced as a hint but a single explicit
   *  hit wins in a head-to-head. */
  extractedTriggerWeight?: number;
}

const DEFAULT_OPTS: Required<DetectOptions> = {
  minScore: 0.6,
  descriptionCap: 0.5,
  descriptionMinWordLen: 4,
  explicitTriggerWeight: 1.0,
  extractedTriggerWeight: 0.6,
};

/** Main entry point. Returns zero or more candidates ranked by score. */
export function detectSkillTrigger(
  userText: string,
  index: SkillIndexEntry[],
  opts: DetectOptions = {},
): DetectResult {
  const {
    minScore, descriptionCap, descriptionMinWordLen,
    explicitTriggerWeight, extractedTriggerWeight,
  } = { ...DEFAULT_OPTS, ...opts };
  const haystack = userText.toLowerCase();
  if (!haystack.trim() || index.length === 0) {
    return { candidates: [], top: null, unambiguous: false };
  }

  const candidates: SkillCandidate[] = [];

  for (const skill of index) {
    const matchedTriggers: string[] = [];
    for (const trig of skill.triggers) {
      const t = trig.toLowerCase().trim();
      if (t && haystack.includes(t)) matchedTriggers.push(trig);
    }

    // Phase 3 — extracted triggers weighed separately. Index dedups
    // against explicit already, so there's no double-counting risk.
    const matchedExtractedTriggers: string[] = [];
    for (const trig of skill.extractedTriggers ?? []) {
      const t = trig.toLowerCase().trim();
      if (t && haystack.includes(t)) matchedExtractedTriggers.push(trig);
    }

    let score =
      matchedTriggers.length * explicitTriggerWeight +
      matchedExtractedTriggers.length * extractedTriggerWeight;

    // Description bonus: count distinct description words (length >=
    // threshold) that appear in the user text. Cap total at
    // descriptionCap so common words don't dominate a genuine trigger.
    if (skill.description) {
      const descWords = uniqueWords(skill.description, descriptionMinWordLen);
      let bonus = 0;
      for (const w of descWords) {
        if (haystack.includes(w)) bonus += 0.1;
      }
      score += Math.min(bonus, descriptionCap);
    }

    if (score >= minScore) {
      candidates.push({
        name: skill.name,
        score,
        matchedTriggers,
        matchedExtractedTriggers,
        autoTrigger: skill.autoTrigger,
        minTier: skill.minTier,
        description: skill.description,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  const top = candidates[0] ?? null;
  const unambiguous =
    candidates.length === 1 ||
    (candidates.length > 1 && candidates[0]!.score > candidates[1]!.score + 1e-9);

  return { candidates, top, unambiguous };
}

/** Should the dashboard auto-route to this candidate, or only suggest?
 *
 *  Auto-route requires ALL of:
 *   - user opted in globally via `autoRouteEnabled`
 *   - unambiguous top candidate
 *   - candidate.score >= `minScore` (default 1.0 — excludes a lone
 *     extracted-trigger hit at 0.6)
 *   - candidate.autoTrigger === true (only when `requireAutoTrigger`
 *     is true, which is the default — set false to let any skill
 *     auto-route once its score clears the bar)
 *
 *  Extracted-vs-explicit is no longer a hard gate — the score already
 *  reflects that distinction (extracted weigh 0.6, explicit 1.0). The
 *  minScore knob lets users pick their safety envelope.
 */
export function shouldAutoRoute(
  result: DetectResult,
  opts: {
    autoRouteEnabled?: boolean;
    minScore?: number;
    requireAutoTrigger?: boolean;
    /** Session 21 — active model tier. When passed, the skill's
     *  declared `minTier` is checked against it: weaker active models
     *  block auto-route on T1-only skills. When undefined, no gate
     *  (keeps existing callers / tests passing). */
    activeTier?: SkillTier;
  } = {},
): boolean {
  // Default raised from 1.0 → 2.0 in session 21. 1.0 was a single
  // explicit trigger OR ~two extracted ones, which empirically fired
  // too aggressively once the skill pool grew past ~20. 2.0 demands
  // a stronger signal (two explicit, or one explicit plus corroborating
  // extracted/description bonus). Paired with user-config.ts
  // SR_DEFAULTS.autoRouteMinScore = 2.0 as a second layer so a
  // partially-populated config file can't regress.
  const minScore = opts.minScore ?? 2.0;
  const requireAutoTrigger = opts.requireAutoTrigger ?? true;
  if (!opts.autoRouteEnabled) return false;
  if (!result.top) return false;
  if (!result.unambiguous) return false;
  if (result.top.score < minScore) return false;
  if (requireAutoTrigger && !result.top.autoTrigger) return false;
  // Tier gate — skip when caller didn't pass an activeTier.
  if (opts.activeTier && !tierMeetsMin(opts.activeTier, result.top.minTier)) {
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════
// Phase 2 — LLM classifier fallback
// ═══════════════════════════════════════════════════════════
//
// `detectLLM` lets the dashboard disambiguate cases the keyword
// router can't handle on its own. It always runs the keyword router
// first (cheap, deterministic) and only reaches for an LLM when:
//   - no keyword candidate met the score threshold, OR
//   - two or more candidates are tied at the top (ambiguous).
//
// The classifier is injected as `opts.classify`. That keeps this
// module pure — tests drive it with a fake that returns a canned
// JSON response, and the dashboard wires in a real provider call.
// When no classifier is supplied, we return the keyword result
// as-is (graceful degradation: without a provider key, auto-route
// simply reverts to Phase 1 behaviour).

/** Shape of the classifier's JSON response. `skill === null` means
 *  "no skill is a good fit" — treat it as a negative verdict. */
export interface LLMClassifyResult {
  skill: string | null;
  confidence: number;
  reason?: string;
}

export interface DetectLLMOptions extends DetectOptions {
  /** Keyword top-score at/above which we skip the LLM call entirely.
   *  Default 2 — two trigger keywords hitting is strong enough that
   *  an LLM second opinion is not worth the round trip. */
  keywordScoreThreshold?: number;
  /** Minimum classifier confidence for the LLM pick to take effect.
   *  Below this, we fall back to the keyword result. Default 0.5. */
  llmConfidenceThreshold?: number;
  /** Injected classifier. Receives the pre-built prompt and returns
   *  parsed JSON. Leave undefined to skip LLM fallback entirely. */
  classify?: (prompt: string, signal?: AbortSignal) => Promise<LLMClassifyResult>;
  signal?: AbortSignal;
  /** Active model tier. When it meets `fullMenuTier`, the classifier is
   *  allowed to route over the WHOLE menu even when keyword matching was
   *  weak/empty (see detectLLM). Undefined = no full-menu path (legacy
   *  tiebreaker-only behaviour). */
  activeTier?: SkillTier;
  /** Minimum tier that unlocks full-menu LLM routing. Default 'T1' —
   *  only frontier models (codex/opus/gemini-pro/grok-4) pick from the
   *  full closed list; weaker models stay tiebreaker-only to avoid
   *  closed-list hallucination (the original session-21 concern). */
  fullMenuTier?: SkillTier;
  /** Confidence floor for a FULL-MENU pick (higher than the tiebreaker
   *  `llmConfidenceThreshold`). Full-menu is speculative — the model
   *  scores the whole menu on a possibly-unrelated prompt — so it must
   *  clear a stricter bar to avoid false triggers on casual mentions
   *  ("유튜브에서 웃긴 영상"·"뉴스 보면 우울"). Default 0.85 (empirically
   *  separates true picks ≥0.86 from trap false-positives ≤0.78). */
  fullMenuConfidenceThreshold?: number;
}

/** Build the classifier prompt. Exported so tests can pin the format
 *  and so the dashboard can log it when debugging. */
export function buildClassifierPrompt(userText: string, index: SkillIndexEntry[]): string {
  // Prompt engineering borrowed from gemini-cli's classifierStrategy
  // (rubric + reasoning-first CoT + when-NOT guidance + few-shot). A
  // single provider-agnostic prompt — improvements propagate to every
  // active model (codex/gemini/grok/claude/local). Targets the observed
  // failure where eager models route general Q&A to a catch-all
  // "ask an LLM"/chat skill (precision), while keeping recall for real
  // specialized intents.
  const lines: string[] = [];
  lines.push('You are a skill router for a coding/agent assistant. Decide whether the user message needs a SPECIALIZED skill, or whether the assistant should just answer directly.');
  lines.push('');
  lines.push('Respond with strict JSON only — no prose, no code fence — reasoning FIRST:');
  lines.push('{"reasoning": "<one short sentence>", "skill": "<exact name or null>", "confidence": <0..1>}');
  lines.push('');
  lines.push('Rules:');
  lines.push('- Pick a skill ONLY when the message needs that skill\'s specialized capability (live web/news search, diagram rendering, YouTube transcript, market/flow data, deep research, etc.).');
  lines.push('- Return null when the assistant can answer directly: general conversation, greetings, or a knowledge/coding question ("what is X", "explain Y", "write a function"). Do NOT route general Q&A to a general-purpose "ask an LLM"/chat skill.');
  lines.push('- A casual MENTION of a keyword (a diagram you liked, a youtube video you saw, the news being depressing) is NOT a request to run that skill → null.');
  lines.push('- Use skill names EXACTLY as listed. If unsure, prefer null.');
  lines.push('');
  lines.push('Examples:');
  lines.push('- "재귀함수가 뭔지 알려줘" → {"reasoning":"general knowledge question, answer directly","skill":null,"confidence":0}');
  lines.push('- "어제 유튜브에서 웃긴 영상 봤는데" → {"reasoning":"casual mention, not a request","skill":null,"confidence":0}');
  lines.push('- "최신 HBM4 뉴스 검색해줘" → {"reasoning":"needs live web/news search","skill":"omni-crawl","confidence":0.95}');
  lines.push('- "이 채널 전체 영상 리스트업" → {"reasoning":"channel-wide video listing","skill":"yt-vault","confidence":0.9}');
  lines.push('');
  lines.push('Skills:');
  for (const s of index) {
    const desc = s.description.replace(/\s+/g, ' ').slice(0, 160);
    lines.push(`- ${s.name}: ${desc}`);
  }
  lines.push('');
  lines.push('User query:');
  lines.push(userText);
  return lines.join('\n');
}

/** Parse the classifier's raw text output into a typed result. Tolerant
 *  of extra prose around the JSON (some providers wrap in code fences),
 *  but falls back to `{skill:null, confidence:0}` on any parse failure. */
export function parseClassifierJson(raw: string): LLMClassifyResult {
  const trimmed = raw.trim();
  // Try whole-string JSON first
  const tryParse = (s: string): LLMClassifyResult | null => {
    try {
      const o = JSON.parse(s);
      if (!o || typeof o !== 'object') return null;
      const skill = typeof o.skill === 'string' && o.skill.trim() ? o.skill.trim() : null;
      const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence)
        ? Math.max(0, Math.min(1, o.confidence))
        : 0;
      const reason = typeof o.reason === 'string' ? o.reason : undefined;
      return { skill, confidence, reason };
    } catch { return null; }
  };
  const whole = tryParse(trimmed);
  if (whole) return whole;
  // Fallback: extract the outermost { ... } block
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const block = tryParse(trimmed.slice(start, end + 1));
    if (block) return block;
  }
  return { skill: null, confidence: 0 };
}

/** Detect with LLM fallback. Runs the keyword router first, and only
 *  calls the classifier when the keyword result genuinely needs
 *  disambiguation: two or more real keyword candidates with top score
 *  ≥ 1.0. The LLM is a tiebreaker, NOT a blind classifier over the
 *  entire skill menu — giving a weak model (local Gemma 4 26B) a
 *  20+ item closed-list selection on a trivial prompt is exactly
 *  where hallucination happens. Session 21 tightening. */
export async function detectLLM(
  userText: string,
  index: SkillIndexEntry[],
  opts: DetectLLMOptions = {},
): Promise<DetectResult> {
  const kw = detectSkillTrigger(userText, index, opts);
  const kwScore = kw.top?.score ?? 0;
  const kwThreshold = opts.keywordScoreThreshold ?? 2;
  // Unambiguous + strong → skip LLM entirely, it has no value to add.
  if (kw.unambiguous && kwScore >= kwThreshold) return kw;
  if (!opts.classify) return kw;
  if (index.length === 0) return kw;

  // Tiebreaker gate: the LLM gets consulted when there's genuine
  // ambiguity among plausible candidates. Two conditions must hold:
  //   1. At least 2 candidates survived keyword scoring (something to
  //      choose between).
  //   2. Top keyword score is ≥ 1.0 (an explicit trigger hit, not just
  //      a flimsy extracted-only match).
  const hasRealAmbiguity = kw.candidates.length >= 2 && kwScore >= 1.0;

  // Full-menu gate (2026-07-20): a STRONG active model (tier ≥ fullMenuTier,
  // default T1 = codex/opus/gemini-pro/grok-4) can reliably pick from the
  // whole menu even when keyword matching was weak or empty — exactly where
  // Korean-heavy prompts land (0/38 skills declare explicit triggers, so
  // extracted-only matching under-fires on Korean). The original session-21
  // concern ("giving a weak model a 20+ item closed-list = hallucination")
  // is respected: weak models (T2/T3/local) get NO full-menu path and stay
  // tiebreaker-only. The classifier's `null` verdict + confidence threshold
  // guard precision on negatives.
  const strongEnough = opts.activeTier
    ? tierMeetsMin(opts.activeTier, opts.fullMenuTier ?? 'T1')
    : false;
  const fullMenu = strongEnough && !hasRealAmbiguity;

  // If keyword found nothing / only one candidate AND the model isn't strong
  // enough for full-menu routing, return kw as-is — no LLM call. Keeps weak
  // models out of the hot path for plain chat ("안녕", "?", …).
  if (!hasRealAmbiguity && !fullMenu) return kw;

  const prompt = buildClassifierPrompt(userText, index);
  let verdict: LLMClassifyResult;
  try {
    verdict = await opts.classify(prompt, opts.signal);
  } catch {
    return kw;   // any classifier error → keep keyword result
  }

  // Full-menu picks face a stricter confidence floor than tiebreaker picks
  // (speculative whole-menu scoring → higher false-positive risk on casual
  // mentions). Tiebreaker keeps the lenient threshold (already narrowed to
  // ≥2 plausible candidates).
  const confThreshold = fullMenu
    ? (opts.fullMenuConfidenceThreshold ?? 0.85)
    : (opts.llmConfidenceThreshold ?? 0.5);
  if (!verdict.skill || verdict.confidence < confThreshold) return kw;

  const entry = index.find(e => e.name === verdict.skill);
  if (!entry) return kw;   // LLM hallucinated a name — ignore

  // Synthesize a candidate. Scoring policy (session 21 rewrite):
  //   - If the LLM picked a skill that already scored in the keyword
  //     pass, carry that keyword score (LLM's confidence is just a
  //     tiebreaker between plausibles — it doesn't deserve extra
  //     authority).
  //   - Otherwise, cap synth score at `confidence * 2` — an LLM-only
  //     pick surfaces as a hint (Tab-confirm) but cannot silently
  //     auto-route against the default `autoRouteMinScore: 2.0`.
  const kwSameSkill = kw.candidates.find(c => c.name === entry.name);
  const synthScore = kwSameSkill
    ? Math.max(kwSameSkill.score, verdict.confidence)
    : verdict.confidence * 2;
  const synth: SkillCandidate = {
    name: entry.name,
    score: synthScore,
    matchedTriggers: kwSameSkill?.matchedTriggers ?? [],
    matchedExtractedTriggers: kwSameSkill?.matchedExtractedTriggers ?? [],
    autoTrigger: entry.autoTrigger,
    description: entry.description,
  };
  const others = kw.candidates.filter(c => c.name !== entry.name);
  return { candidates: [synth, ...others], top: synth, unambiguous: true };
}

// ── util ──

function uniqueWords(text: string, minLen: number): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  // Split on unicode whitespace + common punctuation. Not perfect for
  // CJK (which doesn't space-separate) but we're matching as substrings
  // anyway — so short CJK tokens land via the haystack.includes() path.
  const parts = lower.split(/[\s,.;:!?()[\]{}"'`/\\|*+=<>@#$%^&~]+/);
  for (const p of parts) {
    if (p.length >= minLen) out.add(p);
  }
  return [...out];
}
