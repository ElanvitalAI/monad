/**
 * flow-script.test.ts — L3 걸음 목록이 «규율을 형태로» 지키는가.
 * ⛔ 무는 것 셋: ⓐ 파싱 실패를 「걸음 0개」로 삼키는가 ⓑ 연타 금지가 «문장»뿐인가
 *              ⓒ 「못 찾은 셀렉터」를 「눌렀다」로 읽는가
 */
import { describe, expect, test } from 'bun:test';

import {
  buildClickExpression,
  buildTypeExpression,
  labelOf,
  MAX_STEPS,
  MIN_STEP_WAIT_MS,
  parseFlow,
  parseStepOutcome,
} from './flow-script.js';

describe('ⓐ 파싱 실패를 «걸음 0개»로 삼키지 않는다', () => {
  test('JSON 이 아니면 error 를 «값으로» 낸다', () => {
    const r = parseFlow('nope');
    expect(r.steps).toEqual([]);
    expect(r.error).toContain('JSON');
  });

  test('빈 배열은 «에러»다 — 조용히 0걸음으로 돌지 않는다', () => {
    expect(parseFlow('[]').error).toContain('걸음이 «0개»');
  });

  test('모르는 걸음이 하나라도 있으면 «그 자리»를 말하고 멈춘다', () => {
    const r = parseFlow('[{"kind":"navigate","url":"https://x.test/"},{"kind":"teleport"}]');
    expect(r.steps).toEqual([]);
    expect(r.error).toContain('걸음 1');
  });

  test('필드가 모자라면 통과시키지 않는다 (click 에 selector 없음)', () => {
    expect(parseFlow('[{"kind":"click"}]').error).toContain('걸음 0');
  });

  test('{ steps: [...] } 모양도 받는다', () => {
    expect(parseFlow('{"steps":[{"kind":"wait","ms":1000}]}').steps).toHaveLength(1);
  });
});

describe('ⓑ 연타 금지를 «형태»로 지킨다 (문장이 아니라)', () => {
  test('사람 속도보다 짧은 대기는 «올린다» — 그리고 «말한다»', () => {
    const r = parseFlow('[{"kind":"wait","ms":10}]');
    expect(r.steps[0]).toMatchObject({ kind: 'wait', ms: MIN_STEP_WAIT_MS });
    expect(r.adjustments[0]).toContain('사람 속도');
  });

  test('충분히 긴 대기는 «안 건드린다»', () => {
    expect(parseFlow('[{"kind":"wait","ms":5000}]').steps[0]).toMatchObject({ ms: 5000 });
    expect(parseFlow('[{"kind":"wait","ms":5000}]').adjustments).toEqual([]);
  });

  test('걸음 수 상한을 넘으면 «자르고 말한다» — 조용히 다 돌지 않는다', () => {
    const many = JSON.stringify(Array.from({ length: MAX_STEPS + 5 }, () => ({ kind: 'wait', ms: 1000 })));
    const r = parseFlow(many);
    expect(r.steps).toHaveLength(MAX_STEPS);
    expect(r.adjustments.join(' ')).toContain('연타 금지');
    expect(r.error).toBeNull();
  });
});

describe('ⓒ 「못 찾았다」를 «값으로» 돌려준다', () => {
  test('클릭 표현식이 found 를 «반환»한다 — 못 찾은 것을 「눌렀다」로 못 읽게', () => {
    expect(buildClickExpression('#go')).toContain('found: false');
    expect(buildClickExpression('#go')).toContain('JSON.stringify');
  });

  test('셀렉터를 «따옴표로 감싼다» — 따옴표 든 셀렉터가 표현식을 안 깬다', () => {
    expect(buildClickExpression('a[href="/x"]')).toContain(JSON.stringify('a[href="/x"]'));
  });

  test('입력 표현식은 input·change 를 «둘 다» 쏜다 (프레임워크가 안 듣는 것을 막는다)', () => {
    const e = buildTypeExpression('#q', 'serde');
    expect(e).toContain("new Event('input'");
    expect(e).toContain("new Event('change'");
  });

  test('결과 파싱 — found 가 없으면 null 이다 (참으로 안 읽는다)', () => {
    expect(parseStepOutcome(JSON.stringify({ found: true, tag: 'button' }))).toEqual({ found: true, tag: 'button', applied: null });
    expect(parseStepOutcome(JSON.stringify({ ok: 1 }))).toBeNull();
    expect(parseStepOutcome('not json')).toBeNull();
    expect(parseStepOutcome(undefined)).toBeNull();
  });
});

describe('걸음 이름', () => {
  test('이름을 안 주면 «무엇을 했는지»가 이름이 된다', () => {
    expect(labelOf({ kind: 'click', selector: '#go' }, 2)).toBe('2: click #go');
    expect(labelOf({ kind: 'navigate', url: 'https://x.test/' }, 0)).toBe('0: navigate https://x.test/');
  });

  test('준 이름이 이긴다', () => {
    expect(labelOf({ kind: 'wait', ms: 1000, label: '결과 기다림' }, 3)).toBe('결과 기다림');
  });
});


describe('⛔ 「찾았다」 ≠ 「입력됐다」 — React 제어 입력', () => {
  // 📏 2026-09-10 실측: 우리가 지은 화면을 «우리 도구»로 재다가 잡았다.
  //    자는 `찾음 <input>` 이라 했는데 그 뒤 클릭이 «요청 0건»을 냈다.
  //    React 는 값을 자기 트래커로 기억해서 프로퍼티를 직접 덮으면 onChange 를 안 흘린다.
  test('네이티브 setter 로 넣는다 — 프로퍼티를 직접 «덮지 않는다»', () => {
    const e = buildTypeExpression('#q', 'serde');
    expect(e).toContain("getOwnPropertyDescriptor");
    expect(e).toContain('setter.call(el, value)');
  });

  test('setter 가 «없는» 환경에서는 옛 길로 떨어진다 (조용히 안 죽는다)', () => {
    expect(buildTypeExpression('#q', 'x')).toContain('else el.value = value');
  });

  test('textarea 도 «자기» 프로토타입을 쓴다 (input 것으로 넣으면 안 먹는다)', () => {
    expect(buildTypeExpression('#q', 'x')).toContain('HTMLTextAreaElement.prototype');
  });

  test('⭐ 값이 «정말 들어갔는지» 읽어서 돌려준다 — 「했다」가 아니라 「됐다」', () => {
    expect(buildTypeExpression('#q', 'x')).toContain('applied: el.value === value');
  });

  test('applied=false 를 «값으로» 읽는다', () => {
    expect(parseStepOutcome(JSON.stringify({ found: true, tag: 'input', applied: false })))
      .toEqual({ found: true, tag: 'input', applied: false });
  });

  test('⚪ applied 가 «없는» 걸음(click·wait)은 null 이다 — 실패가 아니다', () => {
    expect(parseStepOutcome(JSON.stringify({ found: true, tag: 'button' }))?.applied).toBeNull();
  });
});
