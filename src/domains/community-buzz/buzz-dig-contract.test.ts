// BuzzDigContract 단위테스트 — 순수(도구 화이트리스트·프롬프트·태스크).
import { describe, test, expect } from 'bun:test';
import { buildBuzzDigContract, buildBuzzDigPrompt, buildBuzzDigTask } from './buzz-dig-contract.js';

describe('buildBuzzDigContract — 읽기전용 화이트리스트', () => {
  test('분석 도구만·매매도구 없음', () => {
    const tools = buildBuzzDigContract().tools;
    expect(tools).toContain('finance_kr_flow'); // 파생 디깅
    expect(tools).toContain('fact_check');       // lead/lag
    expect(tools).toContain('memory_recall');
    expect(tools).toContain('OmniSearch');
    // 매매 도구 배제
    expect(tools).not.toContain('submit_trade_decision');
    expect(tools).not.toContain('place_order');
  });
});

describe('buildBuzzDigPrompt — 규율', () => {
  const p = buildBuzzDigPrompt();
  test('파생 교차·매매격리·도구강제·산출형식', () => {
    expect(p).toContain('파생'); // 선물/풋콜 교차
    expect(p).toContain('READ-ONLY');
    expect(p).toContain('도구를 실제로 호출'); // codex 지식단정 방지
    expect(p).toContain('VERDICT:');
  });
});

describe('buildBuzzDigTask', () => {
  test('ticker·예시·급부상 메타 포함', () => {
    const t = buildBuzzDigTask('000660.KO', ['하닉 폭등', '하이닉스 신고가', 'x', 'y'], { ratio: 8, leadLag: 'leading' });
    expect(t).toContain('000660.KO');
    expect(t).toContain('x8·leading');
    expect(t).toContain('하닉 폭등');
    expect((t.match(/^- /gm) ?? []).length).toBe(3); // 예시 3개로 제한
  });
});
