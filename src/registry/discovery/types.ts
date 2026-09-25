// RFC #2161 Phase 6 — Discovery sources (Layer D).
//
// Each source fetches a provider's "live" model list and returns a
// structured `DiscoveredModel[]` snapshot. The runner merges results
// from all sources, deduplicates, and feeds Layer A's catalog +
// Layer B's live-store. Sources are intentionally narrow: one
// per-provider module, one HTTP call, one parser. Fan-out + retry +
// cache live in `runner.ts`.
//
// MVP shipped with Phase 6:
//   - anthropic + openai sources (real HTTP)
//   - local fs cache fallback
//   - runner with parallel fetch + per-source failure isolation
// Deferred to Phase 6 follow-ups:
//   - gemini / grok / lmstudio / ollama sources
//   - S3 push (catalog-cache / discovery-history)
//   - omni-crawl bridge (LLM-driven enrichment for sources without
//     a /v1/models endpoint)
//   - cron schedule wire (NEXUS subsystem boot hook)

import type { ModelSpec, ModelDiscoveryMeta } from '../types.js';

export type DiscoverySourceId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'grok'
  | 'lmstudio'
  | 'ollama'
  | 'grok-crawl'
  | 'firecrawl-crawl'
  // 대표 2026-09-23 — 공개 `/api/v1/models` · 가격·컨텍스트·능력까지 «잰 값»으로 준다.
  | 'openrouter';

export interface DiscoveredModel {
  /** Canonical model id as returned by the upstream API. */
  id: string;
  /** Canonical provider id (matches `ProviderRegistration.id`). */
  provider: string;
  /** Whatever fields the source could fill — normalised to ModelSpec. */
  partial: Partial<ModelSpec>;
  /** Provenance for the merged catalog write-back. */
  discoveryMeta: ModelDiscoveryMeta;
}

export interface DiscoverySourceResult {
  source: DiscoverySourceId;
  /** True when the fetch succeeded and produced a usable list. */
  ok: boolean;
  /** Discovered model entries (empty on failure). */
  models: DiscoveredModel[];
  /** Wall-clock duration in ms (informational). */
  durationMs: number;
  /** Error message when ok=false. */
  error?: string;
}

export interface DiscoverySource {
  id: DiscoverySourceId;
  /** Run the source. The runner passes a shared AbortSignal so a slow
   *  source can be cancelled when the next scheduled tick arrives. */
  run(opts?: DiscoverySourceOpts): Promise<DiscoverySourceResult>;
}

export interface DiscoverySourceOpts {
  signal?: AbortSignal;
  /** Per-source HTTP timeout — applied on top of any signal. */
  timeoutMs?: number;
  /** Test seam — override fetch (Bun has globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /** Test seam — override Date.now(). */
  now?: () => number;
}
