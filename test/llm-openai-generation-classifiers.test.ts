// ⛔ 2026-09-23 — GPT-6 이관 뒤 «이름 접두» 판정자 셋이 운영 기본을 옛 세대로 읽었다:
//   `modelSupportsReasoning`(→ /reasoning·HUD 거부) · `isVisionCapableModel('openai-codex')`(→ 이미지 미전송) ·
//   `isLikelyVisionModel`(→ 스킬 이미지 경고). 근거 사실 = codex 모델 캐시: gpt-6-* 전부 image 입력 ⊕ low~max 추론.
// ⭐ 오늘의 모델명을 박지 않는다 — codex 사다리의 «모든 칸»이 통과해야 한다(다음 이관도 저절로 눌린다).
import { describe, expect, test } from 'bun:test';
import { isLikelyVisionModel, modelSupportsReasoning } from '../src/llm';
import { isVisionCapableModel } from '../src/llm-vision-capability';
import { LLM_TIER_MAP_BY_PROVIDER } from '../src/model-tier/llm-tier-map';
import { MODEL_TIERS } from '../src/model-tier/types';

const codexLadder = [...new Set(MODEL_TIERS.map((t) => LLM_TIER_MAP_BY_PROVIDER['openai-codex'][t].model))];

describe('codex 사다리의 모든 모델은 추론·비전을 지원한다고 판정된다', () => {
  test('자가 공허하지 않다', () => { expect(codexLadder.length).toBeGreaterThan(1); });
  for (const model of codexLadder) {
    test(model, () => {
      expect(modelSupportsReasoning('openai-codex', model)).toBe(true);
      expect(isVisionCapableModel('openai-codex', model, 'userMessage')).toBe(true);
      expect(isLikelyVisionModel(model)).toBe(true);
    });
  }
});

describe('대조군 — 세대 숫자 규칙이 옛 세대·비추론 변형을 끌어올리지 않는다', () => {
  test('gpt-5-chat 은 추론 없음 · gpt-4/3.5 는 비전 없음', () => {
    expect(modelSupportsReasoning('openai-codex', 'gpt-5-chat-latest')).toBe(false);
    expect(isVisionCapableModel('openai-codex', 'gpt-4', 'userMessage')).toBe(false);
    expect(isLikelyVisionModel('gpt-3.5-turbo')).toBe(false);
    expect(isLikelyVisionModel('gpt-4')).toBe(false);
  });
});
