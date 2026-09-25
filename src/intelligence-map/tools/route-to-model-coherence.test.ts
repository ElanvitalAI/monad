// ── recommendModel(RouteToModel) ↔ catalog SSoT 정합 가드 (2026-07-15) ──────────
//
// recommendModel 은 `route_to_model` LLM 툴로만 소비되던 순수 recommender 라, 그 후보 풀(BUILTIN_CATALOG
// 의 cloud 엔트리)이 catalog/(SSoT)에서 drift 하면 **catalog 에 없는 팬텀 모델을 추천**할 수 있었다(관측·
// 가드 부재). 이 테스트는 recommender 풀을 SSoT 에 묶는다 — model-catalog 소스 drift 0(팬텀 추천 방지).
// 지속 LLM 관리 루프의 셀프힐 입력과 같은 detectRoutingDrift 를 재사용(중복 로직 없음).

import { describe, it, expect } from 'bun:test';
import { reloadCatalog } from '../../registry/loader.js';
import { detectRoutingDrift } from '../../registry/llm-routing-drift.js';
import { recommendModel } from '../recommend-model.js';
import { BUILTIN_CATALOG } from '../model-catalog.js';
import type { CostSnapshot, CostCapConfig, SystemSnapshot } from '../types.js';

describe('RouteToModel ↔ catalog SSoT 정합', () => {
  it('recommender 후보 풀(model-catalog cloud)이 catalog active 에 정합 — 팬텀 추천 방지', () => {
    reloadCatalog();
    // recommendModel 이 enabledModels(BUILTIN_CATALOG) 로 후보를 만들므로, model-catalog 소스 drift 가
    // 곧 recommender 팬텀 추천 위험. 감사 대상 provider 의 cloud 엔트리는 전부 catalog-active 여야 한다.
    const poolDrift = detectRoutingDrift().filter((d) => d.source === 'model-catalog');
    expect(poolDrift.map((d) => `${d.key}:${d.status}`)).toEqual([]);
  });

  it('recommendModel 추천 결과가 후보 풀 안(순수·결정론) — 존재하지 않는 id 반환 안 함', () => {
    // env 키를 넣어 cloud 후보가 살아남게 하고, 추천 id 가 enabled 풀에 실재하는지 확인(팬텀 방지).
    const env = { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'x', GROK_API_KEY: 'x', GEMINI_API_KEY: 'x' } as NodeJS.ProcessEnv;
    const enabledIds = new Set(BUILTIN_CATALOG.models.filter((m) => !m.envKey || env[m.envKey]).map((m) => m.id));
    const system: SystemSnapshot = {
      cpuCount: 12, loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, cpuPercent: 0,
      freeMemGb: 64, totalMemGb: 128, freeMemPercent: 50, platform: 'darwin', arch: 'arm64', snapshotAt: 0,
    };
    const cost: CostSnapshot = {
      totalUsd: 0, weeklyUsd: 0, monthlyUsd: 0, perModel: {}, perGoal: {},
      weekStart: 0, monthStart: 0, eventsCount: 0, snapshotAt: 0,
    };
    const costConfig: CostCapConfig = {};
    const rec = recommendModel('reasoning', {}, { catalog: BUILTIN_CATALOG, system, cost, costConfig, env });
    if (rec.recommended) expect(enabledIds.has(rec.recommended)).toBe(true);
    for (const alt of rec.alternatives) expect(enabledIds.has(alt)).toBe(true);
  });
});
