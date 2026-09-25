import { describe, expect, test } from 'bun:test';

import { buildExtractionExpression, parseExtraction } from './computed-tokens.js';

type Transition = {
  duration: string; easing: string; property: string; color?: string; backgroundColor?: string;
  /** ⭐ 「글자를 «안» 담은 요소」 — `<html>`·`<head>`·`<script>` 따위를 흉내 낸다 */
  textless?: boolean;
};

function runExpression(elements: Transition[] | 'throw') {
  const style = (transition?: Transition) => ({
    length: 0,
    getPropertyValue: () => '',
    transitionDuration: transition?.duration ?? '0s',
    transitionTimingFunction: transition?.easing ?? 'ease',
    transitionProperty: transition?.property ?? 'all',
    color: transition?.color ?? 'rgb(0, 0, 0)',
    backgroundColor: transition?.backgroundColor ?? 'transparent',
    display: 'block',
    visibility: 'visible',
    contentVisibility: 'visible',
    opacity: '1',
  });
  const document = {
    documentElement: {},
    querySelector: () => null,
    // ⭐ 실제 요소는 «글자를 담는다» — 2026-09-11 부터 색 수집이 그것을 «필터»로 쓴다.
    //    ⛔ 목에 `childNodes` 가 없으면 그 필터가 «전부 거르고», 그것은 「회귀」가 아니라 «목의 결손»이다.
    querySelectorAll: (selector: string) => elements === 'throw' && selector === '*' ? (() => { throw new Error('scan failed'); })() : (elements === 'throw' ? [] : elements.map((el, index) => ({
      index,
      childNodes: el.textless === true ? [] : [{ nodeType: 3, nodeValue: 'x' }],
      getBoundingClientRect: () => ({ width: 1, height: 1, x: 0, y: 0 }),
    }))),
    styleSheets: [],
  };
  const getComputedStyle = (element: { index?: number }) => style(elements === 'throw' || element.index === undefined ? undefined : elements[element.index]);
  const expression = buildExtractionExpression();
  return new Function('document', 'getComputedStyle', 'location', 'innerWidth', 'innerHeight', 'matchMedia', `return ${expression}`)(
    document, getComputedStyle, { href: 'https://example.invalid/' }, 1280, 900, () => ({ matches: false }),
  );
}

describe('buildExtractionExpression — ⛔ 이 문자열은 브라우저가 «그대로» 실행한다', () => {
  const expr = buildExtractionExpression();

  test('TS 전용 문법이 «없다»', () => {
    expect(expr).not.toMatch(/\bas\s+(any|unknown|string|number|boolean)\b/);
    expect(expr).not.toMatch(/:\s*(Record|Array|readonly)\s*</);
    expect(expr).not.toContain('satisfies ');
  });

  test('⭐ 실제로 «파싱된다» — 문법 검사를 흉내 내지 않고 엔진에 맡긴다', () => {
    expect(() => new Function(`return ${expr}`)).not.toThrow();
  });

  test('두 축을 «둘 다» 낸다 — 한 이름이 둘을 덮고 있었다', () => {
    expect(expr).toContain('browserForcedReducedMotion');
    expect(expr).toContain('honoursReducedMotion');
  });

  test('실제 painted 배경과 글자를 독립 빈도순으로 세고 완전 투명을 분모에서 뺀다', () => {
    const tokens = parseExtraction(runExpression([
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(4, 5, 6)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(255, 0, 0)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(0, 0, 0)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'color(srgb 1 0 0 / 0)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(7, 8, 9)', backgroundColor: 'oklch(50% 0.1 30 / 0%)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(7, 8, 9)', backgroundColor: 'color(srgb 1 0 0 / 0.5)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(7, 8, 9)', backgroundColor: 'rgb(4, 5, 6)' },
    ]));
    expect(tokens?.paintedColors).toEqual({
      backgrounds: [
        { value: 'rgb(4, 5, 6)', count: 2 },
        { value: 'color(srgb 1 0 0 / 0.5)', count: 1 },
        { value: 'rgb(0, 0, 0)', count: 1 },
        { value: 'rgb(255, 0, 0)', count: 1 },
      ],
      text: [{ value: 'rgb(1, 2, 3)', count: 5 }, { value: 'rgb(7, 8, 9)', count: 3 }],
      // ⭐ 획 모집단이 «생겼다». 이 가짜 DOM 은 테두리를 안 그리므로 «빈 배열»이 맞다 —
      //    ⛔ 「없음(undefined)」과 «다른» 값이다(안 쟀다 ↔ 쟀는데 0).
      strokes: [],
      // ⭐ 국소 바탕 칸도 «생겼다». 이 가짜 DOM 은 조상을 못 걸으므로 «빈 배열»이 맞다 —
      //    ⛔ 「없음(undefined)」과 다른 값이다(안 쟀다 ↔ 걸었는데 못 찾았다).
      alphaOver: [],
    });
  });

  test('역할마다 모든 후보를 훑고 렌더링-가시 후보의 선택 관측을 반환한다', () => {
    const candidates = [
      { id: 'hidden', getBoundingClientRect: () => ({ width: 8, height: 8, x: 0, y: 0 }) },
      { id: 'visible', getBoundingClientRect: () => ({ width: 12, height: 7, x: 2, y: 3 }) },
    ];
    const document = {
      documentElement: {},
      querySelectorAll: (selector: string) => selector === '.role' ? candidates : [],
      styleSheets: [],
    };
    const getComputedStyle = (element: { id?: string }) => ({
      length: 0,
      getPropertyValue: (property: string) => property === 'color' && element.id === 'visible' ? ' rgb(1, 2, 3) ' : '',
      transitionDuration: '0s', transitionTimingFunction: 'ease', transitionProperty: 'none',
      display: 'block', visibility: element.id === 'hidden' ? 'hidden' : 'visible', contentVisibility: 'visible', opacity: '1',
    });
    const expression = buildExtractionExpression([['role', '.role']], ['color']);
    const raw = new Function('document', 'getComputedStyle', 'location', 'innerWidth', 'innerHeight', 'matchMedia', `return ${expression}`)(
      document, getComputedStyle, { href: 'https://example.invalid/' }, 1280, 900, () => ({ matches: false }),
    );
    expect(parseExtraction(raw)).toMatchObject({
      roles: { role: { color: 'rgb(1, 2, 3)', __box: { w: 12, h: 7, x: 2, y: 3 } } },
      diagnostics: { role: { matched: 2, visible: 1, selected: 1 } },
      missing: [],
    });
  });

  test('진단 계약이 없거나 후보 수와 모순되면 외부 결과를 거부한다', () => {
    const transitions = { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: '기본 상태만 측정' };
    const raw = (diagnostics: unknown) => JSON.stringify({ url: 'https://example.invalid/', viewport: { w: 1, h: 1 }, transitions, diagnostics });
    expect(parseExtraction(raw(undefined))).toBeNull();
    expect(parseExtraction(raw({ role: { matched: 1, visible: 2, selected: 0 } }))).toBeNull();
    expect(parseExtraction(raw({ role: { matched: 1, visible: 0, selected: 0 } }))).toBeNull();
    expect(parseExtraction(raw({ role: { matched: 1, visible: 1, selected: 1 } }))).toBeNull();
  });

  test('주입 이음매: 여러 전환을 요소 빈도순으로 측정한다', () => {
    const tokens = parseExtraction(runExpression([
      { duration: '0.5s, 0.25s', easing: 'ease, linear', property: 'color, opacity' },
      { duration: '0.5s', easing: 'ease', property: 'color' },
      { duration: '0s', easing: 'ease', property: 'transform' },
    ]));
    expect(tokens?.transitions).toEqual({
      status: 'measured', elementCount: 2,
      durations: [{ value: '0.5s', count: 2 }, { value: '0.25s', count: 1 }],
      easings: [{ value: 'ease', count: 2 }, { value: 'linear', count: 1 }],
      properties: [{ value: 'color', count: 2 }, { value: 'opacity', count: 1 }],
      limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음',
    });
  });

  test('주입 이음매: transition-property 길이에 맞춰 짧은 duration/easing 목록을 반복한다', () => {
    const tokens = parseExtraction(runExpression([
      { duration: '0.5s', easing: 'cubic-bezier(0.2, 0, 0, 1)', property: 'color, opacity' },
      { duration: '0.25s, 1s', easing: 'steps(4, end), linear', property: 'transform' },
    ]));
    expect(tokens?.transitions).toEqual({
      status: 'measured', elementCount: 2,
      durations: [{ value: '0.25s', count: 1 }, { value: '0.5s', count: 1 }],
      easings: [{ value: 'cubic-bezier(0.2, 0, 0, 1)', count: 1 }, { value: 'steps(4, end)', count: 1 }],
      properties: [{ value: 'color', count: 1 }, { value: 'opacity', count: 1 }, { value: 'transform', count: 1 }],
      limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음',
    });
  });

  test('주입 이음매: property 목록에 대응하지 않는 duration은 세지 않는다', () => {
    expect(parseExtraction(runExpression([
      { duration: '0s, 1s', easing: 'ease, linear', property: 'color' },
    ]))?.transitions).toMatchObject({ status: 'none', elementCount: 0 });
  });

  test('주입 이음매: 요소를 훑었고 전환이 없으면 none이다', () => {
    expect(parseExtraction(runExpression([]))?.transitions).toMatchObject({ status: 'none', elementCount: 0 });
  });

  test('주입 이음매: 요소를 못 훑으면 none이 아닌 unreadable이다', () => {
    expect(parseExtraction(runExpression('throw'))?.transitions).toEqual({
      status: 'unreadable', limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음',
    });
  });

  test('외부 전환 JSON의 상태·빈도 모순을 거부한다', () => {
    const transition = { elementCount: 1, durations: [{ value: '0.5s', count: 1 }], easings: [{ value: 'ease', count: 1 }], properties: [{ value: 'color', count: 1 }], limitation: '기본 상태만 측정' };
    const raw = (transitions: object) => JSON.stringify({ url: 'https://example.invalid/', viewport: { w: 1, h: 1 }, transitions, diagnostics: {} });
    expect(parseExtraction(raw({ ...transition, status: 'measured', elementCount: 0 }))).toBeNull();
    expect(parseExtraction(raw({ ...transition, status: 'none' }))).toBeNull();
    expect(parseExtraction(raw({ ...transition, status: 'measured', durations: [{ value: '0.5s', count: 0.5 }] }))).toBeNull();
    expect(parseExtraction(raw({ ...transition, status: 'measured', properties: [{ value: 'color', count: -1 }] }))).toBeNull();
  });
});

describe('⛔⭐ 획(테두리·아웃라인)을 파서가 «버리지» 않는다', () => {
  // 🩸 2026-09-10: 수집·타입·소비를 다 이었는데 «파서 한 줄»이 안 이어져
  //    산출이 계속 「⚪획 못 쟀음」이었다. 「있다」와 「닿는다」는 다른 값이다.
  const realPayload = () => runExpression([
    { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(4, 5, 6)' },
  ]);
  const withStrokes = (strokes: unknown) => {
    const o = JSON.parse(realPayload() as string) as Record<string, unknown>;
    const pc = o.paintedColors as Record<string, unknown>;
    if (strokes === undefined) delete pc.strokes; else pc.strokes = strokes;
    return JSON.stringify(o);
  };

  test('있으면 «받는다»', () => {
    const r = parseExtraction(withStrokes([{ value: 'rgb(212, 180, 119)', count: 2 }]))!;
    expect(r.paintedColors?.strokes).toEqual([{ value: 'rgb(212, 180, 119)', count: 2 }]);
  });

  test('⛔ 그 칸이 «없는» 옛 산출도 던지지 않는다 — undefined 다(0 이 아니다)', () => {
    const r = parseExtraction(withStrokes(undefined))!;
    expect(r.paintedColors).not.toBeNull();
    expect(r.paintedColors?.strokes).toBeUndefined();
  });

  test('⛔ 모양이 틀리면 «지어내지» 않는다 — undefined 로 두고, 배경·글자는 «안 버린다»', () => {
    const r = parseExtraction(withStrokes([{ value: 1, count: 'x' }]))!;
    expect(r.paintedColors?.strokes).toBeUndefined();
    expect((r.paintedColors?.backgrounds.length ?? 0)).toBeGreaterThan(0);
  });
});

describe('⛔⭐ 알파색이 «무엇 위에» 놓였나 — RESULT-27 의 ⚪ 칸', () => {
  // 🩸 지금까지 알파를 «페이지 바탕 하나» 위에만 폈다.
  //    카드(흰색) 위의 rgba 와 페이지(아이보리) 위의 rgba 는 «다른 색»인데 같게 읽혔다.
  const base = () => JSON.parse(runExpression([
    { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(4, 5, 6)' },
  ]) as string) as Record<string, unknown>;
  const withOver = (over: unknown) => {
    const o = base();
    const pc = o.paintedColors as Record<string, unknown>;
    if (over === undefined) delete pc.alphaOver; else pc.alphaOver = over;
    return JSON.stringify(o);
  };

  test('바탕«들»을 목록으로 받는다 — ⛔ 하나를 조용히 고르지 않는다', () => {
    const r = parseExtraction(withOver([{
      value: 'rgba(0, 0, 0, 0.06)',
      grounds: [{ value: 'rgb(255, 255, 255)', count: 9 }, { value: 'rgb(255, 253, 245)', count: 2 }],
    }]))!;
    expect(r.paintedColors?.alphaOver?.[0]?.grounds.length).toBe(2);
    expect(r.paintedColors?.alphaOver?.[0]?.grounds[0]?.value).toBe('rgb(255, 255, 255)');
  });

  test('⛔ 그 칸이 «없는» 옛 산출도 던지지 않는다 — undefined 다', () => {
    const r = parseExtraction(withOver(undefined))!;
    expect(r.paintedColors).not.toBeNull();
    expect(r.paintedColors?.alphaOver).toBeUndefined();
  });

  test('⛔ 모양이 틀리면 «지어내지» 않는다 — undefined 로 두고 배경·글자는 «안 버린다»', () => {
    const r = parseExtraction(withOver([{ value: 1, grounds: 'x' }]))!;
    expect(r.paintedColors?.alphaOver).toBeUndefined();
    expect((r.paintedColors?.backgrounds.length ?? 0)).toBeGreaterThan(0);
  });
});

// ⛔⭐⭐ 🩸 2026-09-11 — ***색 수집이 「글자를 안 담은 요소」의 색을 「칠했다」로 셌다.***
//    📏 실측: 자작 13개 중 11개가 `rgb(0,0,0)` 을 «정확히 14회» 냈고,
//    그 14 는 ***`<html>` ⊕ `<head>` ⊕ head 안 12개***였다 — 화면에 글자를 «하나도» 안 낸다.
//    ⇒ conform 의 「칠했다」와 `token-adherence` 의 「토큰 밖」이 «둘 다» 오염됐다.
describe('칠한 색 모집단 — 「보이고 ⊕ 글자를 담은」 요소만', () => {
  const textOf = (elements: Transition[]) => {
    const parsed = parseExtraction(runExpression(elements));
    return (parsed?.paintedColors?.text ?? []).map((e) => e.value);
  };

  test('⭐ 글자를 «안» 담은 요소의 색은 «안» 센다 — html·head·script 가 그렇다', () => {
    expect(textOf([
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(0, 0, 0)', textless: true },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(17, 17, 17)' },
    ])).toEqual(['rgb(17, 17, 17)']);
  });

  test('⛔ 「글자를 안 담았다」가 «전부»면 빈 목록이다 — 조용히 기본색을 채우지 않는다', () => {
    expect(textOf([
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(0, 0, 0)', textless: true },
    ])).toEqual([]);
  });

  test('글자를 담은 요소는 «그대로» 센다 — 이 필터가 정상 색을 버리지 않는다', () => {
    expect(textOf([
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)' },
      { duration: '0s', easing: 'ease', property: 'none', color: 'rgb(1, 2, 3)' },
    ])).toEqual(['rgb(1, 2, 3)']);
  });

  test('⛔ 배경도 같은 가시성 관문을 지난다 — 안 보이는 요소의 배경은 «안 칠해진다»', () => {
    // 글자가 없어도 배경은 칠해진다 — 그래서 `textless` 여도 배경은 센다.
    const parsed = parseExtraction(runExpression([
      { duration: '0s', easing: 'ease', property: 'none', backgroundColor: 'rgb(9, 9, 9)', textless: true },
    ]));
    expect((parsed?.paintedColors?.backgrounds ?? []).map((e) => e.value)).toEqual(['rgb(9, 9, 9)']);
  });
})

// ⛔⭐ 🩸 2026-09-11 — ***`chosenShare` 라는 이름이 «개수»를 담고 있었고, 그 이름이 나를 틀리게 했다.***
//    📏 실측: `vis>0` 인 137개가 «전부 1» — 퇴화 검사 ⓐ(항상 같은 값)에 걸린다.
//    ⇒ `site-health` 가 그것을 «비율»로 읽어 한 축이 152 표본에서 «0건»이 됐다.
describe('chosenCount — 이름이 «담긴 것»과 맞는다', () => {
  test('⛔ 옛 산출의 `chosenShare` 를 «던지지 않는다» — 같은 뜻으로 옮긴다', () => {
    const raw = JSON.stringify({
      url: 'https://example.invalid/', viewport: { w: 1, h: 1 },
      transitions: { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: 'x' },
      diagnostics: { h1: { matched: 5, visible: 4, selected: 0, styleGroups: 3, chosenShare: 1 } },
    });
    expect(parseExtraction(raw)?.diagnostics.h1?.chosenCount).toBe(1);
  });

  test('새 이름도 그대로 받는다', () => {
    const raw = JSON.stringify({
      url: 'https://example.invalid/', viewport: { w: 1, h: 1 },
      transitions: { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: 'x' },
      diagnostics: { h1: { matched: 5, visible: 4, selected: 0, chosenCount: 2 } },
    });
    expect(parseExtraction(raw)?.diagnostics.h1?.chosenCount).toBe(2);
  });

  test('⛔ «비율»이 아님을 못 박는다 — 정수가 아니면 «안 받는다»', () => {
    const raw = JSON.stringify({
      url: 'https://example.invalid/', viewport: { w: 1, h: 1 },
      transitions: { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: 'x' },
      diagnostics: { h1: { matched: 5, visible: 4, selected: 0, chosenCount: 0.25 } },
    });
    expect(parseExtraction(raw)?.diagnostics.h1?.chosenCount).toBeUndefined();
  });
})
