// RFC #2161 Phase 6 FU A6-real · 2026-05-11 — Grok live-search crawler.
//
// Discovery source for providers that don't expose a /v1/models REST
// surface — uses xAI Grok's "live search" feature (citations + AI
// answer) to crawl provider documentation, blog posts, and pricing
// pages, then asks Grok to extract a structured catalog JSON.
//
// Why "grok-crawl" instead of reusing the existing "omni-crawl"
// bridge:
//   • Bridge requires the user to host their own crawler — that
//     defeats the "zero-config dogfood" pretext for adding the source
//     in the first place. A retired bridge ships in P4.
//   • Grok is already a hard dependency for monad-agent's primary LLM
//     surface (XAI_API_KEY in src/config.ts) — leveraging the SAME
//     live-search wire as src/web-search/grok.ts avoids new deps.
//   • LLM-maintained extraction means new model releases reflect into
//     the catalog ~minutes after the provider's blog post lands —
//     the bridge would have required users to update their own
//     scraping logic by hand.
//
// Fixed provider list (Wider · 7 providers · per user decision
// 2026-05-11). These are the providers without first-party REST
// model-list endpoints that monad-agent's user base is most likely
// to encounter:
//
//   • mistral      — mistral.ai (blog releases + /pricing)
//   • cohere       — cohere.com (Command R family)
//   • deepseek     — deepseek.com (V3 / R1 lineage)
//   • huggingface  — huggingface.co (hosted-inference catalog)
//   • together     — together.ai (open-source compute provider)
//   • groq         — groq.com (Groq Inc · separate from xAI Grok)
//   • perplexity   — perplexity.ai (Sonar API)
//
// Confidence: 'medium' — Grok hallucinations and stale-doc citations
// are real risks; the catalog merger uses this confidence to weight
// per-source agreement when a model appears in multiple discovery
// sources.
//
// External API spec verification (memory
// `feedback_omni_crawl_spec_verification.md`):
//   • Live-search wire is identical to src/web-search/grok.ts
//     (production-proven · https://docs.x.ai/docs/guides/live-search).
//   • Structured JSON output from Grok via system prompt is a
//     standard chat-completion capability; we don't rely on any
//     Grok-specific structured-output flag.
//
// NOTE (2026-07-05): migrated off the deprecated live-search feature
// (chat/completions + search_parameters → HTTP 410) to the Agent Tools
// API via the shared grokAgentSearch helper. Model = GROK_SEARCH_MODEL
// (가성비 fast), overridable via opts.model.
//
// Cross-ref:
//   src/registry/discovery/sources/omni-crawl.ts (bridge predecessor · retires in P4)
//   src/grok/agent-search.ts (shared Agent Tools search helper)
//   src/config.ts (XAI_API_KEY)

import { getGrokApiKey } from '../../../config.js';
import { grokAgentSearch, GROK_SEARCH_MODEL } from '../../../grok/agent-search.js';
import type {
  DiscoveredModel,
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

// Crawl is slow (Grok live search + JSON parse) — give it 60s headroom.
const DEFAULT_TIMEOUT_MS = 60_000;

/** The 7-provider crawl target list. Hard-coded for P2 — P5 wizard +
 *  future env override can expand it. */
export const GROK_CRAWL_PROVIDERS: readonly string[] = [
  'mistral',
  'cohere',
  'deepseek',
  'huggingface',
  'together',
  'groq',
  'perplexity',
];

interface GrokCrawlModelWire {
  id?: unknown;
  provider?: unknown;
  displayName?: unknown;
  releaseDate?: unknown;
  description?: unknown;
  contextSize?: unknown;
  outputMaxTokens?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Pull a JSON object out of a string that may be wrapped in code
 *  fences or surrounded by prose. Returns null if no valid JSON. */
export function extractCrawlJson(text: string): { models?: GrokCrawlModelWire[] } | null {
  if (!text || typeof text !== 'string') return null;
  // First attempt: direct parse (Grok obeyed "JSON only" rule).
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as { models?: GrokCrawlModelWire[] };
    }
  } catch { /* fall through */ }
  // Second attempt: strip ```json fences and try again.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]!);
      if (parsed && typeof parsed === 'object') {
        return parsed as { models?: GrokCrawlModelWire[] };
      }
    } catch { /* fall through */ }
  }
  // Third attempt: find first { ... } substring spanning balanced braces.
  const braceStart = text.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(braceStart, i + 1));
            if (parsed && typeof parsed === 'object') {
              return parsed as { models?: GrokCrawlModelWire[] };
            }
          } catch { /* malformed · give up */ }
          break;
        }
      }
    }
  }
  return null;
}

const SYSTEM_PROMPT =
`You are a model catalog research assistant. Use web search to find current production model offerings.

Return ONLY a JSON object (no markdown fences, no prose) with this shape:

{
  "models": [
    {
      "id": "<canonical-api-id>",
      "provider": "<provider-id>",
      "displayName": "<human label>",
      "releaseDate": "<YYYY-MM-DD or omit>",
      "description": "<one short sentence or omit>",
      "contextSize": <integer or omit>,
      "outputMaxTokens": <integer or omit>
    }
  ]
}

Rules:
- Only include CURRENTLY AVAILABLE models (skip deprecated / preview / coming-soon).
- "id" must match the provider's canonical API model id (the string that goes in API requests).
- "provider" must be one of the providers in the user's query.
- Output the JSON object only. No prose, no markdown fences, no explanations.`;

function userPromptForProviders(providers: readonly string[]): string {
  return `List the current production LLM models offered by these providers: ${providers.join(', ')}.

For each provider, include every currently available model with the metadata schema described in the system prompt. Skip any model marked deprecated, preview, beta, or coming-soon. Return only the JSON object.`;
}

export interface GrokCrawlOpts extends DiscoverySourceOpts {
  /** Override the provider list (P5 wizard / future env). When unset
   *  the source uses GROK_CRAWL_PROVIDERS. */
  providers?: readonly string[];
  /** Override the crawl model. Default = GROK_SEARCH_MODEL (가성비). */
  model?: string;
}

// `satisfies` instead of `: DiscoverySource` preserves the wider
// `GrokCrawlOpts` parameter type for direct callers (tests + future
// ops endpoints) while still asserting the interface contract for the
// runner's `BUILTIN_SOURCES` array.
export const grokCrawlSource = {
  id: 'grok-crawl' as const,
  async run(opts: GrokCrawlOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = getGrokApiKey();
    if (!apiKey) {
      return {
        source: 'grok-crawl',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: 'missing-api-key: XAI_API_KEY env unset',
      };
    }
    const providers = (opts.providers && opts.providers.length > 0)
      ? opts.providers
      : GROK_CRAWL_PROVIDERS;
    const model = opts.model ?? GROK_SEARCH_MODEL;

    try {
      const r = await grokAgentSearch(userPromptForProviders(providers), {
        model,
        tools: ['web_search'],
        systemPrompt: SYSTEM_PROMPT,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: opts.signal,
        fetchImpl,
        apiKey,
      });
      if (!r.ok) {
        const code = r.status;
        const detail = code === 401 || code === 403
          ? `upstream-auth-${code}`
          : code > 0
            ? `upstream-http-${code}`
            // status 0 = the helper caught a network/abort throw.
            : `upstream-network: ${r.error ?? 'unknown'}`;
        return {
          source: 'grok-crawl',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: detail,
        };
      }
      const content = r.text;
      if (typeof content !== 'string' || content.length === 0) {
        return {
          source: 'grok-crawl',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: 'empty-content: Grok returned no assistant message',
        };
      }
      const parsed = extractCrawlJson(content);
      const wireModels = Array.isArray(parsed?.models) ? parsed!.models! : [];
      const lastSeen = new Date(now()).toISOString();
      const models: DiscoveredModel[] = [];
      for (const m of wireModels) {
        if (!isString(m.id) || !isString(m.provider)) continue;
        // Reject any provider not in our crawl target list — defensive
        // against Grok mixing in providers it wasn't asked about.
        if (!providers.includes(m.provider)) continue;
        models.push({
          id: m.id,
          provider: m.provider,
          partial: {
            id: m.id,
            provider: m.provider,
            displayName: isString(m.displayName) ? m.displayName : m.id,
            ...(isString(m.releaseDate) ? { releaseDate: m.releaseDate } : {}),
            ...(isString(m.description) ? { description: m.description } : {}),
            ...(isNumber(m.contextSize) ? { contextSize: m.contextSize } : {}),
            ...(isNumber(m.outputMaxTokens) ? { outputMaxTokens: m.outputMaxTokens } : {}),
          },
          discoveryMeta: {
            source: 'auto-grok-crawl' as const,
            lastSeen,
            autoFilled: true,
            // Lower confidence than first-party REST APIs — Grok may
            // surface a stale doc or extrapolate from a roadmap.
            confidence: 'medium' as const,
          },
        });
      }
      // Empty extraction is *not* an error — Grok may legitimately
      // return `{models: []}` when the query date is too recent / no
      // new models. Surface as ok:true with modelCount 0 so the
      // catalog merger keeps the existing entries.
      return {
        source: 'grok-crawl',
        ok: true,
        models,
        durationMs: now() - startedAt,
      };
    } catch (e) {
      // grokAgentSearch handles its own timeout/abort and returns
      // {ok:false} rather than throwing, so reaching here means an
      // unexpected error. Kept as a safety net.
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'grok-crawl',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: aborted
          ? 'upstream-timeout'
          : `upstream-network: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
} satisfies DiscoverySource;
