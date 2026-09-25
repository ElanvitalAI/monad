/**
 * affordances.test.ts — L1 수집기의 «파싱 계약»과 «사각 고지».
 * ⛔ 표현식이 «브라우저에서» 무엇을 집는지는 여기서 못 답한다 — 그건 실물 실행의 몫이다.
 *    여기가 무는 것은 ⓐ 실패를 「0건」으로 삼키지 않는가 ⓑ 사각을 «값으로» 싣는가 뿐이다.
 */
import { describe, expect, test } from 'bun:test';

import {
  AFFORDANCE_BLIND_SPOTS,
  buildAffordanceExpression,
  formatAffordances,
  parseAffordances,
} from './affordances.js';

const RAW = JSON.stringify({
  url: 'https://x.test/signup',
  forms: [{
    action: '/api/signup',
    method: 'post',
    fields: [
      { tag: 'input', type: 'email', name: 'email', required: true, pattern: null, min: null, max: null, maxLength: 120, placeholder: null, label: '메일' },
      { tag: 'input', type: 'number', name: 'age', required: false, pattern: null, min: '18', max: '120', maxLength: null, placeholder: null, label: null },
    ],
  }],
  controls: [{ tag: 'button', type: 'submit', text: '가입', ariaLabel: null }],
  links: [{ href: 'https://x.test/tos', text: '약관', sameOrigin: true }, { href: 'https://other.test/', text: '밖', sameOrigin: false }],
  dataAttributes: ['data-testid'],
  ariaRoles: ['button'],
});

describe('⛔ 실패를 「0건」으로 «삼키지 않는다»', () => {
  test('JSON 이 아니면 null 을 낸다 — 빈 결과가 아니다', () => {
    expect(parseAffordances('not json')).toBeNull();
  });

  test('문자열이 아니면 null 을 낸다 (CDP 가 객체를 돌려줬을 때)', () => {
    expect(parseAffordances({ url: 'x' })).toBeNull();
    expect(parseAffordances(undefined)).toBeNull();
  });

  test('url 이 없으면 null 이다 — 「페이지를 봤다」고 말할 근거가 없다', () => {
    expect(parseAffordances(JSON.stringify({ forms: [] }))).toBeNull();
  });

  test('배열이어야 할 칸이 아니면 «빈 배열»로 두되 결과는 낸다', () => {
    const r = parseAffordances(JSON.stringify({ url: 'https://x.test/', forms: 'nope' }));
    expect(r).not.toBeNull();
    expect(r!.forms).toEqual([]);
  });
});

describe('⭐ 사각을 «값으로» 싣는다', () => {
  test('결과에 blindSpots 가 «항상» 붙는다', () => {
    expect(parseAffordances(RAW)!.blindSpots).toEqual([...AFFORDANCE_BLIND_SPOTS]);
  });

  test('사각 목록이 «클릭 뒤에 생기는 것」과 「서버 규칙」을 명시한다', () => {
    const all = AFFORDANCE_BLIND_SPOTS.join(' ');
    expect(all).toContain('after-interaction');
    expect(all).toContain('server-validation');
  });

  test('폼이 0개면 사람 산출이 ⚪ 로 «경고»한다 — 「폼이 없다」로 못 읽게', () => {
    const r = parseAffordances(JSON.stringify({ url: 'https://x.test/', forms: [], controls: [], links: [] }))!;
    expect(formatAffordances(r).join('\n')).toContain('「폼이 없다」가 아닐 수 있다');
  });
});

describe('사람 산출 — 규칙이 «보인다»', () => {
  test('필수·경계값이 줄에 적힌다', () => {
    const text = formatAffordances(parseAffordances(RAW)!).join('\n');
    expect(text).toContain('form POST /api/signup');
    expect(text).toContain('required');
    expect(text).toContain('min=18');
    expect(text).toContain('max=120');
    expect(text).toContain('maxLength=120');
  });

  test('같은 출처 링크를 «따로» 센다', () => {
    expect(formatAffordances(parseAffordances(RAW)!).join('\n')).toContain('링크 2개(같은 출처 1)');
  });

  test('필수 입력칸 수를 «센다»', () => {
    expect(formatAffordances(parseAffordances(RAW)!).join('\n')).toContain('입력칸 2개(필수 1)');
  });
});

describe('표현식', () => {
  test('JSON 문자열을 «반환»한다 — 깊은 객체를 CDP 로 넘기지 않는다', () => {
    expect(buildAffordanceExpression()).toContain('JSON.stringify');
  });

  test('상한이 표현식에 «박힌다» — 거대 페이지에서 안 터진다', () => {
    expect(buildAffordanceExpression({ links: 7, controls: 9 })).toContain('.slice(0, 7)');
    expect(buildAffordanceExpression({ links: 7, controls: 9 })).toContain('.slice(0, 9)');
  });

  test('폼 «밖»의 입력칸도 모은다 (요즘 SPA 는 form 을 안 쓴다)', () => {
    expect(buildAffordanceExpression()).toContain('orphanFields');
  });
});
