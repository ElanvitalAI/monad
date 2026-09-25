/**
 * breakpoint-search.test.ts — ⛔ 「못 쟀을 때 반을 «버리는가»」가 가장 위험한 축이다.
 */
import { describe, expect, test } from 'bun:test';

import {
  BREAKPOINT_MAX_PROBES,
  BREAKPOINT_MIN_SPAN_PX,
  BREAKPOINT_RATIO_TOLERANCE,
  formatBreakpointRange,
  searchBreakpoint,
} from './breakpoint-search.js';

/**
 * 700px 에서 갈리는 «진짜» 페이지를 흉내 낸다.
 * ⭐ 아래쪽은 «유동»(max-width:100% — 폭을 따라 변한다) · 위쪽은 «상한 고정»(576px).
 * 🩸 첫 판의 시험은 아래쪽도 «고정 358» 로 뒀다 — 그래서 「px 동등」 비교의 결함을 «못 잡았다».
 */
const site = (breakAt = 700) => async (w: number) => (w < breakAt ? Math.round(w * 0.96) : 576);

describe('⭐ 「그 사이 어딘가」를 좁힌다', () => {
  test('390 ↔ 768 을 8px 구간까지 좁힌다', async () => {
    const r = (await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 768, containerPx: 576 }, site()))!;
    expect(r.spanPx).toBeLessThanOrEqual(BREAKPOINT_MIN_SPAN_PX);
    expect(r.low).toBeLessThan(700);
    expect(r.high).toBeGreaterThanOrEqual(700);
  });

  test('탐침 수가 상한을 «안 넘는다»', async () => {
    const r = (await searchBreakpoint({ width: 320, containerPx: 307 }, { width: 3840, containerPx: 576 }, site()))!;
    expect(r.probes).toBeLessThanOrEqual(BREAKPOINT_MAX_PROBES);
  });

  test('⛔ 마지막까지 「여기다」라고 «말하지 않는다»', async () => {
    const r = await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 768, containerPx: 576 }, site());
    expect(formatBreakpointRange(r, [390, 768]).join('\n')).toContain('«정확히» 여기다」가 아니다');
  });
});

describe('⛔ 못 쟀을 때 «반을 버리지» 않는다 (가장 위험한 축)', () => {
  test('중간을 못 재면 «기록하고 멈춘다»', async () => {
    const r = (await searchBreakpoint(
      { width: 390, containerPx: 374 },
      { width: 768, containerPx: 576 },
      async (w) => (w === 579 ? null : w < 700 ? Math.round(w * 0.96) : 576),
    ))!;
    expect(r.unmeasured).toContain(579);
    expect(r.spanPx).toBeGreaterThan(BREAKPOINT_MIN_SPAN_PX);   // 못 좁혔다 — 그것이 사실이다
  });

  test('못 잰 폭이 있으면 산출이 «구간이 넓을 수 있다»고 말한다', async () => {
    const r = await searchBreakpoint(
      { width: 390, containerPx: 374 },
      { width: 768, containerPx: 576 },
      async (w) => (w === 579 ? null : w < 700 ? Math.round(w * 0.96) : 576),
    );
    expect(formatBreakpointRange(r, [390, 768]).join('\n')).toContain('«실제보다 넓을» 수 있다');
  });
});

describe('⛔ 좁힐 것이 «없으면» 탐색하지 않는다', () => {
  test('두 끝의 «비율»이 같으면 null — px 가 달라도 «같은 규칙»(유동)이다', async () => {
    // 374/390 = 0.959 · 737/768 = 0.959  ⇒ 같은 규칙
    expect(await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 768, containerPx: 737 }, site())).toBeNull();
  });

  test('한쪽 폭을 «못 봤으면» null — 0 으로 몰지 않는다', async () => {
    expect(await searchBreakpoint({ width: 390, containerPx: null }, { width: 768, containerPx: 576 }, site())).toBeNull();
  });

  test('null 이면 산출이 «좁히지 못했다»고 말한다', () => {
    expect(formatBreakpointRange(null, [390, 768]).join('\n')).toContain('좁히지 «못했다»');
  });
});

describe('한 번도 «안 부르는» 경우', () => {
  test('이미 충분히 좁으면 탐침 0회', async () => {
    const r = (await searchBreakpoint({ width: 696, containerPx: 668 }, { width: 700, containerPx: 576 }, site()))!;
    expect(r.probes).toBe(0);
    expect(r.spanPx).toBe(4);
  });
});


describe('⛔⭐ 아래쪽이 «유동»이어도 좁혀진다 (첫 판이 틀린 자리)', () => {
  // 🩸 첫 판은 「본문 px 가 같은가」로 갈랐다. 분기 아래에서 max-width:100% 면
  //    px 가 폭을 따라 «연속적으로» 변해 동등이 영영 거짓 ⇒ 탐색이 아래 끝으로 수렴했다.
  //    📏 700px fixture 에서 「390↔396」이라 답했다 — 참인 관측이고, 완전히 틀린 답이다.
  test('700px 분기를 «700 근처»로 좁힌다 (390 근처가 아니다)', async () => {
    const r = (await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 768, containerPx: 576 }, site(700)))!;
    expect(r.low).toBeGreaterThan(650);
    expect(r.high).toBeLessThan(760);
  });

  test('다른 분기 지점(560px)도 «그 위»로 좁힌다 — 구간의 아래가 진짜 분기의 상한이다', async () => {
    const r = (await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 1280, containerPx: 576 }, site(560)))!;
    // ⚠️ max-width 상한은 비율이 «점진적»으로 갈린다 ⇒ 구간이 진짜 분기(560)보다 «위»에 선다.
    //    그래도 890px 짜리 무지에서 «수십 px» 구간까지 좁혔다 — 그것이 이 자의 값이다.
    expect(r.spanPx).toBeLessThanOrEqual(32);
    expect(r.low).toBeGreaterThan(560);
  });

  test('⛔ 그 한계를 «산출이 말한다»', async () => {
    const r = await searchBreakpoint({ width: 390, containerPx: 374 }, { width: 1280, containerPx: 576 }, site(560));
    expect(formatBreakpointRange(r, [390, 1280]).join('\n')).toContain('구간의 «아래»를 상한으로 읽어라');
  });

  test('임계가 «값으로» 나가 있다', () => {
    expect(BREAKPOINT_RATIO_TOLERANCE).toBe(0.06);
  });
});

// ── 🚨 「아무것도 안 바뀌는 폭」을 분기라 답한다 (2026-09-11 🅕 양성 대조) ────────────
//
// 🩸 계기: 제가 지은 사이트의 분기는 제가 «안다» — CSS 에 `@media (max-width: 597px)` 한 줄뿐이고,
//    CDP 실측에서 596↔598 에 세 성질(h1 52→120 · 카드 1열→2열 · 패딩 16→24)이 «동시에» 뒤집혔다.
//    그런데 이 자는 **556 ↔ 562** 를 냈다 — 그 구간에서는 ***아무 성질도 안 바뀐다***.
//
// 기전: 판정이 언제나 «아래 끝»의 비율과 견준다. 유동 칸의 비율 `1 - 2p/w` 는 폭을 따라
//    단조롭게 «표류»하고, 패딩이 «두 겹»이면(바깥 16 ⊕ 카드 22 = 38px) 그 표류가 0.065 가 되어
//    ***진짜 분기에 닿기 전에 임계 0.06 을 넘는다.*** 그 순간 자가 `hi` 를 당겨 아래로 수렴한다.
//
// 🚨 방향이 `BREAKPOINT_SEARCH_LIMITATION` 의 문면과 «반대»다 — 그 문면은 「구간이 «위»로 밀린다,
//    구간의 «아래»를 상한으로 읽어라」인데, 여기서는 «아래»로 밀렸다. 그 처방이 틀린 답을 준다.
describe('🚨⭐ 「두 겹 패딩」 유동 아래에서 «아래로» 밀린다', () => {
  /**
   * 내 사이트를 «수»로 옮긴 것.
   *   분기 아래: 한 열   — 글 폭 = w - 32(바깥) - 44(카드)
   *   분기 위:   두 열   — 글 폭 = (w - 48 - 24)/2 - 44
   * ⛔ 픽스처가 아니라 «실측에서 옮긴 식»이다 — 596→520 · 598→219 가 CDP 값과 맞는다.
   */
  const twoLayerPadding = (breakAt: number) => async (w: number) =>
    (w <= breakAt ? w - 32 - 44 : Math.round((w - 48 - 24) / 2) - 44);

  test('⛔ 진짜 분기(597)를 구간이 «담는다» — 아래로 밀리지 않는다', async () => {
    const lo = { width: 390, containerPx: await twoLayerPadding(597)(390) };
    const hi = { width: 1280, containerPx: await twoLayerPadding(597)(1280) };
    const r = (await searchBreakpoint(lo, hi, twoLayerPadding(597)))!;
    expect(r.low).toBeGreaterThan(520);
    // ⭐ 이 줄이 핵심이다 — 「구간의 아래가 진짜 분기의 상한」이라는 처방이 성립하려면
    //    `low <= 597` 이면서 `high` 가 597 «위»여야 한다.
    expect(r.high).toBeGreaterThanOrEqual(597);
    expect(r.low).toBeLessThanOrEqual(597);
  });

  test('분기를 720 으로 옮겨도 «따라간다» — 한 수에 맞춘 것이 아니다', async () => {
    const lo = { width: 390, containerPx: await twoLayerPadding(720)(390) };
    const hi = { width: 1280, containerPx: await twoLayerPadding(720)(1280) };
    const r = (await searchBreakpoint(lo, hi, twoLayerPadding(720)))!;
    expect(r.low).toBeLessThanOrEqual(720);
    expect(r.high).toBeGreaterThanOrEqual(720);
  });
});

// ── 🩸 「양성 대조가 «하나»면 맞춘 것과 고친 것이 안 갈린다」 (2026-09-11 두 번째 판) ──────
//
// 🩸 앞 판(「가까운 끝」)은 위 «두 겹 패딩» 시험만 보고 골랐고, 그 하나에서만 좋아졌다.
//    정답을 아는 실제 사이트가 «열한 개» 있었는데 안 썼고, 재 보니 8/11 에서 «더 나빴다».
// ⇒ 그래서 이 절은 ***«다른 모양»의 분기***를 같이 문다 — 한 모양만 물면 또 맞추게 된다.
describe('⛔⭐ «다른 모양»의 분기도 좁힌다 — 한 모양에 맞추지 않는다', () => {
  /** 모양 ⓐ — `max-width` 상한형. 아래는 유동, 위는 «고정 폭». 내 사이트 열 개가 이 모양이다. */
  const capped = (breakAt: number, cap: number, pad: number) => async (w: number) =>
    (w <= breakAt ? w - pad * 2 : cap);

  /** 모양 ⓑ — 두 겹 패딩 ⊕ 열 점프. `dongne-hansu` 가 이 모양이다. */
  const twoLayerPadding = (breakAt: number) => async (w: number) =>
    (w <= breakAt ? w - 32 - 44 : Math.round((w - 48 - 24) / 2) - 44);

  const span = async (probe: (w: number) => Promise<number>) => {
    const lo = { width: 390, containerPx: await probe(390) };
    const hi = { width: 1280, containerPx: await probe(1280) };
    return searchBreakpoint(lo, hi, probe);
  };

  // ⛔⭐ 순수 상한형은 ***구간이 위로 밀린다*** — `BREAKPOINT_SEARCH_LIMITATION` 이 적어 둔 그것이고
  //    이 판도 «안 고친다». 상한 «바로 위»의 비율(`cap/w`)이 유동 예측과 아직 가깝기 때문이다.
  //    ⇒ 그래서 「담는다」가 아니라 ***「구간의 «아래»가 진짜 분기의 상한이다」***를 문다.
  // ⚠️ 이 픽스처는 «실제 화면보다 가혹»하다 — 진짜 사이트는 분기에서 열 수·여백도 같이 바뀐다.
  //    실측(내 사이트 11개)에서는 상한형도 697↔711(정답 700) 처럼 붙었다.
  test('ⓐ 상한형(700px) — 구간의 «아래»가 진짜 분기의 상한이다', async () => {
    const r = (await span(capped(700, 640, 30)))!;
    expect(r.low).toBeGreaterThanOrEqual(700);
    expect(r.spanPx).toBeLessThanOrEqual(16);
  });

  test('ⓐ 상한을 «옮기면» 구간도 «따라 움직인다» (700 → 960)', async () => {
    const a = (await span(capped(700, 640, 30)))!;
    const b = (await span(capped(960, 900, 30)))!;
    // ⭐ 사다리 ③ — 정답을 옮겼는데 답이 그대로면 그 자는 정답을 «안 본다»
    expect(b.low).toBeGreaterThan(a.low);
    expect(b.low).toBeGreaterThanOrEqual(960);
  });

  test('ⓑ 두 겹 패딩형(597px)도 여전히 담는다 — 앞 판이 고친 그것을 «안 잃는다»', async () => {
    const r = (await span(twoLayerPadding(597)))!;
    expect(r.low).toBeLessThanOrEqual(597);
    expect(r.high).toBeGreaterThanOrEqual(597);
  });

  test('⛔ 두 모양이 «같은 규칙»으로 풀린다 — 모양마다 다른 자를 쓰지 않는다', async () => {
    // 🔑 이 시험이 있는 이유: 앞 판은 ⓑ 만 보고 규칙을 갈아 ⓐ 열 개를 망가뜨렸다.
    for (const probe of [capped(700, 640, 30), twoLayerPadding(597)]) {
      expect((await span(probe))!.spanPx).toBeLessThanOrEqual(32);
    }
  });

  // 📏 규칙을 고른 «근거» — 내 사이트 11개(정답은 각자의 `@media` 선언)에 같은 탐침 자료로 A/B:
  //      총 오차   「아래 끝±임계」 520.5 · 「가까운 끝」 1250 · ***「아래 규칙 예측」 257***
  //      최악      247 · 194 · ***66***
  //      중앙값     38 · 128.5 · ***5***
  //    ⛔ 그 표는 이 저장소 «밖»의 사이트를 재야 나오므로 시험으로 못 박지 못한다.
  //       ⇒ 여기서는 «모양 둘»을 물고, 수는 `내부 문서 `RESULT-F-…-2026-09-11`` 가 갖는다.
});

// ── ⭐⭐⭐ «불연속» 지문 — 분기는 계단이고 계단은 «표류하지 않는다» (2026-09-11) ──────
//
// 🔑 실측이 연 것: 「못 좁힘」 다섯 건에서 «전부» 다른 신호가 갈렸다(h1 5/5 · 패딩 5/5 · 열 수 2/5).
//    그런데 자는 「본문 폭 비율」 «하나»만 봤다.
// 📏 사이트 13개 전수 A/B(같은 탐침 자료 · 정답 = 각자의 `@media`):
//      아래끝±임계 602.5/247/45/못좁힘1 · 아래규칙예측 258/66/5/1 · ***지문 49/5/4/0***
describe('⭐⭐ «지문»이 있으면 그것으로 가른다 — 표류가 «없다»', () => {
  /** ⛔ 「계단」 탐침 — 지문은 폭에 따라 «불연속»으로 바뀐다. */
  const stepped = (breakAt: number) => async (w: number) => ({
    // 본문 폭이 «폭에 비례»한다 ⇒ 비율이 어느 폭에서나 같아 «비율 규칙은 시작도 안 한다».
    // ⛔ 그런데 화면은 «분명히» 갈린다 — h1·패딩·열 수가 계단으로 바뀐다. 그것이 지문이다.
    containerPx: Math.round(w * 0.9),
    fingerprint: w <= breakAt ? 'h1 32px|16px|1' : 'h1 60px|48px|2',
  });

  test('🩸 비율로는 «시작도 안 하는» 화면을 지문은 좁힌다', async () => {
    const probe = stepped(700);
    const lo = { width: 390, ...(await probe(390)) };
    const hi = { width: 1280, ...(await probe(1280)) };
    // ⛔ 비율만 보면 둘 다 (w-40)/w ≈ 0.9 라 «같은 규칙»으로 읽혀 null 이 된다
    const byRatio = await searchBreakpoint(
      { width: lo.width, containerPx: lo.containerPx }, { width: hi.width, containerPx: hi.containerPx },
      async (w) => Math.round(w * 0.9));
    expect(byRatio).toBeNull();
    // ✅ 지문을 주면 좁힌다
    const r = (await searchBreakpoint(lo, hi, probe))!;
    expect(r.low).toBeLessThanOrEqual(700);
    expect(r.high).toBeGreaterThanOrEqual(700);
  });

  test('⭐ 분기를 «옮겨도» 따라간다 (사다리 ③)', async () => {
    for (const at of [520, 700, 952]) {
      const probe = stepped(at);
      const lo = { width: 390, ...(await probe(390)) };
      const hi = { width: 1280, ...(await probe(1280)) };
      const r = (await searchBreakpoint(lo, hi, probe))!;
      expect(r.low).toBeLessThanOrEqual(at);
      expect(r.high).toBeGreaterThanOrEqual(at);
    }
  });

  test('⛔ 두 끝의 «지문이 같으면» null — 갈릴 것이 없다', async () => {
    const flat = async () => ({ containerPx: 600, fingerprint: '같음' });
    expect(await searchBreakpoint(
      { width: 390, containerPx: 600, fingerprint: '같음' },
      { width: 1280, containerPx: 600, fingerprint: '같음' }, flat)).toBeNull();
  });

  test('⛔ 지문이 «없으면» 옛 규칙으로 떨어진다 — 하위호환', async () => {
    // 모양 ⓐ(상한형)를 지문 «없이» 준다 ⇒ 앞 판과 «같은» 답이어야 한다
    const capped = async (w: number) => (w <= 700 ? w - 60 : 640);
    const r = (await searchBreakpoint(
      { width: 390, containerPx: 330 }, { width: 1280, containerPx: 640 }, capped))!;
    expect(r.low).toBeGreaterThanOrEqual(700);   // 한계 문면대로 «위»로 밀린다
    expect(r.spanPx).toBeLessThanOrEqual(16);
  });

  test('⛔ 중간에서 지문을 «못 얻으면» 기록하고 멈춘다 — 반을 안 버린다', async () => {
    const flaky = async (w: number) => (w === 835
      ? { containerPx: null }
      : { containerPx: w - 40, fingerprint: w <= 700 ? 'A' : 'B' });
    const r = (await searchBreakpoint(
      { width: 390, containerPx: 350, fingerprint: 'A' },
      { width: 1280, containerPx: 1240, fingerprint: 'B' }, flaky))!;
    expect(r.unmeasured).toContain(835);
  });
});
