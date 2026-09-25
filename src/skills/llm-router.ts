// monad · LLM-based router (BACKLOG #7 / Archon-port followups)
//
// Direct port of Archon's `buildRouterPrompt` pattern
// (`~/source/ref/Archon/packages/workflows/src/router.ts:73`).
//
// Why exist alongside `detectSkillTrigger` (regex)?
//   - regex matches exact trigger phrases — fails when the user
//     paraphrases ("shorten this", "give me the gist") instead of
//     using the literal trigger token.
//   - LLM router reads the full "Use when / Triggers / Does / NOT
//     for" description and decides intent in natural language.
//   - Highest accuracy when descriptions follow the 4-line
//     convention (`내부 문서 `CONVENTION-workflow-description-2026-05-08``).
//
// This module is a pure builder + parser — NOT wired into a
// production path yet. The wiring decision (when to use regex vs
// LLM, fallback chain, cost ceiling) is a follow-up; a typical
// integration would call regex first, then escalate to LLM only
// when regex returned no candidate above threshold.

/** Generic routable item — works for skills, workflows, or any
 *  future "named thing with a description" the user picks from. */
export interface RouteCandidate {
  /** Stable identifier the LLM emits in `/invoke-… <name>`. */
  name: string;
  /** Multi-line description following the 4-line convention. */
  description: string;
  /** Pre-computed trigger phrases for the regex fast-path. When set,
   *  the cascade uses these directly and skips description parsing.
   *  Required when the candidate's description doesn't follow the
   *  4-line convention with a `Triggers:` line — e.g., skills carry
   *  triggers in YAML frontmatter (`SkillIndexEntry.triggers`)
   *  separate from the prose description. */
  triggers?: readonly string[];
}

/** Optional context the router can use beyond the user's message
 *  itself. Mirrors Archon's `RouterContext`. */
export interface RouteContext {
  /** Where the message came from — chat / pwa / cli / channel-bot. */
  platformType?: string;
  /** Title field when the message has structural metadata (PR title,
   *  issue title, etc.). */
  title?: string;
  /** Tags / labels associated with the message. */
  labels?: string[];
  /** Previous turns in the conversation, summarized. */
  threadHistory?: string;
  /** Free-form hint — e.g., 'pr-review' / 'issue' / 'workflow'. */
  category?: string;
}

export interface RouterPromptOpts {
  /** Slash-command emitted to invoke the chosen candidate. Default
   *  `/invoke` — callers typically pass `/invoke-workflow` or
   *  `/invoke-skill` to namespace per registry. */
  invokeCommand?: string;
  /** Fallback name the router should pick when no clear winner
   *  (defaults to none — LLM is told to pick the closest match). */
  fallbackName?: string;
}

/** Build a router prompt that instructs an LLM to pick the best
 *  candidate for `userMessage` and emit a single line:
 *  `<invokeCommand> <name>`. The candidate list must be small enough
 *  to fit in the model's context (Anthropic / OpenAI handle 100s
 *  comfortably, but keep it tight for cost). */
export function buildRouterPrompt(
  userMessage: string,
  candidates: readonly RouteCandidate[],
  context?: RouteContext,
  opts: RouterPromptOpts = {},
): string {
  if (candidates.length === 0) {
    // Empty candidate set — caller should bypass routing entirely.
    // We return the bare user message so the caller can pipe it
    // straight to a chat without any routing rule polluting the
    // prompt.
    return userMessage;
  }

  const invoke = opts.invokeCommand ?? '/invoke';
  const fallbackHint = opts.fallbackName
    ? `\n6. If unsure, fall back to \`${opts.fallbackName}\` (the catch-all)`
    : '';

  const candidateList = candidates
    .map((c) => {
      const desc = c.description.trim().replace(/\n/g, '\n  ');
      return `**${c.name}**\n  ${desc}`;
    })
    .join('\n\n');

  const ctxSection = buildContextSection(context);
  const ctxBlock = ctxSection
    ? `## Context\n\n${ctxSection}\n\n`
    : '';

  return `# Router

You are a router. Pick the best candidate for the user's request.

${ctxBlock}## Available candidates

${candidateList}

## User request

"${userMessage}"

## Rules

1. The USER REQUEST is the PRIMARY signal — it determines the choice.
2. Read each description, especially "Use when:" (positive signal) and "NOT for:" (negative signal).
3. CRITICAL: \`NOT for:\` is authoritative — never pick a candidate whose \`NOT for:\` contradicts the user's intent.
4. Match against \`Triggers:\` keywords as a hint, but the natural-language intent in \`Use when:\` overrides exact-phrase matching.
5. You MUST pick exactly one candidate — do not respond with text.${fallbackHint}

## Response format

Your ENTIRE response must be ONLY this single line — no analysis, no explanation:

${invoke} <candidate-name>

Do NOT use any tools — this is a routing decision only.`;
}

/** Build the optional context section. Returns empty string when
 *  no context fields are populated. */
function buildContextSection(ctx?: RouteContext): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.platformType) parts.push(`Platform: ${ctx.platformType}`);
  if (ctx.category) parts.push(`Category: ${ctx.category}`);
  if (ctx.title) parts.push(`Title: ${ctx.title}`);
  if (ctx.labels && ctx.labels.length > 0) {
    parts.push(`Labels: ${ctx.labels.join(', ')}`);
  }
  if (ctx.threadHistory) {
    parts.push(`\nThread history:\n${ctx.threadHistory}`);
  }
  return parts.length > 0 ? parts.join('\n') : '';
}

// ── Response parsing ────────────────────────────────────────────────

export interface RouteInvocation {
  /** Resolved candidate name when the LLM response matched a known
   *  candidate (case-insensitive). null when no match — caller
   *  decides whether to fall back to regex / catch-all / error. */
  name: string | null;
  /** Anything after the slash-command line — typically empty when
   *  the LLM follows the format strictly. */
  remainingMessage: string;
  /** Set when `/invoke …` was found but the name wasn't in the
   *  candidate list (typo / hallucination). */
  error?: string;
}

/** Parse an LLM response for a `<invokeCommand> <name>` line.
 *  Multiline regex — matches even when the LLM prepends analysis
 *  text despite the instructions. Returns null when the response
 *  contains no recognizable invoke command. */
export function parseRouterResponse(
  response: string,
  candidates: readonly RouteCandidate[],
  opts: RouterPromptOpts = {},
): RouteInvocation {
  const invoke = opts.invokeCommand ?? '/invoke';
  // Escape regex metachars in the invoke command (e.g., the `/`
  // and any future variants like `/invoke-workflow`).
  const invokeEsc = invoke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${invokeEsc}\\s+(\\S+)`, 'im');

  const trimmed = response.trim();
  const match = re.exec(trimmed);

  if (!match) {
    return { name: null, remainingMessage: response };
  }

  const requested = match[1]!;
  const remaining = trimmed.slice(match.index + match[0].length).trim();

  // Exact name match
  const exact = candidates.find((c) => c.name === requested);
  if (exact) {
    return { name: exact.name, remainingMessage: remaining };
  }

  // Case-insensitive match — common LLM quirk
  const ci = candidates.find((c) => c.name.toLowerCase() === requested.toLowerCase());
  if (ci) {
    return { name: ci.name, remainingMessage: remaining };
  }

  // Unknown name — caller can show the user the available list
  return {
    name: null,
    remainingMessage: response,
    error: `Unknown candidate: ${requested}. Available: ${candidates.map((c) => c.name).join(', ')}`,
  };
}

// ── Convenience adapters for the two main callers ──────────────────

/** Skill-specific wrapper. Skills already declare `description`
 *  + we pass `/invoke-skill` so the slash-command output is
 *  unambiguous when both routers are active. */
export function buildSkillRouterPrompt(
  userMessage: string,
  skills: readonly { name: string; description: string }[],
  context?: RouteContext,
): string {
  return buildRouterPrompt(userMessage, skills, context, {
    invokeCommand: '/invoke-skill',
  });
}

export function parseSkillRouterResponse(
  response: string,
  skills: readonly { name: string; description: string }[],
): RouteInvocation {
  return parseRouterResponse(response, skills, { invokeCommand: '/invoke-skill' });
}

/** Workflow-specific wrapper. Mirrors the skill pattern with the
 *  matching `/invoke-workflow` slash-command — same that Archon
 *  uses (`buildRouterPrompt` → `/invoke-workflow <name>`). */
export function buildWorkflowRouterPrompt(
  userMessage: string,
  workflows: readonly { name: string; description: string }[],
  context?: RouteContext,
): string {
  return buildRouterPrompt(userMessage, workflows, context, {
    invokeCommand: '/invoke-workflow',
  });
}

export function parseWorkflowRouterResponse(
  response: string,
  workflows: readonly { name: string; description: string }[],
): RouteInvocation {
  return parseRouterResponse(response, workflows, { invokeCommand: '/invoke-workflow' });
}

// ── Fallback cascade (regex first → LLM escalate) ───────────────────
//
// Cost ceiling. The cascade exists because LLM router calls are not
// free — even a haiku-class call is ~50ms + tokens that compound across
// a fleet. When a candidate's `Triggers:` line in its 4-line-conv
// description literally appears in the user message, that's an
// authored-intent signal that doesn't need an LLM to interpret. The
// LLM is reserved for paraphrase / ambiguous / out-of-vocabulary cases
// where the regex pass returns 0 or ≥2 matches.
//
// v1 policy (this PR): regex hit (exactly 1) → return immediately,
// `source: 'regex'`. 0 or ≥2 → escalate to LLM, `source: 'llm'`. No
// LRU cache, no per-session memoization, no model-tier escalation.
// Future PRs can layer those on without changing this contract.

/** Single-source cascade result. `source` lets callers record cost
 *  metrics and surface the chosen path in dev tools / observability. */
export interface CascadeResult {
  /** Resolved candidate name, or null when neither regex nor LLM
   *  produced a confident pick. */
  name: string | null;
  /** Which path picked it. 'regex' = LLM was NOT called.
   *  'llm' = LLM was called once (regex missed or was ambiguous).
   *  'none' = the candidate set was empty before either pass ran. */
  source: 'regex' | 'llm' | 'none';
  /** When source='llm': the raw LLM response text (for debug/trace).
   *  When source='regex': a short string identifying the matched
   *  trigger (mirrors the LLM response slot for symmetric logging). */
  reasoning?: string;
  /** Surfaced when the LLM picked a name not in the candidate list,
   *  or when the LLM call itself threw. Mirrors the existing
   *  `RouteInvocation.error` shape. */
  error?: string;
}

/** Extract trigger phrases from a 4-line-convention description.
 *  Looks for the `Triggers:` line and pulls quoted phrases out of it.
 *  Returns lowercased phrases — empty array when the description
 *  doesn't follow the convention or has no Triggers line.
 *
 *  Convention (`내부 문서 `CONVENTION-workflow-description-2026-05-08``):
 *
 *    Use when: …
 *    Triggers: "summarize", "요약", "tl;dr".
 *    Does: …
 *    NOT for: …
 *
 *  Both `"…"` and `'…'` are accepted. Phrases without quotes are
 *  ignored on purpose — bare words on the Triggers line tend to be
 *  meta-language ("e.g.", "etc.") not actual trigger tokens. */
export function extractTriggersFromDescription(desc: string): string[] {
  if (!desc) return [];
  // Match the Triggers: line and grab everything until the next
  // capitalized label (Does:/NOT for:) or end-of-string. The
  // multi-line flag lets the line start anywhere; non-greedy capture
  // stops at the first lookahead match.
  const lineMatch = desc.match(/Triggers:\s*([\s\S]*?)(?:\n\s*(?:Does|NOT for|Use when):|$)/);
  if (!lineMatch) return [];
  const line = lineMatch[1] ?? '';
  const phrases: string[] = [];
  const re = /"([^"]+)"|'([^']+)'/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(line)) !== null) {
    const phrase = (mt[1] ?? mt[2] ?? '').trim().toLowerCase();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

/** Find candidates whose trigger phrases substring-match the user
 *  message. Substring match is intentional (case-insensitive, anchored
 *  neither way) — that's what the regex skill router does too, and
 *  it's the cheapest signal that still respects authored intent.
 *
 *  Trigger source per candidate (first match wins):
 *    1. `cand.triggers` when set — caller provided them upstream
 *       (skills do this; the YAML frontmatter has explicit triggers
 *       outside the description prose).
 *    2. `extractTriggers(cand.description)` — default 4-line conv
 *       parser, which workflows use. */
export function regexMatchCandidates(
  userMessage: string,
  candidates: readonly RouteCandidate[],
  extractTriggers: (desc: string) => string[] = extractTriggersFromDescription,
): RouteCandidate[] {
  const haystack = userMessage.toLowerCase();
  if (!haystack.trim()) return [];
  const matched: RouteCandidate[] = [];
  for (const cand of candidates) {
    const triggers = cand.triggers
      ? cand.triggers.map((t) => t.toLowerCase())
      : extractTriggers(cand.description);
    if (triggers.some((t) => t && haystack.includes(t))) matched.push(cand);
  }
  return matched;
}

export interface RouteWithFallbackParams {
  userMessage: string;
  candidates: readonly RouteCandidate[];
  /** Async LLM caller. Called at most once — only when regex misses
   *  or is ambiguous. Same shape `RouterLLMCaller` uses on the
   *  endpoint side, kept generic here so the cascade has no
   *  Nexus dependency. */
  llm: (prompt: string, opts: { model?: string; provider?: string }) => Promise<string>;
  llmCallOpts?: { model?: string; provider?: string };
  context?: RouteContext;
  /** Custom regex extractor — defaults to the 4-line-conv parser. */
  extractTriggers?: (desc: string) => string[];
  /** Force the LLM path even when regex would have hit. Mostly for
   *  test parity with the pre-cascade behavior and for callers that
   *  intentionally want LLM judgement (e.g., the user explicitly
   *  asked for explanation, not a fast trigger match). */
  skipRegex?: boolean;
  /** Slash-command emitted in the LLM prompt + parsed back from the
   *  LLM response. Defaults to `/invoke`. */
  invokeCommand?: string;
  /** Catch-all candidate name surfaced to the LLM when nothing
   *  matches. */
  fallbackName?: string;
}

/** regex → LLM cascade. See top-of-section comment for the cost
 *  rationale. This is the single chokepoint callers should use; both
 *  the workflow router endpoint and (future) skill router endpoint
 *  go through here so cost telemetry is uniform. */
export async function routeWithFallback(
  p: RouteWithFallbackParams,
): Promise<CascadeResult> {
  if (p.candidates.length === 0) return { name: null, source: 'none' };

  if (p.skipRegex !== true) {
    const matched = regexMatchCandidates(
      p.userMessage,
      p.candidates,
      p.extractTriggers,
    );
    if (matched.length === 1) {
      return {
        name: matched[0]!.name,
        source: 'regex',
        reasoning: `regex matched single trigger candidate "${matched[0]!.name}"`,
      };
    }
  }

  const promptOpts: RouterPromptOpts = {};
  if (p.invokeCommand !== undefined) promptOpts.invokeCommand = p.invokeCommand;
  if (p.fallbackName !== undefined) promptOpts.fallbackName = p.fallbackName;

  const prompt = buildRouterPrompt(
    p.userMessage,
    p.candidates,
    p.context,
    promptOpts,
  );

  let response: string;
  try {
    response = await p.llm(prompt, p.llmCallOpts ?? {});
  } catch (err) {
    return {
      name: null,
      source: 'llm',
      error: err instanceof Error ? err.message : 'router LLM call failed',
    };
  }

  const parsed = parseRouterResponse(response, p.candidates, promptOpts);
  return {
    name: parsed.name,
    source: 'llm',
    reasoning: response,
    ...(parsed.error !== undefined ? { error: parsed.error } : {}),
  };
}
