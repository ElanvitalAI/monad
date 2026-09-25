/**
 * page-expressions.test.ts — ⛔⭐⭐ ***페이지 표현식이 «문법적으로 성립하는가».***
 *
 * 🩸 왜 있나(2026-09-10 · 하루에 «세 번»):
 *    페이지에서 돌 코드를 «템플릿 리터럴»로 짓는데, 그 «안»에 쓴 한글 주석의 백틱이
 *    ***리터럴을 끊어*** 파일 전체가 파싱 실패했다. 세 번 다 자리가 달랐다:
 *      state-motion · keyframes · computed-tokens
 *    ⊕ 같은 자리에서 «다른 얼굴»도 나왔다 — 정규식 리터럴의 백슬래시가 «먹혀»
 *      `/var(s*…)/` 라는 «문법상 유효한 다른 정규식»이 되어 «조용한 0» 을 냈다.
 *
 * 🔑 ⇒ 그래서 이 시험은 「고쳤다」가 아니라 ***「이 계급이 다시 나면 «즉시» 문다」***를 맡는다.
 * ⛔ 그리고 «전수»다 — 새 표현식을 더하면 아래 목록에 줄을 «반드시» 더한다.
 */
import { describe, expect, test } from 'bun:test';

import { buildExtractionExpression } from './computed-tokens.js';
import { buildKeyframesExpression } from './keyframes.js';
import { buildLayoutExpression } from './layout-tokens.js';
import { buildStateMotionExpression } from './state-motion.js';

const EXPRESSIONS: ReadonlyArray<{ name: string; build: () => string }> = [
  { name: 'computed-tokens', build: buildExtractionExpression },
  { name: 'keyframes', build: buildKeyframesExpression },
  { name: 'layout-tokens', build: buildLayoutExpression },
  { name: 'state-motion', build: buildStateMotionExpression },
];

describe('⛔ 페이지 표현식은 «문법적으로 성립»해야 한다', () => {
  test('세는 대상이 비어 있지 않다 (분모 확인)', () => {
    expect(EXPRESSIONS.length).toBeGreaterThanOrEqual(4);
  });

  for (const { name, build } of EXPRESSIONS) {
    test(`${name} — 브라우저가 «파싱할 수 있다»`, () => {
      const expr = build();
      expect(expr.length).toBeGreaterThan(50);
      // ⛔ 실행하지 않는다 — 파싱만 본다(document·window 가 여기 없다).
      //    백틱이 리터럴을 끊었거나 괄호가 안 맞으면 여기서 «즉시» 던진다.
      expect(() => new Function(`return (${expr});`)).not.toThrow();
    });

    test(`${name} — 산출을 «JSON 으로» 낸다 (이 저장소의 같은 계약)`, () => {
      expect(build()).toContain('JSON.stringify');
    });
  }

  // ⛔⭐ 여기에 「정규식 리터럴을 날것으로 두지 않는다」 시험을 «썼다가 지웠다».
  //    그 판정이 `Array.isArray(...)` 로 끝나 ***어떤 입력에도 참***이었다 —
  //    오늘 하루 종일 기록한 그 계급(「참인데 아무 말도 안 하는 수」)을 시험 안에서 만든 것이다.
  //    ⛔ 「없는 것보다 낫다」가 아니다 — ***통과하는 시험은 「지켜지고 있다」고 «말한다».***
  // ✅ 그 축은 모듈마다 «구체적으로» 걸려 있다:
  //    state-motion 은 `new RegExp(` 를 담고 `/var\\(` 를 «안» 담는지 자기 시험이 문다.
  //    일반화는 규칙이 참인지부터 재고 나서 한다 — 지금 네 표현식 중 하나는 «제대로 이스케이프된»
  //    리터럴을 정당하게 쓰고 있어서, 「리터럴 금지」는 지금 «거짓»이다.
});
