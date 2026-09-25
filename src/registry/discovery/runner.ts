// RFC #2161 Phase 6 — Discovery runner.
//
// Orchestrates per-source fetches in parallel, isolates failures
// (one source down → others still surface), and persists the merged
// snapshot to a local cache file. Phase 6 follow-ups push the same
// snapshot to S3 (`catalog-cache/` + `discovery-history/`) and wire
// a cron schedule via the NEXUS subsystem registry.
//
// The runner deliberately does NOT mutate the static catalog yaml —
// the merged snapshot is a *parallel* surface (cache file). When
// Phase 8 cleanup decides to fold discovery into the catalog
// auto-write path it can read this cache as the source-of-truth for
// new models.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { anthropicSource } from './sources/anthropic.js';
import { firecrawlCrawlSource } from './sources/firecrawl-crawl.js';
import { geminiSource } from './sources/gemini.js';
import { grokSource } from './sources/grok.js';
import { grokCrawlSource } from './sources/grok-crawl.js';
import { lmStudioSource, ollamaSource } from './sources/local-hosts.js';
import { openaiSource } from './sources/openai.js';
import { openrouterSource } from './sources/openrouter.js';
import { defaultDiscoveryCachePath, type DiscoverySnapshot } from './cache.js';
import {
  pushDiscoverySnapshotToS3,
  type PushSnapshotOpts,
  type PushSnapshotResult,
} from './s3-push.js';
import type {
  DiscoveredModel,
  DiscoverySource,
  DiscoverySourceId,
  DiscoverySourceResult,
} from './types.js';

const SNAPSHOT_VERSION = 1;

export const BUILTIN_SOURCES: DiscoverySource[] = [
  // First-party REST /v1/models surfaces.
  anthropicSource,
  openaiSource,
  geminiSource,
  grokSource,
  lmStudioSource,
  ollamaSource,
  // 대표 2026-09-23 — OpenRouter: 키 «없이도» 도는 유일한 소스 · kimi·qwen·glm 의 «파생» 카탈로그 입력.
  openrouterSource,
  // FU A6-real P2 (2026-05-11) — Grok live-search crawler for the
  // 7 providers that lack /v1/models REST endpoints. Stays dormant
  // when XAI_API_KEY is unset (returns ok:false missing-api-key).
  grokCrawlSource,
  // FU A6-real P3 (2026-05-11) — optional Firecrawl CLI crawler.
  // Both the CLI binary and an API key must be present; otherwise
  // returns ok:false (missing-cli / missing-api-key) silently.
  firecrawlCrawlSource,
  // FU A6-real P4 (2026-05-11) — the original `omni-crawl` BRIDGE
  // source (POST <env-URL>) is retired. The same 7-provider crawl
  // surface is now covered internally by grok-crawl (mandatory) +
  // firecrawl-crawl (optional), so users no longer need to host
  // their own scraper endpoint. Env vars MONAD_OMNI_CRAWL_URL /
  // MONAD_OMNI_CRAWL_TOKEN are no longer consulted.
];

export type { DiscoverySnapshot } from './cache.js';
export { readDiscoveryCache } from './cache.js';

export interface RunDiscoveryOpts {
  sources?: DiscoverySource[];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Custom cache path (test seam). */
  cachePath?: string;
  /** Skip cache write (useful when caller controls persistence). */
  skipCacheWrite?: boolean;
  /** Test seam — override Date.now(). */
  now?: () => number;
  /** RFC #2161 FU A7 — mirror snapshot to S3 (catalog-cache + history).
   *  Production callers leave this undefined and let
   *  `pushDiscoverySnapshotToS3` default to `isS3Available()` gating;
   *  tests inject a stub transport so they don't need `aws` on PATH.
   *  Set `false` to opt out entirely. */
  s3Push?: PushSnapshotOpts | false;
}


function ensureDir(path: string): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* best-effort */ }
}

/** Merge per-source results into a snapshot. Successful sources contribute
 *  models in source order; duplicates are kept (catalog merger is a later
 *  layer). Shared by the full `runDiscovery` path and the route-level
 *  timeout partial so both honor the same flatten contract. */
export function buildDiscoverySnapshot(
  results: readonly DiscoverySourceResult[],
  now: () => number = Date.now,
): DiscoverySnapshot {
  const models: DiscoveredModel[] = [];
  for (const r of results) {
    if (r.ok) models.push(...r.models);
  }
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now()).toISOString(),
    sources: results.map((r) => ({
      id: r.source,
      ok: r.ok,
      durationMs: r.durationMs,
      modelCount: r.models.length,
      ...(r.error !== undefined ? { error: r.error } : {}),
    })),
    models,
  };
}

/** Run every source in parallel, merge, persist. Returns the snapshot
 *  + per-source results. Per-source failures don't fail the run — the
 *  caller (HTTP handler / cron) decides whether the partial is OK. */
export async function runDiscovery(
  opts: RunDiscoveryOpts = {},
): Promise<{
  snapshot: DiscoverySnapshot;
  results: DiscoverySourceResult[];
  s3Push?: PushSnapshotResult;
}> {
  const sources = opts.sources ?? BUILTIN_SOURCES;
  const now = opts.now ?? Date.now;
  // ⚠️⚠️ **호출자 계약 변경 — 명시적으로 승인된 것이다**(2026-09-01 · `#14928`).
  //   ⓐ 이전: 소스 하나가 «던지면» `runDiscovery` 가 reject 했다.
  //      이제:  그 소스가 `ok:false` + `error: 'source-threw: …'` 결과로 «정규화»되고
  //             나머지 소스의 부분 스냅샷이 «살아남는다».
  //   ⓑ 그래서 «영속화»도 바뀐다 — 이전엔 그런 런이 캐시/S3 에 «아무것도» 안 남겼지만
  //      이제는 ***부분 스냅샷이 남는다***. 이것이 의도다: 소스 하나가 터졌다고
  //      나머지 7개의 발굴 결과를 버리는 것이 더 나쁘다.
  //   ⓒ 영향받는 호출자: 라우트(`nexus/api/registry-discovery.ts`) ⊕ **cron**
  //      (`src/registry/discovery/cron.ts:100`). ⛔ cron 은 이 변경을 «받는다» —
  //      그쪽은 부분 결과가 남는 편이 낫다(매일 도는 갱신이라, 한 소스의 일시 장애로
  //      그날 갱신 전체를 버릴 이유가 없다).
  //   📌 그래도 이것은 «계약 변경»이므로, cron 산출이 갑자기 `source-threw:` 를 담기
  //      시작하면 그건 «새 결함»이 아니라 ***전에는 안 보이던 실패가 드러난 것***이다.
  //
  // ⛔ raw `Promise.all` 은 이 함수의 «머리말 계약»을 깬다 —
  //    "Per-source failures don't fail the run" 이라고 적혀 있는데, 소스 하나가
  //    던지면 `Promise.all` 이 즉시 reject 해 ***부분 결과가 통째로 사라진다.***
  //    라우트뿐 아니라 cron 등 «모든» 호출자가 그 계약을 믿으므로 여기서 정규화한다.
  const results = await Promise.all(
    sources.map(async (s) => {
      // ⛔ 실패에도 «진짜» 소요 시간을 싣는다. 0 을 박으면 「빨리 실패했다」와
      //    「오래 끌다 터졌다」가 같아 보이고, 그건 거짓 관측이다.
      const sourceStartedAt = Date.now();
      try {
        return await s.run({
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts.now !== undefined ? { now: opts.now } : {}),
        });
      } catch (err) {
        return {
          source: s.id,
          ok: false as const,
          models: [],
          durationMs: Date.now() - sourceStartedAt,
          error: `source-threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );
  const snapshot = buildDiscoverySnapshot(results, now);
  // Route-level overall timeout aborts `opts.signal`. Do not persist a
  // late snapshot after the HTTP handler has already returned a partial —
  // it would write a snapshot the client never saw and race the next run.
  // 📏 영향 범위(전수 · 2026-09-01): `runDiscovery` 호출자는 둘이고
  //    `signal` 을 «주는» 것은 HTTP 라우트 하나뿐이다.
  //    `src/registry/discovery/cron.ts` 는 signal 을 주지 않으므로(그 파일에 0건)
  //    이 분기가 «항상 거짓»이고 cron 의 영속화 계약은 바뀌지 않는다.
  if (opts.signal?.aborted) {
    return { snapshot, results };
  }
  if (!opts.skipCacheWrite) {
    const path = opts.cachePath ?? defaultDiscoveryCachePath();
    ensureDir(path);
    try {
      writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }
  // RFC #2161 FU A7 — mirror to S3 when the user hasn't opted out.
  // The push helper gates on isS3Available() internally so this is
  // safe to call unconditionally; on hosts without aws creds the
  // push silently no-ops with `reason: 'disabled'`.
  let s3Push: PushSnapshotResult | undefined;
  if (opts.s3Push !== false) {
    s3Push = pushDiscoverySnapshotToS3(snapshot, opts.s3Push ?? {});
  }
  return { snapshot, results, ...(s3Push ? { s3Push } : {}) };
}

