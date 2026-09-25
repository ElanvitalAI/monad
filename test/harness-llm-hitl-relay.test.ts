import { describe, expect, it } from 'bun:test';
import { buildLlmHitlRelay } from '../src/harness/llm-hitl-relay.js';

// C4 — PR-open confirm 은 outward-facing side-effect 라, 비대화 relay 가 approveSideEffects 없이는
//   LLM 에 묻지 않고 fail-closed(자동승인 금지) 해야 한다. 정규식을 직접 테스트(Goodhart)하지 않고
//   relay.confirm 의 **외부 동작**으로 표현 변형을 검증한다(리뷰 지적 — 실제 자연어 변형 커버).
describe('buildLlmHitlRelay — PR-open fail-closed (C4)', () => {
  const prOpenVariants = [
    'PR 열까요?',
    'PR을 열까요?',
    'PR를 열까요?',
    'PR을 생성할까요?',
    'PR 올릴까요?',
    'draft PR 만들까요?',
    'Open a PR?',
    'create a pull request?',
  ];
  for (const prompt of prOpenVariants) {
    it(`"${prompt}" → fail-closed (LLM 미조회)`, async () => {
      let asked = false;
      const relay = buildLlmHitlRelay({ ask: async () => { asked = true; return 'yes'; }, observe: () => {} });
      expect(await relay.confirm({ prompt })).toBe(false);
      expect(asked).toBe(false);   // side-effect → LLM 에 아예 안 물음(우회 불가)
    });
  }

  it('저위험 confirm(비-side-effect)은 LLM 판단으로 승인될 수 있다(무회귀)', async () => {
    let asked = false;
    const relay = buildLlmHitlRelay({ ask: async () => { asked = true; return 'yes'; }, observe: () => {} });
    expect(await relay.confirm({ prompt: '이 함수 이름을 바꿀까요?' })).toBe(true);
    expect(asked).toBe(true);   // 저위험은 LLM 에 물어 판단
  });

  it('approveSideEffects=true 면 PR-open 도 LLM 판단(명시 승인 컨텍스트)', async () => {
    const relay = buildLlmHitlRelay({ ask: async () => 'yes', approveSideEffects: true, observe: () => {} });
    expect(await relay.confirm({ prompt: 'PR을 열까요?' })).toBe(true);
  });
});
