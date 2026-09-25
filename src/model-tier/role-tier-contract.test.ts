// ⭐⭐ 2026-09-23 (대표 승인) — ***`loaded` 는 «사람이 고르는» 칸이다. 자동으로 안 탄다.***
//
// 🩸 계기: codex 과금 인시던트(2026-09-23). `review` 역할이 `loaded` 였고, `loaded` 는 codex 에서
//    `gpt-6-astra`($10/$50 · sol 대비 5배)다. 리뷰가 «매번» 그 칸을 탔고, 21시간 창에서
//    astra 가 codex 요청의 ***19%***(1,925건 · 조회 상한에 닿아 «하한»)였다.
//    ⛔ 그런데 `ROLE_MODEL_DEFAULTS` 바로 위 주석은 이미 *"planning 만 best 이고 나머지는 그 아래"*
//       라고 «설계를 적어 두고» 있었다. ⇒ 주석과 값이 다른 말을 했고, 값이 이겼다.
//
// ⛔⭐ ***이 시험은 모델 «이름»을 판정하지 않는다*** — 사다리가 움직이면 이름은 늙는다.
//    판정하는 것은 ***「어느 역할도 loaded 를 «자동»으로 요구하지 않는다」***라는 «계약»이다.
//    ⇒ 사다리를 어떻게 바꾸든, 누가 역할을 더하든, 이 계약은 같은 뜻을 유지한다.
import { describe, it, expect } from 'bun:test';
import { ROLE_MODEL_DEFAULTS } from '../user-config.js';
import { lookupLlmTierSpec, parseTierArg } from './llm-tier-map.js';

describe('역할 기본 티어 계약 — loaded 는 opt-in 전용 (대표 2026-09-23)', () => {
  it('⛔ 어떤 역할도 `loaded` 를 «자동»으로 요구하지 않는다', () => {
    const offenders = Object.entries(ROLE_MODEL_DEFAULTS)
      .filter(([, d]) => d.tier === 'loaded')
      .map(([role]) => role);
    expect(offenders).toEqual([]);
  });

  it('⛔ 자가 «무는지» — 역할 표가 비어 있으면 위 시험은 아무 말도 안 한다', () => {
    const roles = Object.keys(ROLE_MODEL_DEFAULTS);
    expect(roles.length).toBeGreaterThan(3);
    // 그리고 티어가 «한 값으로 접히지» 않았는지 — 접히면 사다리가 뜻을 잃는다.
    expect(new Set(Object.values(ROLE_MODEL_DEFAULTS).map((d) => d.tier)).size).toBeGreaterThan(1);
  });

  it('✅ 그러나 «명시로» 고르는 길은 살아 있다 — max/deep/maxi 가 loaded 에 닿는다', () => {
    // ⛔ 이 줄이 없으면 위 계약이 「loaded 를 «없애라»」로 읽힌다. 없애는 것이 «아니다» —
    //    사람이 `--tier max` 로 고르는 길은 그대로 둔다(자동으로만 안 탄다).
    // ⚠️ 별칭 해석은 `parseTierArg` 가 한다 — `lookupLlmTierSpec` 은 ModelTier 만 받는다.
    for (const alias of ['loaded', 'max', 'deep', 'maxi']) {
      expect(parseTierArg(alias)).toBe('loaded');
      expect(lookupLlmTierSpec('openai-codex', 'loaded').model.length).toBeGreaterThan(0);
    }
    // 그리고 «아무 문자열이나» loaded 가 되지는 않는다 — 자가 무는지 음성으로 누른다.
    expect(parseTierArg('medium')).not.toBe('loaded');
    expect(parseTierArg('bogus-tier')).toBeUndefined();
  });

  it('⭐ loaded 는 그 provider 사다리에서 «가장 비싼» 칸이다 — 그래서 opt-in 이다', () => {
    const TIERS = ['budget', 'balanced', 'better', 'best', 'loaded'] as const;
    // 가격은 catalog 축이라 여기선 «모델이 다른가»로만 본다 — 같으면 이 계약의 근거가 약해진다.
    const loaded = lookupLlmTierSpec('openai-codex', 'loaded').model;
    const others = TIERS.filter((t) => t !== 'loaded').map((t) => lookupLlmTierSpec('openai-codex', t).model);
    expect(others).not.toContain(loaded);
  });
  // ── 🅣 2026-09-23 보탬 — 대표 문면을 «그대로» 무는 두 칸.
  //    위 시험들은 「loaded 를 자동으로 안 쓴다」를 문다. 그것은 «티어 이름» 축이라,
  //    사다리가 개편돼 다른 칸이 astra 를 가리키게 되면 전부 초록인 채로 지시가 깨진다.
  //    ⇒ 여기선 사다리를 «거쳐서» 나온 ***계열 이름과 effort*** 를 직접 본다.

  it('⛔ review 는 astra 계열에 닿지 않는다 — 대표 「아스트라는 리뷰에서 사용 안 되도록」', () => {
    const review = lookupLlmTierSpec('openai-codex', ROLE_MODEL_DEFAULTS.review.tier).model;
    expect(review).not.toContain('astra');
    // 자가 무는지 — 그 계열이 사다리에 «있기는» 해야 위 단언이 뜻을 갖는다(없으면 공허하게 참).
    expect(lookupLlmTierSpec('openai-codex', 'loaded').model).toContain('astra');
  });

  it('⛔ review 의 effort 가 planning 보다 «낮지 않다» — 대표 「sol effort 레벨을 올린다거나는 말이 되구요」', () => {
    // 🔑 실제 결함은 「비싸다」가 아니라 ***「5배를 내면서 추론은 덜 했다」*** 였다
    //    (review=astra·medium ↔ planning=sol·high). 그러니 자는 planning 을 상대로 세운다.
    //    ⚠️ implement 를 상대로 세우면 결함 상태에서도 medium ≥ medium 이라 조용히 통과한다(실측).
    const RANK: Record<string, number> = { off: 0, low: 1, medium: 2, high: 3 };
    const lvl = (t: typeof ROLE_MODEL_DEFAULTS.review.tier): number =>
      RANK[lookupLlmTierSpec('openai-codex', t).reasoningLevel ?? 'off'] ?? 0;
    expect(lvl(ROLE_MODEL_DEFAULTS.review.tier)).toBeGreaterThanOrEqual(lvl(ROLE_MODEL_DEFAULTS.planning.tier));
  });
});
