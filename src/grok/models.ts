// ── xAI (Grok) model catalog — Wave (2026-05-04) ──
//
// Mirrors src/codex/models.ts + src/anthropic/models.ts +
// src/gemini/models.ts pattern. Curated subset of the xAI roster
// monad-agent tracks for the wizard / picker.
//
// Source-of-truth:
//   - docs.x.ai/developers/models            ← ⭐ 1차. `Last updated: August 12, 2026`
//   - x.ai/news/grok-4-6
//   - docs.x.ai/developers/release-notes
//
// Refresh cadence: re-run omni-crawl/firecrawl when xAI ships a new flagship.
//
// ── 갱신 이력 ──
//   2026-05-04  초판 (omni-crawl)
//   2026-07-15  Grok 4.5 flagship
//   2026-08-13  ⭐ **Grok 4.6 flagship** (firecrawl · docs.x.ai 1차 대조)
//
// ⛔⭐ **출처 등급을 항목마다 표시한다** — 이번 갱신에서 docs.x.ai 가 «4.6 하나만»
// 항목화하고 구형은 목록에서 뺐다. 그래서 구형 항목의 수치는 «오늘 재확인되지 않았다».
// 추측으로 덮지 않고 `provenance` 로 표시한다:
//   'docs-2026-08-13' = 오늘 1차 확인 · 'crawl-<날짜>' = 그때 크롤(미재확인)
//
// ⚠️ **미해결 하나** — `grok-4-1-fast` 컨텍스트가 출처마다 다르다(이 파일 256k vs
// 2차 출처 2M). docs.x.ai 가 항목화를 안 해 «판정 불가»라 기존 값을 유지했다.
//
// 모델 별칭 규약(docs.x.ai): `<name>`=최신 stable · `<name>-latest`=최신 ·
// `<name>-<date>`=고정. ⊕ `logprobs`/`top_logprobs` 는 `grok-4.20` 이후 무시된다.

export type GrokModelTier = 'flagship' | 'balanced' | 'cheap' | 'legacy';

export interface GrokModel {
  id: string;
  /** Human-friendly label for the picker. */
  label: string;
  tier: GrokModelTier;
  /** One-line elevator pitch. */
  description: string;
  /** Context window (tokens). null when not publicly specified. */
  contextWindow: number | null;
  /** Approximate pricing in USD per M input / M output tokens.
   *  Cache rate included when supported.
   *  Informational only; actual billing comes from xAI. */
  pricingUsd: {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
  } | null;
  /** True when this model has built-in reasoning (chain-of-thought
   *  always active or budget-controlled). grok-4.3 has reasoning
   *  always-on per docs.x.ai. */
  supportsThinking: boolean;
  /** Shown as the default pick in the wizard when true. Exactly one
   *  model should be marked recommended at any time. */
  recommended?: boolean;
  /** ⛔ 이 항목의 수치를 «언제·어느 등급» 출처로 확인했나.
   *  `docs-<날짜>` = docs.x.ai 1차 · `crawl-<날짜>` = 그 시점 크롤(이후 미재확인).
   *  구형 모델은 docs.x.ai 가 항목화를 멈추면 재확인이 불가능해진다 — 그때
   *  「모른다」를 「맞다」로 접지 않기 위해 남긴다. */
  provenance: string;
}

/** Curated Grok models. Ordering reflects the UI: recommended first,
 *  then by descending tier. */
export const GROK_MODELS: GrokModel[] = [
  {
    id: 'grok-4.7',
    label: 'Grok 4.7',
    tier: 'flagship',
    description: 'xAI 최신 flagship — grok CLI 의 «기본 모델»이다(`grok models` 실측 2026-09-22: `* grok-4.7 (default)`). 지식 컷오프 2026-05. Recommended for monad-agent grok sessions.',
    // ⭐ docs.x.ai 1차 (2026-09-22): Context 500k · <200k $2.00/$6.00 (캐시 $0.50)
    //    ⚠️ ***가격이 «구간»으로 갈린다*** — ≥200k 는 $4.00/$12.00 (캐시 $1.00).
    //       이 카탈로그는 칸이 하나라 «<200k 구간»을 싣는다. 긴 창을 쓰면 실제 비용은 2배다.
    contextWindow: 500_000,
    pricingUsd: { inputPerM: 2.0, outputPerM: 6.0, cacheReadPerM: 0.5 },
    supportsThinking: true,
    recommended: true,
    provenance: 'docs-2026-09-22',
  },
  // ⛔⭐ `grok-4.7-build-fast` 를 «일부러» 싣지 않는다 — 2026-09-22 조사 결과:
  //
  //  📏 1차 관측(내가 직접 호출) — ***공개 xAI API 에 «없다»***:
  //       GET /v1/models          13개 · 4.7 계열 = grok-4.7 «뿐»
  //       GET /v1/language-models  8개 · 4.7 계열 = grok-4.7 «뿐»
  //     ⇒ API 키로 가는 경로(이 카탈로그의 `envKey: GROK_API_KEY`)에서는 ***부를 수 없다.***
  //
  //  📏 1차 관측(grok CLI) — ***구독 경로에는 «있다»***:
  //       `grok models` → `* grok-4.7 (default)` ⊕ `- grok-4.7-build-fast`
  //     ⇒ Grok Build/Cursor 표면 전용이고, elanous 는 agent-mission(구독 PTY)으로만 닿는다.
  //
  //  📏 x.ai 공지 1차 문면: ***"twice the output speed at twice the price"***
  //     ⇒ 같은 모델을 «빠른 인프라»에 올린 것이고 토큰 단가가 2배다(<200k 기준 $4/$12).
  //     ⛔ docs.x.ai 의 모델·가격 표에는 ***항목 자체가 없다*** — 그래서 컨텍스트 창·캐시가는 «모른다».
  //
  //  🔑 ⇒ 싣지 않는 이유는 「몰라서」가 아니라 ***「이 카탈로그가 말하는 축(공개 API)에 존재하지 않아서」***다.
  //     싣는 순간 `--child-llm-model grok-4.7-build-fast` 가 API 경로에서 «조용히» 실패한다.
  //     쓰려면 agent-mission(구독) 경로에서 grok CLI 에 직접 주어야 한다.
  {
    id: 'grok-4.6',
    label: 'Grok 4.6',
    tier: 'flagship',
    description: 'xAI 최신 flagship(2026-08-12) — "our flagship model for code and everything else: agentic tool calling, minimal hallucinations, configurable reasoning". 지식 컷오프 2026-02-01. Recommended for monad-agent grok sessions.',
    // ⭐ 셋 다 docs.x.ai 1차 (2026-08-13 firecrawl):
    //    Context 500k tokens · Input $2.00/1M · Output $6.00/1M
    // ⚠️ 4.5 는 2M 이었는데 4.6 은 «500k 로 줄었다** — 오타가 아니다.
    contextWindow: 500_000,
    // ✅ 2026-09-22 docs 재확인: cacheReadPerM 이 «생겼다» — $0.50 (<200k).
    pricingUsd: { inputPerM: 2.0, outputPerM: 6.0, cacheReadPerM: 0.5 },
    supportsThinking: true,   // reasoning: Configurable (`reasoning_effort`)
    recommended: false,       // ⬇️ 4.7 등장으로 강등 (2026-09-22)
    provenance: 'docs-2026-08-13',
  },
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    tier: 'flagship',
    description: '직전 flagship(2026-07 GA) — 코딩·에이전틱·지식작업, intelligent+efficient reasoning. 4.6 등장으로 강등.',
    // ⛔ 2026-08-18 정정: 2_000_000 은 «낡은 값»이었다 — 4.5 도 500k 다(omni-crawl grok-web ⊕ docs).
    contextWindow: 500_000,
    pricingUsd: { inputPerM: 2.0, outputPerM: 6.0, cacheReadPerM: 0.5 },
    supportsThinking: true,
    recommended: false,
    provenance: 'crawl-2026-07-15',
  },
  {
    id: 'grok-4.3',
    label: 'Grok 4.3',
    tier: 'balanced',
    description: 'Flagship (2026-04-30 GA) — reasoning always active, agentic workflows, 1M context, native server-side tools. 저비용 균형.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 1.25, outputPerM: 2.50, cacheReadPerM: 0.20 },
    supportsThinking: true,
    recommended: false,
    provenance: 'crawl-2026-05-04',
  },
  {
    id: 'grok-4.20',
    label: 'Grok 4.20',
    tier: 'flagship',
    description: 'Long-context flagship — 2M context, same pricing. Pick when input volume is the bottleneck.',
    contextWindow: 2_000_000,
    pricingUsd: { inputPerM: 1.25, outputPerM: 2.50, cacheReadPerM: 0.20 },
    supportsThinking: true,
    provenance: 'crawl-2026-05-04',
  },
  {
    // ⭐ 2026-08-18 신규 — xAI `/v1/language-models` ⊕ 실호출로 확인.
    //    별칭 `grok-code-fast-1`/`grok-code-fast` 가 이 모델로 온다.
    id: 'grok-build-0.1',
    label: 'Grok Build 0.1',
    tier: 'cheap',
    description: 'Agentic coding 특화 — 256k context, 최저가 계열. 고빈도/지연민감 코딩 흐름용.',
    contextWindow: 256_000,
    pricingUsd: { inputPerM: 1.00, outputPerM: 2.00, cacheReadPerM: 0.20 },
    supportsThinking: false,
    provenance: 'xai-api-2026-08-18',
  },
  // ⛔⭐ 2026-08-18 제거 — `grok-4-1-fast`(cheap) 와 `grok-4`(legacy) 는 «없는 모델이 아니라»
  //    ***200 OK 로 응답하면서 실제로는 `grok-4.3` 이 도는*** 레거시 별칭이었다(실호출 대조).
  //    ⇒ 여기 남겨 두면 «$0.20/$0.50 짜리 최저가가 있다»는 거짓 정보가 계속 퍼진다.
  //      실제로 그 오해가 티어 표의 budget 을 6.25배 비싼 모델로 돌게 했다.
];

export function defaultGrokModel(): GrokModel {
  return GROK_MODELS.find(m => m.recommended) ?? GROK_MODELS[0]!;
}

export function findGrokModel(id: string): GrokModel | undefined {
  return GROK_MODELS.find(m => m.id === id);
}
