/**
 * ua-default-leak.test.ts — ⛔ 위험한 축 셋:
 *    ⓐ 「기본값 모양」을 «기본값이다»로 단정하는 것
 *    ⓑ 본 것이 «없을» 때 「새는 곳 0」을 내는 것
 *    ⓒ 「관측」을 「경고」처럼 내는 것
 */
import { describe, expect, test } from 'bun:test';
import {
  judgeUaDefaultLeak, looksLikeUaMargin, renderUaDefaultLeak,
  EM_MARGIN_TAGS, UA_DEFAULT_BLIND_SPOTS, UA_EM_RATIOS,
  uaDefaultRungs, uaHeadingDefaultTag, UA_HEADING_FONT_RATIOS,
} from './ua-default-leak.js';

describe('looksLikeUaMargin', () => {
  test('🩸⭐ 실측 재현 — `figure` 15px @ 15px 글자 = 1em ⇒ 기본값 «모양»', () => {
    expect(looksLikeUaMargin(15, 15)).toBe(true);
  });
  test('0.5em(예: hr)도 잡는다', () => {
    expect(looksLikeUaMargin(6, 12)).toBe(true);
  });
  test('⛔ 눈금값(8px @ 15px 글자)은 «기본값 모양»이 아니다', () => {
    expect(looksLikeUaMargin(8, 15)).toBe(false);
  });
  test('⛔ 0 과 음수·비수는 «모양»이 아니다', () => {
    expect(looksLikeUaMargin(0, 15)).toBe(false);
    expect(looksLikeUaMargin(-8, 15)).toBe(false);
    expect(looksLikeUaMargin(15, 0)).toBe(false);
    expect(looksLikeUaMargin(Number.NaN, 15)).toBe(false);
  });
});

describe('judgeUaDefaultLeak', () => {
  test('⛔⭐ 본 것이 «하나도» 없으면 null — 「새는 곳 0」이 아니다', () => {
    expect(judgeUaDefaultLeak([])).toBeNull();
  });

  test('🩸⭐ 「모르는 태그」는 «버리지 않고» suspects 로 «갈라» 낸다 — 첫 판은 그것을 버려서 둘을 못 짚었다', () => {
    const r = judgeUaDefaultLeak([{ tag: 'span', count: 9, marginPx: 15, fontSizePx: 15 }])!;
    expect(r.leaked).toEqual([]);
    expect(r.suspects.map((x) => x.tag)).toEqual(['span']);
    expect(r.inspected).toBe(0);              // ⛔ 분모는 «아는 태그»만 센다
  });

  test('⛔ 문면이 suspects 를 «신뢰 낮음»이라고 말한다', () => {
    const line = renderUaDefaultLeak(judgeUaDefaultLeak([{ tag: 'span', count: 9, marginPx: 15, fontSizePx: 15 }]));
    expect(line).toContain('신뢰 낮음');
    expect(line).toContain('모르는 태그');
  });

  test('🩸 moksori 재현 — figure 5개가 «자리 10」으로 나온다', () => {
    const r = judgeUaDefaultLeak([{ tag: 'figure', count: 5, marginPx: 15, fontSizePx: 15 }])!;
    expect(r.leaked.map((l) => l.tag)).toEqual(['figure']);
    expect(r.leaked[0]!.emRatio).toBe(1);
    expect(r.leakedPlaces).toBe(10);           // ⭐ 위·아래 둘
  });

  test('껐으면 «안» 잡힌다 — 그것이 고침의 증거다', () => {
    const r = judgeUaDefaultLeak([{ tag: 'figure', count: 5, marginPx: 0, fontSizePx: 15 }])!;
    expect(r.leaked).toEqual([]);
    expect(r.inspected).toBe(1);               // ⛔ 분모는 남는다
  });

  test('⭐ 많이 쓰인 태그부터', () => {
    const r = judgeUaDefaultLeak([
      { tag: 'p', count: 12, marginPx: 15, fontSizePx: 15 },
      { tag: 'figure', count: 2, marginPx: 15, fontSizePx: 15 },
    ])!;
    expect(r.leaked.map((l) => l.tag)).toEqual(['p', 'figure']);
  });

  test('아는 태그 목록이 «비어 있지 않다»(분모 확인)', () => {
    expect(EM_MARGIN_TAGS.length).toBeGreaterThan(10);
    expect(EM_MARGIN_TAGS).toContain('figure');
  });
});

describe('renderUaDefaultLeak', () => {
  test('⛔ 「못 쟀음」을 «0» 으로 쓰지 않는다', () => {
    expect(renderUaDefaultLeak(null)).toContain('못 쟀다');
    expect(renderUaDefaultLeak(null)).not.toContain('✅');
  });
  test('⛔⭐ 「경고」가 아니라 «관측»이라고 «문면»이 말한다', () => {
    const line = renderUaDefaultLeak(judgeUaDefaultLeak([{ tag: 'figure', count: 5, marginPx: 15, fontSizePx: 15 }]));
    expect(line).toContain('관측');
    expect(line).toContain('의도일 수 있다');
    expect(line).not.toContain('⚠️ 기본값이');
  });
  test('사각이 「단정하지 않는다」를 «값으로» 담는다', () => {
    expect(UA_DEFAULT_BLIND_SPOTS.join(' ')).toContain('author-may-match');
    expect(UA_DEFAULT_BLIND_SPOTS.join(' ')).toContain('known-tags-split');
  });
});

// ── 🩸 전수에서 «13 중 열둘»이 걸렸다 — 「거의 전부」는 퇴화의 모양이다 ──────────
describe('선언된 눈금에 «있는» 값은 «뺀다»', () => {
  test('⛔⭐ `p 16px @ 16px` 는 「1em」이지만 ***눈금에 16 이 있으면*** 사람이 쓴 것으로 본다', () => {
    const r = judgeUaDefaultLeak([{ tag: 'p', count: 9, marginPx: 16, fontSizePx: 16 }], [8, 16, 24])!;
    expect(r.leaked).toEqual([]);
  });

  test('✅ 눈금에 «없는» 값은 그대로 남는다 — moksori 의 15px', () => {
    const r = judgeUaDefaultLeak([{ tag: 'figure', count: 10, marginPx: 15, fontSizePx: 15 }], [8, 16, 24, 48, 96])!;
    expect(r.leaked.map((l) => l.tag)).toEqual(['figure']);
  });

  test('⛔ 눈금을 «안 주면» 거르지 않는다 — 「못 거른다」를 「0」으로 만들지 않는다', () => {
    const r = judgeUaDefaultLeak([{ tag: 'p', count: 9, marginPx: 16, fontSizePx: 16 }])!;
    expect(r.leaked.map((l) => l.tag)).toEqual(['p']);
  });

  test('사각이 그 사실을 «값으로» 담는다', () => {
    expect(UA_DEFAULT_BLIND_SPOTS.join(' ')).toContain('ladder-filtered');
  });
});


// ⛔⭐⭐ 🩸 2026-09-13(🅕) — ***내가 「수렴」이라 읽으려던 것이 「둘 다 안 칠했다」였다.***
//    두 산출의 활자 사다리가 `[16, 18.72, 24, 32]` 로 «완전히 동일»했는데 ***4/4 가 UA 기본값***이었다.
describe('UA 제목 «글자 크기» 기본값 — ⛔ 마진 축과 «다른» 축', () => {
  test('⛔⭐ ***내가 「수렴」이라 읽을 뻔한 그 사다리가 4/4 기본값이다***', () => {
    const hits = uaDefaultRungs([16, 18.72, 24, 32]);
    expect(hits).toHaveLength(4);
    expect(hits.map((h) => h.tag)).toEqual(['h4', 'h3', 'h2', 'h1']);
  });

  test('⭐ 실제 «설계»한 값은 안 걸린다 — 늘 걸리는 자는 아무것도 안 가른다', () => {
    expect(uaDefaultRungs([46.8, 67.68, 12, 14])).toHaveLength(0);
  });

  test('h3 의 1.17em 이 담겨 있다 — ⛔ 이것이 마진 비율표에는 «없다»', () => {
    expect(UA_HEADING_FONT_RATIOS.h3).toBeCloseTo(1.17, 5);
    expect(UA_EM_RATIOS).not.toContain(1.17);
  });

  test('⛔ 밑동이 16px 이 아니면 값이 달라진다 — 「16px 가정」을 숨기지 않는다', () => {
    expect(uaHeadingDefaultTag(18.72, 16)).toBe('h3');
    expect(uaHeadingDefaultTag(18.72, 20)).toBeNull();
    expect(uaHeadingDefaultTag(23.4, 20)).toBe('h3');
  });

  test('⛔ 못 읽는 값은 null — 지어내지 않는다', () => {
    expect(uaHeadingDefaultTag(Number.NaN)).toBeNull();
    expect(uaHeadingDefaultTag(24, 0)).toBeNull();
  });
});
