// 골 저작 규율을 재는 자들이 «썩지 않는지» 본다.
//
// ⛔ 이 시험은 「그 자가 «돈다»」를 «안» 답한다 — 「그 자가 «여전히 갈린다»」만 답한다.
//   2026-09-01 실측: 이 저장소에 지은 자 다섯이 «전부» 코드 참조 0곳이었고, 그래서
//   돌리려면 사람이 문서를 읽고 그때 기억해서 쳐야 했다(자가 대신하려던 바로 그 규율).
//   ⇒ 「돌게 하는 것」은 프리플라이트·착지 게이트·감사 축의 몫이고, 이 파일은 «녹 방지»다.
import { describe, expect, test } from 'bun:test';
import { selfCheck as premiseMockedSelfCheck } from '../../scripts/goal-premise-mocked-by-signal.js';
import { selfCheck as functionExitsSelfCheck } from '../../scripts/goal-invariant-function-exits.js';

describe('골 저작 자 — 알려진 양성·음성으로 여전히 갈리는가', () => {
  test('goal-premise-mocked-by-signal 이 전제-목 짝을 잡고 다른 둘은 놓아준다', () => {
    expect(premiseMockedSelfCheck()).toBe(0);
  });

  test('goal-invariant-function-exits 가 반환 지점을 함수 «몸통 안»에서만 센다', () => {
    expect(functionExitsSelfCheck()).toBe(0);
  });
});
