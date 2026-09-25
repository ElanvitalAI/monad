/**
 * FU8 PR #3 — FU-I7b.2 KGS keyword-crawl adapter (2026-05-12).
 *
 * Wires the I2 enrichment loop's `crawlKeyword` seam to the KGS P2
 * SQLite + FTS5 substrate that landed in W3 (cascade-zyu Y1). When
 * a task carries a `keywords:` list, the I2 phase resolves each
 * keyword through this adapter:
 *
 *   1. KGS first — `kgs.search({ text: keyword, limit: ... })` runs
 *      a BM25 query against `kgs_card_fts`. A "decent" hit (rank ≤
 *      `rankThreshold`, BM25 lower = better) returns the indexed
 *      card's title + body as the enrichment summary so the
 *      pipeline avoids a redundant external crawl on a topic the
 *      Patcher / user has already indexed.
 *   2. Fallback — when KGS misses (no hits, or rank above the
 *      threshold), the adapter routes to `opts.fallback` if
 *      provided. Default fallback is the same transparent
 *      "not wired yet" summary the prior null adapter shipped,
 *      so dogfood behaviour stays observable.
 *
 * The HANDOFF §4.3 originally prescribed a 1st-stage wire to
 * `firecrawl-crawl` and a 2nd stage via KGS. Spec drift at land
 * time: the firecrawl-crawl source on this branch is a model-
 * discovery agent, not a free-form `search` variant — there is no
 * shared `search(keyword)` to call. Per `feedback_omni_crawl_spec_
 * verification.md` the external wire is parked behind the fallback
 * until the dogfood signal (`enrichmentDiag ≥ 30 %`) clears + an
 * external adapter is chosen explicitly.
 *
 * Reference 3-sink emit pattern (FU8 PR #1):
 *   - MSS Signal Bus  — `intake.keyword_crawl.<cache_hit|cache_miss>`
 *     envelopes (tier `info`, payload carries keyword + rank).
 *   - U0 user-intent  — `system.intake.keyword_crawl_<hit|miss>`
 *     events (surface `tui`, target `{ kind: 'chip', id: keyword }`).
 *
 * Both sinks are best-effort try/catch so an enrich loop never
 * fails because telemetry is down.
 *
 * Cross-ref:
 *   src/intake-plane/enrich.ts   (KeywordCrawlCallable contract)
 *   src/intake-plane/enrich-plugins.ts (builder consumes this adapter)
 *   src/knowledge/kgs/sqlite-store.ts  (KgsSqliteStore.search shape)
 */
import { signalBus } from '../signal-bus/index.js';
import { userIntentLogger } from '../user-intent/index.js';
import type { KeywordCrawlCallable } from './enrich.js';

/** Minimal subset of `KgsSqliteStore.search` we depend on. Decouples
 *  the adapter from the concrete SQLite class so tests can inject a
 *  capture array + production wiring can inject the singleton. */
export interface KgsKeywordLookup {
  search(query: { text: string; limit?: number }): ReadonlyArray<{
    card: { title: string; body: string };
    rank: number | null;
  }>;
}

export interface KgsKeywordCrawlOptions {
  /** KGS store to consult before the fallback. */
  kgsStore: KgsKeywordLookup;
  /** BM25 rank threshold — hits with `rank <= threshold` are kept.
   *  Lower is better in BM25; the default (-2) keeps decent matches
   *  (title or body shares one or more rare tokens with the keyword)
   *  and lets noisy fragmentary hits fall through to the fallback. */
  rankThreshold?: number;
  /** Maximum cards to inspect per query. Default 3 — we only need
   *  the best hit, but ask for a couple in case the top result has
   *  a null rank (FTS5 returns `null` for filter-only queries). */
  limit?: number;
  /** Hard cap on the summary body length so the LLM prompt that
   *  consumes it stays bounded. Mirrors `enrich-plugins.ts`
   *  `DEFAULT_SUMMARY_BYTES` (800). */
  summaryBytes?: number;
  /** Fallback when KGS misses. Default = transparent "not wired"
   *  message so the gap stays visible to the user. */
  fallback?: KeywordCrawlCallable;
  /** Test seam — override signal-bus singleton. */
  bus?: ReturnType<typeof signalBus>;
  /** Test seam — override intent-logger singleton. */
  intent?: ReturnType<typeof userIntentLogger>;
}

const DEFAULT_RANK_THRESHOLD = -2;
const DEFAULT_LIMIT = 3;
const DEFAULT_SUMMARY_BYTES = 800;

/** Default fallback — surfaces the gap so the user knows the KGS
 *  index has no entry for this keyword AND no external crawl is
 *  wired. Identical in spirit to `enrich-plugins.ts`
 *  `nullCrawlKeyword`, kept inline so this module is the single
 *  source of truth for the keyword-crawl summary text. */
const defaultFallback: KeywordCrawlCallable = async (args) => ({
  summary: `keyword crawl unwired · '${args.keyword}' not in KGS · external crawl deferred (FU-I7b.2 stage 2 · waiting on dogfood signal enrichmentDiag ≥ 30%).`,
});

/** Build a `KeywordCrawlCallable` that consults KGS first and falls
 *  back to an external crawl (or the transparent default) on miss. */
export function buildKgsKeywordCrawlCallable(
  opts: KgsKeywordCrawlOptions,
): KeywordCrawlCallable {
  const threshold = opts.rankThreshold ?? DEFAULT_RANK_THRESHOLD;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const summaryBytes = opts.summaryBytes ?? DEFAULT_SUMMARY_BYTES;
  const fallback = opts.fallback ?? defaultFallback;
  const bus = opts.bus ?? signalBus();
  const intent = opts.intent ?? userIntentLogger();

  return async (args) => {
    const keyword = args.keyword.trim();
    if (!keyword) {
      return { summary: 'keyword crawl: empty keyword' };
    }
    // KGS lookup — wrap in try/catch so a corrupt SQLite path can
    // never strand an entire intake submission. The fallback path
    // still runs even when the store throws.
    let hit: { card: { title: string; body: string }; rank: number | null } | null = null;
    try {
      const hits = opts.kgsStore.search({ text: keyword, limit });
      // BM25 lower is better; null rank means filter-only / no FTS
      // match — treat as no hit. The store already orders by rank
      // ascending when text is present so `hits[0]` is the best.
      for (const h of hits) {
        if (h.rank !== null && h.rank <= threshold) {
          hit = h;
          break;
        }
      }
    } catch {
      // KGS read failure → fall through to fallback. The 3-sink
      // emit still fires below so the failure is observable.
    }

    if (hit) {
      // Cache hit. Trim body to summaryBytes; prepend title so the
      // downstream LLM prompt has a single-line context lead.
      const head = hit.card.body.slice(0, summaryBytes);
      const summary = hit.card.title
        ? `${hit.card.title}\n\n${head}`
        : head || `KGS hit for '${keyword}' (empty body)`;
      emitCacheHit(bus, intent, keyword, hit.rank);
      return { summary, raw: hit.card.body };
    }

    // Cache miss — route to fallback, then emit the miss. We emit
    // after the fallback runs so the order is "decision → outcome"
    // in the signal bus stream (consumers can correlate one miss
    // emit with one fallback completion).
    const out = await fallback({ keyword, ...(args.signal ? { signal: args.signal } : {}) });
    emitCacheMiss(bus, intent, keyword);
    return out;
  };
}

// ──────────────────── Reference 3-sink emit ─────────────────────────

function emitCacheHit(
  bus: ReturnType<typeof signalBus>,
  intent: ReturnType<typeof userIntentLogger>,
  keyword: string,
  rank: number | null,
): void {
  try {
    bus.emit({
      source: 'intake.keyword_crawl.cache_hit',
      tier: 'info',
      message: `KGS hit · '${keyword}'${rank !== null ? ` · bm25=${rank.toFixed(2)}` : ''}`,
      payload: { keyword, rank },
    });
  } catch { /* best-effort */ }
  try {
    intent.emit({
      surface: 'tui',
      intent: {
        layer: 'system',
        kind: 'system.intake.keyword_crawl_hit',
        target: { kind: 'chip', id: keyword },
        value: { rank },
      },
    });
  } catch { /* best-effort */ }
}

function emitCacheMiss(
  bus: ReturnType<typeof signalBus>,
  intent: ReturnType<typeof userIntentLogger>,
  keyword: string,
): void {
  try {
    bus.emit({
      source: 'intake.keyword_crawl.cache_miss',
      tier: 'info',
      message: `KGS miss · '${keyword}' · falling through to external crawl adapter`,
      payload: { keyword },
    });
  } catch { /* best-effort */ }
  try {
    intent.emit({
      surface: 'tui',
      intent: {
        layer: 'system',
        kind: 'system.intake.keyword_crawl_miss',
        target: { kind: 'chip', id: keyword },
      },
    });
  } catch { /* best-effort */ }
}
