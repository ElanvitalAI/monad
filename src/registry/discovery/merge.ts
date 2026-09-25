// 발견 스냅숏 «부분 갱신» — 고른 소스만 다시 돌려 기존 스냅숏에 병합한다(2026-09-23).
//
// 왜: 운영 스냅숏을 갱신하는 문이 `POST /v1/registry/discovery` 하나였고, 그 문은 «전 소스»
//   (유료 `grok-crawl` 포함)를 돌리고 S3 에 푸시한다. OpenRouter 폴드(`loader.ts` foldDiscoveredModels)
//   하나를 위해 그 비용·외부 발신을 치를 이유가 없다.
//
// 계약:
//   - 성공한 소스: 그 소스가 «이번에 낸» (provider, discoveryMeta.source) 쌍의 옛 모델을 걷고 새 것으로 바꾼다.
//   - ⛔ 실패한 소스: 옛 모델을 «지우지 않는다» — 한 번의 일시 장애가 좋은 데이터를 지우면 안 된다.
//     sources[] 의 옛 건강 항목도 그대로 두고, 실패는 호출자에게 결과로만 돌려준다.
//   - 다른 소스의 모델은 건드리지 않는다.
import type { DiscoverySnapshot } from './cache.js';
import type { DiscoverySourceResult } from './types.js';

export function mergeDiscoverySnapshot(
  prev: DiscoverySnapshot | null,
  fresh: readonly DiscoverySourceResult[],
  now: () => number = Date.now,
): DiscoverySnapshot {
  const base: DiscoverySnapshot = prev ?? { version: 1, generatedAt: new Date(now()).toISOString(), sources: [], models: [] };
  const replaced = new Set<string>();
  for (const r of fresh) {
    if (!r.ok) continue;
    for (const m of r.models) replaced.add(`${m.provider}\u0000${m.discoveryMeta.source}`);
  }
  const kept = base.models.filter((m) => !replaced.has(`${m.provider}\u0000${m.discoveryMeta?.source}`));
  const added = fresh.filter((r) => r.ok).flatMap((r) => r.models);
  const okIds = new Set(fresh.filter((r) => r.ok).map((r) => r.source));
  const sources = [
    ...base.sources.filter((s) => !okIds.has(s.id)),
    ...fresh.filter((r) => r.ok).map((r) => ({ id: r.source, ok: true, durationMs: r.durationMs, modelCount: r.models.length })),
  ];
  return { version: base.version, generatedAt: new Date(now()).toISOString(), sources, models: [...kept, ...added] };
}
