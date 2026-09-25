// local provider 의 «구현부» 배선을 무는 자 (2026-08-18).
//
// ⛔ 무엇을 푸는가 — 2026-08-18 실측: local 티어 사다리가 LM Studio 실물에 «없는» 모델을
//   가리켰고(qwen3.6-coder-7b · glm-4.5-air · qwen3.6-32b), `ROLE_MODEL_DEFAULTS.implement` 가
//   tier 'better' 라 ***구현 역할이 존재하지 않는 glm-4.5-air 를 불렀다.***
//   그런데 그 사실을 무는 테스트가 «하나도» 없었다 — 그래서 아무도 안 세고 있었다(리뷰 must-fix).
//
// ⭐ 이 자가 «안 하는 것»: LM Studio 에 붙지 않는다. 결정적 스위트가 네트워크·사람 조작에
//   묶이면 그 스위트가 환경을 잰다. 라이브 대조는 로드맵 §0 의 «명령»이 한다.
//
// ⭐ 이 자가 «하는 것»: 사다리 내부 정합 — 「구현 역할이 타는 칸이 무엇으로 풀리나」를 고정한다.

import { describe, it, expect } from 'bun:test';
import { lookupLlmTierSpec } from './index.js';
import { PROVIDER_DEFAULT_MODEL, resolveRoleLlm, getUserConfig } from '../user-config.js';

// Classification: unlike dev-pipeline's default-seam leak, this file directly resolves
// the local provider tier and never constructs a reviewer seam or contacts LM Studio.
// Its explicit local endpoint stabilizes active-provider discovery only.
function localResolverConfig() {
  const config = getUserConfig();
  return {
    ...config,
    llm: { ...config.llm, provider: 'local' as const, baseUrl: 'http://local-tier.invalid/v1', model: PROVIDER_DEFAULT_MODEL.local },
  };
}

const LOCAL_TIERS = ['budget', 'balanced', 'better', 'best', 'loaded'] as const;

describe('local tier — 구현 역할이 «실물»로 풀린다', () => {
  it('⭐ implement 역할이 «실제 해석 경로»로 local 실물을 부른다', () => {
    // ⛔ tier 이름('better')을 하드코드하지 않는다(리뷰 must-fix) — 그러면 implement 의 tier 가
    //   바뀌어도 이 테스트가 «조용히» 통과한다. 그래서 resolveRoleLlm 을 «실제로 태운다».
    const resolved = resolveRoleLlm('implement', { config: localResolverConfig(), overrides: { implement: { provider: 'local' } } });
    expect(resolved.provider).toBe('local');
    // 그 결과가 provider 기본값과 «갈리지 않는지» — 갈리면 「구현이 부르는 것」과
    // 「local 의 기본」이 달라져 진단이 흐려진다.
    expect(resolved.model).toBe(PROVIDER_DEFAULT_MODEL.local);
  });

  it('⭐ implement 의 tier 가 무엇이든, 그 tier 의 local 모델이 provider 기본값과 같다', () => {
    // 위 테스트가 tier 를 안 보므로, 여기서 «해석된 tier» 를 통해 한 번 더 잇는다.
    const resolved = resolveRoleLlm('implement', { config: localResolverConfig(), overrides: { implement: { provider: 'local' } } });
    // ⛔ if 로 감싸면 tier 가 없을 때 이 검증이 «조용히 건너뛰어진다» — 분모가 0인데 통과다(리뷰 must-fix).
    //   tier 가 없는 것 자체가 신호이므로 «먼저» 단언한다.
    expect(resolved.tier).toBeDefined();
    expect(lookupLlmTierSpec('local', resolved.tier!).model).toBe(PROVIDER_DEFAULT_MODEL.local);
  });

  it('다섯 티어가 «전부» 값을 갖는다 (빈 칸이 있으면 그 티어가 조용히 폴백한다)', () => {
    for (const tier of LOCAL_TIERS) {
      const spec = lookupLlmTierSpec('local', tier);
      expect(typeof spec.model).toBe('string');
      expect(spec.model.length).toBeGreaterThan(0);
    }
  });

  it('⛔ 낡은 세대 모델 id 가 «남아 있지 않다» — 2026-08-18 에 이것들이 실물에 없었다', () => {
    // 이 목록은 «그때 없던 것»이고, 다시 등장하면 그 자체가 신호다.
    const KNOWN_ABSENT = ['qwen3.6-coder-7b', 'glm-4.5-air', 'qwen3.6-32b', 'llama-3'];
    const resolved = LOCAL_TIERS.map(t => lookupLlmTierSpec('local', t).model);
    resolved.push(PROVIDER_DEFAULT_MODEL.local);
    for (const absent of KNOWN_ABSENT) {
      expect(resolved).not.toContain(absent);
    }
  });

  it('📌 2026-08-18 기준선 — 다섯 티어 ⊕ 기본값이 «그날의 실물» 하나로 정렬돼 있다', () => {
    // ⛔ 「비어 있지 않다 ⊕ 과거 id 가 아니다」만으로는 «오타»도 통과한다(리뷰 must-fix).
    //   그래서 그날의 값을 «명시»한다. 사람이 다른 모델을 올려 이 값을 바꾸면 이 테스트가
    //   실패하고 — 그때 lms ps 로 «다시 재서» 이 줄을 옮긴다. 그것이 이 자의 용도다.
    //   📏 근거: 2026-08-18 lms ps ⇒ qwen3.8-27b-mlx (16.08 GB · 256k · MLX · Local)
    //
    // ⭐ 2026-09-23 — 이 줄이 «시킨 대로» 실패했고, 시킨 대로 `lms ps` 로 다시 쟀다.
    //   ⑴ 바꾼 것은 ***모델이 아니라 「접두」***다 — `local:` 을 붙였다(`#19867`).
    //      ⛔ 왜 접두가 필요한가: 접두 없는 `qwen3.8-27b-mlx` 는 계열 추론이 ***클라우드 qwen***
    //         으로 읽는다(이름이 겹친다). `local:` 이 그것을 가른다. 요청 직전에 벗겨진다.
    //   ⑵ 🔴 ***그리고 재 보니 「모델 축」도 늙어 있었다*** — 이 판에서 «안 고쳤다»:
    //        lms ps (2026-09-23 · 지금 로딩)  ⇒ ***qwen3.5-35b-a3b*** (20.42 GB · 127,502 ctx)
    //        /v1/models 가용 목록            ⇒ 25개 (qwen3.8-27b-mlx 도 «있다»)
    //      ⇒ 사다리가 가리키는 것은 «가용»하지만 «지금 돌고 있는 것»은 아니다.
    //      ⛔ 어느 로컬 모델을 쓸지는 ***이 판의 결정이 아니다***(대표/소유자 몫 ·
    //         `scripts/check-local-tier-models.ts` 가 그 축의 도구다). 사실만 적어 둔다.
    const EXPECTED = 'local:qwen3.8-27b-mlx';
    expect(PROVIDER_DEFAULT_MODEL.local).toBe(EXPECTED);
    for (const tier of LOCAL_TIERS) {
      expect(lookupLlmTierSpec('local', tier).model).toBe(EXPECTED);
    }
  });

  it('📏 loaded 가 best 와 «같다»는 사실이 라벨과 어긋나지 않는다', () => {
    // 로컬 실물이 하나뿐이라 두 칸이 같은 모델로 풀린다. 그것 자체는 정직하다.
    // ⛔ 다만 라벨이 «없는 동작»(multi-turn 등)을 광고하면 안 된다(리뷰 must-fix).
    const best = lookupLlmTierSpec('local', 'best');
    const loaded = lookupLlmTierSpec('local', 'loaded');
    if (best.model === loaded.model) {
      expect(loaded.label).not.toMatch(/multi-turn/i);
    }
  });
});
