import { describe, it, expect } from 'bun:test';
import { openAiOutputTokenField, openAiTemperatureField, isNewGenerationOpenAiModel, openAiCompatSamplingFields } from './llm.js';

// ⛔ 이 회귀는 «칸 이름»을 문다. 2026-08-22 에 `provider auto` 가 gpt-5.6 계열로 바뀐 뒤
//   3시간 만에 400 이 93건 났고 7일 창의 그 이전 발생은 0이었다(`#11161` → 이 수리).
describe('openAiOutputTokenField — 모델 세대로 출력 상한 칸이 갈린다', () => {
  it('gpt-5 계열은 max_completion_tokens 를 쓴다', () => {
    for (const m of ['gpt-5.6-terra', 'gpt-5.5', 'gpt-5', 'GPT-5.6-Luna']) {
      expect(openAiOutputTokenField(m, 2048)).toEqual({ max_completion_tokens: 2048 });
    }
  });

  it('gpt-4o 계열은 «여전히» max_tokens 를 쓴다 — 반대 방향', () => {
    for (const m of ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1']) {
      expect(openAiOutputTokenField(m, 2048)).toEqual({ max_tokens: 2048 });
    }
  });

  it('o 계열 추론 모델도 새 칸을 쓴다', () => {
    expect(openAiOutputTokenField('o3-mini', 512)).toEqual({ max_completion_tokens: 512 });
  });

  it('⛔ 값을 «안 보내는» 선택은 하지 않는다 — 상한이 사라지면 비용이 조용히 는다', () => {
    for (const m of ['gpt-5.6-terra', 'gpt-4o-mini']) {
      const got = openAiOutputTokenField(m, 777);
      expect(Object.keys(got)).toHaveLength(1);
      expect(Object.values(got)[0]).toBe(777);
    }
  });
});

// ⛔ 2026-08-22: max_tokens 를 고친 «2분 뒤»부터 temperature 로 같은 400 이 났다(90분 41건).
//   ⇒ ***한 파라미터만 고치면 다음 파라미터에서 막힌다.*** 세대 판정을 한 자리로 모은다.
describe('openAiTemperatureField — 같은 세대가 temperature 도 거부한다', () => {
  it('gpt-5 계열엔 temperature 를 «안 보낸다»(칸 생략)', () => {
    for (const m of ['gpt-5.6-terra', 'gpt-5.5', 'gpt-5', 'o3-mini']) {
      expect(openAiTemperatureField(m, 0.3)).toEqual({});
    }
  });

  it('gpt-4o 계열은 «여전히» temperature 를 받는다 — 반대 방향', () => {
    for (const m of ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1']) {
      expect(openAiTemperatureField(m, 0.3)).toEqual({ temperature: 0.3 });
    }
  });

  it('⛔ 「1로 보내기」를 택하지 않았다 — 보내면 또 다른 거부를 부른다', () => {
    expect(openAiTemperatureField('gpt-5.6-terra', 1)).toEqual({});
  });

  it('⛔ 세대 자가 «늙지 않는다» — gpt-6 이상도 새 세대다 (2026-09-12 실측: gpt-6-astra 가 400 을 받았다)', () => {
    for (const m of ['gpt-6-astra', 'gpt-7', 'gpt-10-x', 'gpt-5.6-terra']) {
      expect(isNewGenerationOpenAiModel(m)).toBe(true);
      expect(openAiOutputTokenField(m, 1)).toEqual({ max_completion_tokens: 1 });
      expect(openAiTemperatureField(m, 0.3)).toEqual({});
    }
  });

  it('⛔ 옛 세대는 그대로 옛 칸을 쓴다 — 정정이 «반대 극단»으로 가지 않는다', () => {
    for (const m of ['gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo', 'qwen3-coder', 'llama-3']) {
      expect(isNewGenerationOpenAiModel(m)).toBe(false);
      expect(openAiOutputTokenField(m, 1)).toEqual({ max_tokens: 1 });
      expect(openAiTemperatureField(m, 0.3)).toEqual({ temperature: 0.3 });
    }
  });

  it('세대 판정이 두 칸에서 «같은 자»를 쓴다', () => {
    for (const m of ['gpt-5.6-terra', 'gpt-4o-mini', 'o3-mini', 'gpt-6-astra']) {
      const newGen = isNewGenerationOpenAiModel(m);
      expect('max_completion_tokens' in openAiOutputTokenField(m, 1)).toBe(newGen);
      expect(Object.keys(openAiTemperatureField(m, 0.3)).length === 0).toBe(newGen);
    }
  });
});

describe('openAiCompatSamplingFields — 한 경로가 두 브랜드를 태운다', () => {
  // 🩸 2026-09-12 — `makeOpenAICompatProvider` 가 grok·openai 를 «한 경로»로 태우면서
  //   둘 다 옛 칸을 생으로 박았다. 실측: gpt-6-astra 가 api.openai.com 에서 400 을 받았고
  //   그 400 이 review.done 미실행 57건 중 30건이었다.
  it('openai 브랜드 + 새 세대 → 새 칸만 나가고 temperature 는 «생략»된다', () => {
    expect(openAiCompatSamplingFields('openai', 'gpt-6-astra', 0.3, 2048))
      .toEqual({ max_completion_tokens: 2048 });
    expect(openAiCompatSamplingFields('openai', 'gpt-5.6-terra', 0.3, 1024))
      .toEqual({ max_completion_tokens: 1024 });
  });

  it('openai 브랜드 + 옛 세대 → 종전 칸 그대로', () => {
    expect(openAiCompatSamplingFields('openai', 'gpt-4o-mini', 0.3, 2048))
      .toEqual({ temperature: 0.3, max_tokens: 2048 });
  });

  it('⛔ grok 은 «안 바뀐다» — 옛 칸을 그대로 받는다', () => {
    expect(openAiCompatSamplingFields('grok', 'grok-4.6', 0.3, 2048))
      .toEqual({ temperature: 0.3, max_tokens: 2048 });
    expect(openAiCompatSamplingFields('local', 'qwen3-coder', 0.7, 4096))
      .toEqual({ temperature: 0.7, max_tokens: 4096 });
  });
});
