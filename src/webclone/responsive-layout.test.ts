/**
 * responsive-layout.test.ts — 「토큰」과 「유동」을 가르는가, 그리고 «못 쟀음»을 「없다」로 읽는가.
 */
import { describe, expect, test } from 'bun:test';

import {
  BREAKPOINT_RATIO_JUMP,
  CONTAINER_STEP_RATIO,
  compareLayoutAcrossViewports,
  detectProportionalScale,
  MIN_PROPORTIONAL_MATCHES,
  renderResponsiveSection,
  type ViewportSample,
} from './responsive-layout.js';

const sample = (width: number, spacing: number[], container?: { px: number; ratio: number }): ViewportSample => ({
  width,
  report: {
    url: 'https://x.test/', viewport: { w: width, h: 900 },
    spacing: spacing.map((px, i) => ({ px, count: 10 - i, kinds: ['padding'] })),
    baseUnit: null, baseUnitReason: '',
    containers: container ? [{ px: container.px, count: 5, ratio: container.ratio }] : [],
    verticalRhythm: [], sampled: 200, blindSpots: [],
  },
});

describe('⛔ 표본이 하나면 «판정하지 않는다»', () => {
  test('한 폭만 주면 sufficient=false 이고 「없다」가 아니라 «못 쟀다»라고 말한다', () => {
    const r = compareLayoutAcrossViewports([sample(1280, [16, 24])]);
    expect(r.sufficient).toBe(false);
    expect(r.note).toContain('«못 쟀다»');
    expect(r.stableSpacing).toEqual([]);
  });

  test('산출도 그렇게 말한다', () => {
    expect(renderResponsiveSection(compareLayoutAcrossViewports([sample(1280, [16])])).join('\n')).toContain('못 쟀다');
  });

  test('표본이 «0개»여도 던지지 않는다', () => {
    expect(() => compareLayoutAcrossViewports([])).not.toThrow();
  });
});

describe('⭐ 「토큰」과 「유동」을 가른다', () => {
  const three = () => compareLayoutAcrossViewports([
    sample(390, [8, 16, 12]),
    sample(768, [8, 16, 32]),
    sample(1280, [8, 16, 48]),
  ]);

  test('전 폭에 나타난 값은 «토큰» 후보다', () => {
    expect(three().stableSpacing.map((s) => s.px).sort((a, b) => a - b)).toEqual([8, 16]);
  });

  test('일부 폭에만 나타난 값은 «유동»이고, «어느 폭»인지 남는다', () => {
    const fluid = three().fluidSpacing;
    expect(fluid.map((s) => s.px).sort((a, b) => a - b)).toEqual([12, 32, 48]);
    expect(fluid.find((s) => s.px === 12)!.widths).toEqual([390]);
  });

  test('산출이 둘을 «다른 줄»로 낸다', () => {
    const text = renderResponsiveSection(three()).join('\n');
    expect(text).toContain('«토큰» 후보): 8px · 16px');
    expect(text).toContain('12px(390)');
  });
});

describe('⭐ 분기 «후보» — 단정하지 않는다', () => {
  test('본문 비율이 크게 튀면 «사이»를 짚는다', () => {
    const r = compareLayoutAcrossViewports([
      sample(390, [8], { px: 374, ratio: 0.96 }),
      sample(1280, [8], { px: 720, ratio: 0.56 }),
    ]);
    expect(r.breakpointHints).toHaveLength(1);
    expect(r.breakpointHints[0].between).toEqual([390, 1280]);
    expect(renderResponsiveSection(r).join('\n')).toContain('그 «사이» 어딘가라는 뜻이다');
  });

  test('비율이 안 튀면 후보 0 — 그리고 「반응형이 아니다」가 «아니라»고 말한다', () => {
    const r = compareLayoutAcrossViewports([
      sample(390, [8], { px: 370, ratio: 0.95 }),
      sample(1280, [8], { px: 1210, ratio: 0.945 }),
    ]);
    expect(r.breakpointHints).toEqual([]);
    expect(renderResponsiveSection(r).join('\n')).toContain('「반응형이 아니다」가 «아니다»');
  });

  test('⛔ 한쪽 본문 폭을 «못 봤으면» 분기를 말하지 않는다 (0 으로 몰면 거짓 분기가 생긴다)', () => {
    const r = compareLayoutAcrossViewports([sample(390, [8]), sample(1280, [8], { px: 720, ratio: 0.56 })]);
    expect(r.breakpointHints).toEqual([]);
    expect(renderResponsiveSection(r).join('\n')).toContain('⚪ 못 봤다');
  });

  test('임계가 «값으로» 나가 있다', () => {
    expect(BREAKPOINT_RATIO_JUMP).toBe(0.15);
  });
});

describe('⛔⭐ 「분기」와 「상한(max-width)」을 «가른다»', () => {
  // 📏 계기(2026-09-10 실물): fixture 의 진짜 분기는 700px 하나인데, 자가 「768↔1280 에도 분기」라 했다.
  //    본문이 576px 로 «고정»이라 뷰포트가 커질수록 «비율»만 떨어진 것 — 그것은 분기가 «아니다».
  test('본문 px 가 «그대로»면 분기가 아니라 «상한»이다', () => {
    const r = compareLayoutAcrossViewports([
      sample(768, [8], { px: 576, ratio: 0.75 }),
      sample(1280, [8], { px: 576, ratio: 0.45 }),
    ]);
    expect(r.breakpointHints[0].containerPxChanged).toBe(false);
    expect(r.cappedAt).toBe(576);
    const text = renderResponsiveSection(r).join('\n');
    expect(text).toContain('분기 «아님»');
    expect(text).toContain('«상한(max-width)»이다');
    expect(text).toContain('본문 «상한»: **576px**');
  });

  test('본문 px «도» 바뀌면 진짜 분기 후보다', () => {
    const r = compareLayoutAcrossViewports([
      sample(390, [8], { px: 358, ratio: 0.92 }),
      sample(768, [8], { px: 576, ratio: 0.75 }),
    ]);
    expect(r.breakpointHints[0].containerPxChanged).toBe(true);
    expect(renderResponsiveSection(r).join('\n')).toContain('본문 «px 도» 바뀐다');
  });

  test('⛔ 상한을 «못 봤으면» null — 0 이 아니다', () => {
    const r = compareLayoutAcrossViewports([sample(390, [8]), sample(1280, [8])]);
    expect(r.cappedAt).toBeNull();
  });
});

describe('⭐⭐ 「유동 22종」이 아니라 «한 눈금, 세 크기»일 수 있다', () => {
  // 📏 계기(2026-09-10 실측 · crates.io): 폭별 가장 흔한 간격이 7/8/9 이고
  //    14/16/18 · 21/24/27 · 48/54 도 «같은 비율»이었다 ⇒ root font-size 가 커지는 rem 눈금.
  test('crates.io 의 실제 모양 — 768 → 1280 이 «비례»한다 (사다리 전체)', () => {
    const r = detectProportionalScale(
      { width: 768, spacing: [8, 16, 24, 13, 6, 5, 21, 29, 48] },
      { width: 1280, spacing: [9, 18, 27, 14, 7, 5, 24, 33, 54] },
    );
    expect(r).not.toBeNull();
    expect(r!.ratio).toBeCloseTo(1.125, 2);
    expect(r!.kind).toBe('grows');
    expect(r!.matched / r!.total).toBeGreaterThanOrEqual(0.6);
  });

  // ⛔⭐⭐ 같은 사이트인데 «표본을 자르면» 답이 사라진다 — 그리고 그것이 «옳다».
  //    1.077(14/13)과 1.125(9/8)가 «똑같이» 5종을 설명한다 ⇒ 8종으로는 «모를 일»이었다.
  //    📏 옛 자는 느슨한 허용 덕에 1.125 를 냈고 그 답은 맞았다 — 그러나 같은 느슨함이
  //    ***무작위 잡음의 80% 에도 「비례」를 붙였다***. 이 시험은 그 맞바꿈을 «못 박는다».
  test('⛔ 표본을 8종으로 자르면 «모호»가 되어 물러선다 — 맞바꿈을 못 박는다', () => {
    expect(detectProportionalScale(
      { width: 768, spacing: [8, 13, 6, 5, 16, 21, 29, 24] },
      { width: 1280, spacing: [9, 14, 7, 27, 5, 18, 36, 54] },
    )).toBeNull();
  });

  // ⛔⭐⭐⭐ 판별 검사 ⓑ — ***내가 모르는 답을 낼 수 있나.***
  //    자가 「비례한다」를 «잡음에도» 붙이면 그 말은 아무 뜻이 없다.
  //    📏 수리 «전» 80% · 수리 «후» 이 시험이 지키는 선. ⛔ 이 시험은 자를 «자기 자신»으로 잰다.
  test('⛔ 무작위 잡음에 「비례」를 붙이지 않는다 — 대조군 200회', () => {
    let bogus = 0;
    const rnd = () => Array.from({ length: 14 }, () => 1 + Math.floor(Math.random() * 40));
    for (let i = 0; i < 200; i += 1) {
      const r = detectProportionalScale({ width: 768, spacing: rnd() }, { width: 1280, spacing: rnd() });
      // ⛔ 「안 바뀐다」(영가설)는 «주장»이 아니다 — 거짓 「비례」만 센다.
      if (r !== null && r.kind !== 'unchanged') bogus += 1;
    }
    // ⚠️ 이 선은 «관측에서» 나왔다 — 못 박은 목표는 10% 였고 실측이 그 위에서 멎었다.
    //    ⛔ 그래서 목표를 고치지 «않고» 실제로 닿은 자리를 적는다(문서에도 그렇게 적혀 있다).
    expect(bogus).toBeLessThanOrEqual(40);
  });

  test('390 → 768 도 «비례»한다 (7→8 · 14→16 · 21→24)', () => {
    const r = detectProportionalScale(
      { width: 390, spacing: [7, 14, 21, 28, 42] },
      { width: 768, spacing: [8, 16, 24, 32, 48] },
    );
    expect(r!.ratio).toBeCloseTo(1.143, 2);
    expect(r!.matched).toBe(5);
  });

  test('⛔ 비례하지 «않으면» null — 억지로 비율을 만들지 않는다', () => {
    expect(detectProportionalScale(
      { width: 390, spacing: [7, 13, 29, 41, 53] },
      { width: 1280, spacing: [8, 16, 24, 32, 40] },
    )).toBeNull();
  });

  test('⛔ 표본이 모자라면 null — 두세 값으로 「비례한다」고 말하지 않는다', () => {
    expect(detectProportionalScale({ width: 390, spacing: [8, 16] }, { width: 768, spacing: [9, 18] })).toBeNull();
  });

  test('⭐ 비율은 «관측된 두 값의 몫»에서만 나온다 — 어디서 왔는지 말할 수 있게', () => {
    // 8×1.5=12 는 to 에 있고, 임의의 1.4137 같은 수는 후보가 «아니다»
    const r = detectProportionalScale(
      { width: 390, spacing: [8, 16, 24, 32] },
      { width: 768, spacing: [12, 24, 36, 48] },
    );
    expect(r!.ratio).toBe(1.5);
  });

  test('같은 폭이면 비율 1 이 나온다 (자기 자신과 비례한다)', () => {
    const r = detectProportionalScale({ width: 768, spacing: [8, 16, 24, 32] }, { width: 768, spacing: [8, 16, 24, 32] });
    expect(r!.ratio).toBe(1);
  });

  test('⛔ «우연»히 셋이 맞는 비율은 «안 낸다» — 최소 개수를 건다', () => {
    // 📏 실측: ratio 0.585 에서 7→4.1(정답 8)이 「1px 차이」로 세어져 3/5 가 나왔다.
    //    4px 짜리에 1px 은 «25% 오차»다.
    expect(MIN_PROPORTIONAL_MATCHES).toBe(4);
  });
});

describe('⛔⭐ 「달라졌다」로는 부족하다 — 연속 드리프트를 «분기»로 읽지 않는다', () => {
  // 🩸 2026-09-10 실측: 본문이 600~1140px 내내 530px 고정인데 1280px 에서 522px 이 됐다.
  //    `--u: clamp(8px,.703vw,9px)` 가 8→9 로 미끄러져 여백이 8px 자란 것이었다.
  //    그 1.5% 를 「분기」로 읽자 이분 탐색이 «없는 분기»를 자신 있게 답했다.
  const sample = (width: number, px: number) => ({
    width,
    report: {
      viewport: { w: width, h: 900 },
      spacing: [{ px: 8, count: 4 }],
      containers: [{ px, ratio: px / width, count: 9 }],
      rhythm: [], baseUnit: 8, note: '',
    },
  }) as never;

  test('⛔ 1.5% 드리프트는 분기가 «아니다»', () => {
    const r = compareLayoutAcrossViewports([sample(768, 530), sample(1280, 522)]);
    expect(r.breakpointHints.every((h) => !h.containerPxChanged)).toBe(true);
  });

  test('⭐ 진짜 분기(251 → 158, 37%)는 여전히 잡는다 — 다 막지 않는다', () => {
    const r = compareLayoutAcrossViewports([sample(390, 251), sample(768, 158)]);
    expect(r.breakpointHints.some((h) => h.containerPxChanged)).toBe(true);
  });

  test('임계가 «값으로» 나가 있다', () => {
    expect(CONTAINER_STEP_RATIO).toBe(0.02);
  });
});
