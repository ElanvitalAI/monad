// ── 충실성 계측 시험 — ⛔ 「못 쟀다」가 「0」으로 접히지 않는가 ─────────────────
//
// 🩸 계기: 첫 수동 측정이 뷰포트 아티팩트로 9.26%p 틀렸다. 그 실패의 «모양»이
//    「기운 수를 그럴듯하게 낸다」였다. ⇒ 아래 시험은 ***신뢰 플래그***와
//    ***unmeasured***가 실제로 서는지를 먼저 문다.

import { describe, expect, test } from 'bun:test';

import {
  classifyCaptureSettling, isRenderProbeSuspect,
  type CapturePixelStats, type NearBlankCapture,
  classifyNearBlankCapture, classifyNearBlankCaptures, classifyRenderLocation, judgeFidelity, testRenderLocationHypothesis, visibleTextLength,
  type HypothesisSample, type FidelityInput,
} from './clone-fidelity.js';

describe('visibleTextLength', () => {
  test('스크립트·스타일·주석을 «본문에서 뺀다»', () => {
    const html = '<html><style>a{b:c}</style><script>var x=1</script><!-- c --><p>안녕</p></html>';
    expect(visibleTextLength(html)).toBe(2);
  });
  test('공백을 접어 «같은 글»이 같은 수를 낸다', () => {
    expect(visibleTextLength('<p>a   b</p>')).toBe(visibleTextLength('<p>a\n\n b</p>'));
  });
  test('빈 문서는 0', () => {
    expect(visibleTextLength('<html></html>')).toBe(0);
  });
});

describe('classifyNearBlankCapture — 픽셀 유래 캡처 분류', () => {
  // ⛔⭐ 🩸 이 describe 의 «옛» 시험들은 «지어낸 수»만 물었고, 그래서 ***오판을 못 박고 있었다***:
  //    `{sd: 0.0995, entropy: 0.01} → near-blank` 라고 박아 뒀는데 ***실제 내 사이트가 sd 0.11*** 이다.
  //    ⇒ 이제 ***전부 «실측»으로 문다***(2026-09-11 · `magick -colorspace Gray` · 11 대상).
  //    ⭐ 양성 대조가 «한 모양»이 아니다(빈 흰 · 빈 검정 · 그라디언트) ⊕ 음성도 아니다(라이트 4 · 다크 2 · 사진 2).
  const REAL: ReadonlyArray<readonly [string, CapturePixelStats, NearBlankCapture]> = [
    // ── 양성 대조: 정말 «비었다» ──
    ['빈 흰 화면',        { meanLuminance: 1.0000, luminanceStdDev: 0.0000, luminanceEntropy: 0.0002 }, 'near-blank'],
    ['빈 검은 화면',      { meanLuminance: 0.0667, luminanceStdDev: 0.0000, luminanceEntropy: 0.0002 }, 'near-blank'],
    // ⭐ 이 줄이 옛 주석의 전제를 «반증»한다 — 그라디언트의 엔트로피는 «최대»다. 편차가 잡는다.
    ['저대비 그라디언트', { meanLuminance: 0.9667, luminanceStdDev: 0.0193, luminanceEntropy: 1.0000 }, 'near-blank'],
    // ── 음성 대조: 다 «그려졌다» ──
    ['plasma 사진',      { meanLuminance: 0.4187, luminanceStdDev: 0.2266, luminanceEntropy: 0.9756 }, 'not-near-blank'],
    ['내 사이트 8812',   { meanLuminance: 0.9285, luminanceStdDev: 0.1960, luminanceEntropy: 0.1301 }, 'not-near-blank'],
    ['내 사이트 8814',   { meanLuminance: 0.9626, luminanceStdDev: 0.1316, luminanceEntropy: 0.1265 }, 'not-near-blank'],
    ['내 사이트 8816',   { meanLuminance: 0.9487, luminanceStdDev: 0.1101, luminanceEntropy: 0.1164 }, 'not-near-blank'],
    ['airbnb',           { meanLuminance: 0.9614, luminanceStdDev: 0.0862, luminanceEntropy: 0.1603 }, 'not-near-blank'],
    ['netflix(다크)',    { meanLuminance: 0.0902, luminanceStdDev: 0.1411, luminanceEntropy: 0.7821 }, 'not-near-blank'],
    ['slack',            { meanLuminance: 0.8982, luminanceStdDev: 0.2683, luminanceEntropy: 0.1878 }, 'not-near-blank'],
    ['youtube',          { meanLuminance: 0.4320, luminanceStdDev: 0.2768, luminanceEntropy: 0.7862 }, 'not-near-blank'],
  ];

  for (const [name, stats, want] of REAL) {
    test(`실측 — ${name} 은 ${want}`, () => {
      expect(classifyNearBlankCapture(stats)).toBe(want);
    });
  }

  test('⛔ 엔트로피는 판정에 «안 쓴다» — 같은 편차면 엔트로피가 0 이든 1 이든 답이 같다', () => {
    const lo = { meanLuminance: 0.95, luminanceStdDev: 0.12, luminanceEntropy: 0.01 };
    const hi = { meanLuminance: 0.95, luminanceStdDev: 0.12, luminanceEntropy: 0.99 };
    expect(classifyNearBlankCapture(lo)).toBe(classifyNearBlankCapture(hi));
    expect(classifyNearBlankCapture(lo)).toBe('not-near-blank');
  });

  test('⭐ 갈림에 «여유»가 있다 — 최악의 양성(0.0193)과 최악의 음성(0.0862) 사이에 임계가 있다', () => {
    expect(classifyNearBlankCapture({ meanLuminance: 0.96, luminanceStdDev: 0.0193, luminanceEntropy: 1 })).toBe('near-blank');
    expect(classifyNearBlankCapture({ meanLuminance: 0.96, luminanceStdDev: 0.0862, luminanceEntropy: 0.16 })).toBe('not-near-blank');
  });

  test('어두운 화면은 문턱이 조금 열린다 — 그래도 netflix(sd 0.141)는 통과한다', () => {
    expect(classifyNearBlankCapture({ meanLuminance: 0.06, luminanceStdDev: 0.045, luminanceEntropy: 0.5 })).toBe('near-blank');
    expect(classifyNearBlankCapture({ meanLuminance: 0.0902, luminanceStdDev: 0.1411, luminanceEntropy: 0.78 })).toBe('not-near-blank');
  });

  test('결손·범위 밖 입력은 unmeasured로 보존한다', () => {
    expect(classifyNearBlankCapture(null)).toBe('unmeasured');
    expect(classifyNearBlankCapture({ meanLuminance: -0.01, luminanceStdDev: 0.1, luminanceEntropy: 0.1 })).toBe('unmeasured');
    expect(classifyNearBlankCapture({ meanLuminance: 0.1, luminanceStdDev: 1.01, luminanceEntropy: 0.1 })).toBe('unmeasured');
    expect(classifyNearBlankCapture({ meanLuminance: 0.1, luminanceStdDev: 0.1, luminanceEntropy: 1.01 })).toBe('unmeasured');
  });

  test('원본과 미러는 같은 분류 계약을 적용한다', () => {
    expect(classifyNearBlankCaptures(
      { meanLuminance: 0.02, luminanceStdDev: 0.01, luminanceEntropy: 0 },
      { meanLuminance: 0.5, luminanceStdDev: 0.3, luminanceEntropy: 0.7 },
    )).toEqual({ original: 'near-blank', mirror: 'not-near-blank' });
  });
});

describe('classifyRenderLocation — 독립변수', () => {
  test('원문이 렌더의 대부분이면 server', () => {
    expect(classifyRenderLocation(1664, 1701)).toBe('server');
  });
  test('원문이 거의 없으면 client', () => {
    expect(classifyRenderLocation(50, 4000)).toBe('client');
  });
  test('사이는 mixed — ⛔ 억지로 한쪽으로 밀지 않는다', () => {
    expect(classifyRenderLocation(500, 1000)).toBe('mixed');
  });
  test('⛔ 못 쟀으면 unmeasured — «client 로 접지 않는다»', () => {
    expect(classifyRenderLocation(null, 1000)).toBe('unmeasured');
    expect(classifyRenderLocation(100, null)).toBe('unmeasured');
  });
  test('⛔ 렌더가 0 이면 나눗셈을 «안 한다»', () => {
    expect(classifyRenderLocation(100, 0)).toBe('unmeasured');
  });
});

describe('judgeFidelity — ⭐ 신뢰 플래그가 이 모듈의 본체', () => {
  const base = {
    captureScope: 'viewport' as const,
    rawTextChars: 1664, rawHttpStatus: 200, renderedTextChars: 1701, mirrorTextChars: 1664,
    pixelRmse: 0.0467, pixelDiffRatio: 0.0138,
    originPixelStats: { meanLuminance: 0.5, luminanceStdDev: 0.3, luminanceEntropy: 0.7 },
    mirrorPixelStats: { meanLuminance: 0.5, luminanceStdDev: 0.3, luminanceEntropy: 0.7 },
    measuredViewportHeight: 813, croppedToViewport: true,
    discardedHeightDifference: null,
  };

  test('정상 경로 — 실측 표본을 재현한다', () => {
    const v = judgeFidelity(base);
    expect(v.captureScope).toBe('viewport');
    expect(v.renderLocation).toBe('server');
    expect(v.mirrorTextRatio).toBeCloseTo(0.978, 3);
    expect(v.pixelTrustworthy).toBe(true);
    expect(v.originalNearBlankCapture).toBe('not-near-blank');
    expect(v.mirrorNearBlankCapture).toBe('not-near-blank');
    expect(v.nearBlankClassificationReliable).toBe(true);
    expect(v.unmeasured).toEqual([]);
  });

  test('원본 또는 미러가 near-blank이면 기존 RMSE를 보존하고 픽셀 차이를 미신뢰로 판정한다', () => {
    // ⛔ 옛 값 `{mean .0694, sd .0935, ent .08}` 은 실은 ***다크 테마의 «그려진» 페이지***였다(netflix sd .141 계열).
    //    의도(「비었으면 미신뢰」)는 그대로 두고 ***진짜 빈 캡처의 실측값***으로 바꾼다.
    const v = judgeFidelity({ ...base, mirrorPixelStats: { meanLuminance: 1, luminanceStdDev: 0, luminanceEntropy: 0.0002 } });
    expect(v.pixelRmse).toBe(base.pixelRmse);
    expect(v.originalNearBlankCapture).toBe('not-near-blank');
    expect(v.mirrorNearBlankCapture).toBe('near-blank');
    expect(v.nearBlankClassificationReliable).toBe(true);
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.summary).toContain('근접공백=원본:not-near-blank/미러:near-blank');
    expect(v.summary).toContain('캡처가 거의 비어 픽셀 차이 미신뢰');
  });

  test('양쪽 픽셀 입력 중 하나라도 없으면 unmeasured와 축 이름을 보존한다', () => {
    const v = judgeFidelity({ ...base, originPixelStats: null });
    expect(v.originalNearBlankCapture).toBe('unmeasured');
    expect(v.nearBlankClassificationReliable).toBe(false);
    expect(v.unmeasured).toContain('original-near-blank');
  });

  test('404 원문은 본문 길이와 무관하게 렌더 위치를 못 잰 축으로 남긴다', () => {
    const v = judgeFidelity({ ...base, rawHttpStatus: 404 });
    expect(v.renderLocation).toBe('unmeasured');
    expect(v.unmeasured).toContain('raw-http-status');
    expect(v.summary).toContain('원문HTTP=404 응답이라 못잼');
  });

  test('200 원문은 기존 server 분류를 유지한다', () => {
    expect(judgeFidelity({ ...base, rawHttpStatus: 200 }).renderLocation).toBe('server');
  });

  test('알 수 없는 원문 상태는 기존 렌더 판정을 막지 않는다', () => {
    expect(judgeFidelity({ ...base, rawHttpStatus: null }).renderLocation).toBe('server');
  });

  test('전체 페이지 범위를 판정과 산출 문장에 싣고 픽셀을 미신뢰로 남긴다', () => {
    const v = judgeFidelity({ ...base, captureScope: 'full-page', discardedHeightDifference: 880 });
    expect(v.captureScope).toBe('full-page');
    expect(v.summary).toContain('범위=full-page');
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.unmeasured).toEqual([]);
  });

  test('전체 페이지 높이 정렬을 못 재면 축 이름을 남긴다', () => {
    const v = judgeFidelity({ ...base, captureScope: 'full-page' });
    expect(v.unmeasured).toContain('full-page-height-alignment');
  });

  test('🩸 뷰포트로 «안 잘랐으면» 기존 분류 신뢰와 픽셀을 모두 미신뢰로 표시한다', () => {
    const v = judgeFidelity({ ...base, croppedToViewport: false });
    expect(v.nearBlankClassificationReliable).toBe(false);
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.summary).toContain('미신뢰');
  });

  test('🩸 뷰포트를 «못 쟀으면» 잘랐다고 해도 미신뢰다', () => {
    const v = judgeFidelity({ ...base, measuredViewportHeight: null });
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.unmeasured).toContain('viewport-height');
  });

  test.each([
    ['timed-out', '시간 상한'],
    ['failed', '실패'],
  ] as const)('미러 %s는 픽셀을 미신뢰로 만들고 완주 사유를 요약한다', (mirrorCompletion, summaryReason) => {
    const v = judgeFidelity({ ...base, mirrorCompletion });
    expect(v.mirrorCompletion).toBe(mirrorCompletion);
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.unmeasured).toContain(`mirror-${mirrorCompletion}`);
    expect(v.summary).toContain(summaryReason);
    expect(v.summary).toContain('픽셀 품질을 읽을 수 없음');
  });

  test('미러 시간 상한은 기존 뷰포트 미측정 사유를 지우지 않는다', () => {
    const v = judgeFidelity({ ...base, mirrorCompletion: 'timed-out', measuredViewportHeight: null });
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.unmeasured).toEqual(expect.arrayContaining(['mirror-timed-out', 'viewport-height']));
  });

  test('⛔ 못 잰 축이 «이름»으로 남는다 — 0 으로 접히지 않는다', () => {
    const v = judgeFidelity({
      ...base, mirrorTextChars: null, pixelRmse: null, pixelDiffRatio: null,
    });
    expect(v.mirrorTextRatio).toBeNull();
    expect(v.pixelRmse).toBeNull();
    expect(v.unmeasured).toContain('mirror-text');
    expect(v.unmeasured).toContain('pixel');
    expect(v.summary).toContain('못잼');
  });
});

describe('testRenderLocationHypothesis — 가설 검정', () => {
  const S = (label: string, renderLocation: HypothesisSample['renderLocation'], r: number | null): HypothesisSample =>
    ({ label, renderLocation, mirrorTextRatio: r });

  test('server 는 높고 client 는 낮으면 지지된다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.98), S('b', 'server', 0.9),
      S('c', 'client', 0.1), S('d', 'client', 0.05),
    ]);
    expect(r.verdict).toBe('supported');
    expect(r.inversions).toEqual([]);
  });

  test('🔴 client 인데 본문이 높으면 «역전»으로 잡는다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.98), S('b', 'server', 0.9),
      S('c', 'client', 0.9), S('d', 'client', 0.05),
    ]);
    expect(r.verdict).toBe('inverted');
    expect(r.inversions).toHaveLength(1);
    expect(r.inversions[0]).toContain('client 인데');
  });

  test('🔴 server 인데 본문이 낮아도 «역전»이다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.2), S('b', 'server', 0.9),
      S('c', 'client', 0.1), S('d', 'client', 0.05),
    ]);
    expect(r.verdict).toBe('inverted');
    expect(r.inversions[0]).toContain('server 인데');
  });

  test('⛔ 한쪽 무리만 있으면 «판정 안 한다» — 대조가 없다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.98), S('b', 'server', 0.9), S('c', 'server', 0.95),
    ]);
    expect(r.verdict).toBe('insufficient');
    expect(r.clientSamples).toBe(0);
  });

  test('⚠️ mixed 는 역전 판정에서 «뺀다» — 경계라 어느 쪽도 아니다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.98), S('b', 'server', 0.9),
      S('c', 'client', 0.1), S('d', 'client', 0.05),
      S('e', 'mixed', 0.5),
    ]);
    expect(r.mixedSamples).toBe(1);
    expect(r.verdict).toBe('supported');
  });

  test('⛔ 못 잰 표본을 «성공»으로 세지 않는다', () => {
    const r = testRenderLocationHypothesis([
      S('a', 'server', 0.98), S('b', 'server', 0.9),
      S('c', 'client', 0.1), S('d', 'client', 0.05),
      S('e', 'unmeasured', null), S('f', 'server', null),
    ]);
    expect(r.unmeasuredSamples).toBe(2);
    expect(r.serverSamples).toBe(2);
  });
});

/**
 * ⛔⭐ 정착 «전»에 찍힌 캡처는 그림이 아니라 «중간 상태»다.
 * 🩸 2026-09-11: about.instagram 원본이 1048바이트 백지로 찍혔고 그 수가 A/B 표로 흘러들었다.
 */
describe('캡처 정착 상태', () => {
  const base = (over: Partial<FidelityInput> = {}): FidelityInput => ({
    captureScope: 'viewport', mirrorCompletion: 'completed',
    rawTextChars: 100, rawHttpStatus: 200, renderedTextChars: 1000, mirrorTextChars: 1000,
    pixelRmse: 0.03, pixelDiffRatio: 0.01,
    originPixelStats: { meanLuminance: 0.6, luminanceStdDev: 0.3, luminanceEntropy: 0.8 },
    mirrorPixelStats: { meanLuminance: 0.6, luminanceStdDev: 0.3, luminanceEntropy: 0.8 },
    measuredViewportHeight: 813, croppedToViewport: true, discardedHeightDifference: null,
    ...over,
  });

  test('둘 다 정착했으면 픽셀을 «믿는다»', () => {
    const v = judgeFidelity(base({ originCaptureSettling: 'settled', mirrorCaptureSettling: 'settled' }));
    expect(v.captureSettlingTimedOut).toBe(false);
    expect(v.pixelTrustworthy).toBe(true);
  });

  test('⛔ «한쪽»만 정착 전이어도 못 믿는다', () => {
    const v = judgeFidelity(base({ originCaptureSettling: 'timed-out', mirrorCaptureSettling: 'settled' }));
    expect(v.captureSettlingTimedOut).toBe(true);
    expect(v.pixelTrustworthy).toBe(false);
  });

  test('미신뢰의 «이유»를 이름으로 댄다 — near-blank 와 구분된다', () => {
    const v = judgeFidelity(base({ originCaptureSettling: 'timed-out' }));
    expect(v.summary).toContain('정착 전');
  });

  test('⛔ `unmeasured` 를 「나쁘다」로 접지 않는다 — 안 준 것이지 실패가 아니다', () => {
    const v = judgeFidelity(base({ originCaptureSettling: 'unmeasured', mirrorCaptureSettling: 'unmeasured' }));
    expect(v.captureSettlingTimedOut).toBe(false);
    expect(v.pixelTrustworthy).toBe(true);
  });

  test('⛔ 값을 «아예 안 줘도» 옛 동작 그대로다', () => {
    const v = judgeFidelity(base());
    expect(v.captureSettlingTimedOut).toBe(false);
    expect(v.pixelTrustworthy).toBe(true);
  });
})

// ⛔⭐ 🩸 2026-09-11 — ***자가 「왜 못 믿나」를 «틀리게» 말했다.***
//    `never-grew` 를 `timed-out` 으로 접어서 ***서버 렌더 사이트 13개가 전부 미신뢰***였다.
//    ⭐ 시험은 «두 모양»을 문다(판별 사다리 ⑤b) — 「처음부터 완성」과 「자라다 멈춤」.
describe('캡처 정착 — 「안 자랐다」와 「못 끝냈다」를 가른다', () => {
  test('처음부터 «완성»(본문 있음)은 `already-complete` — 서버 렌더의 정상이다', () => {
    expect(classifyCaptureSettling('never-grew', 31)).toBe('already-complete');
  });

  test('처음부터 «비었다»(0자)는 `blank` — 같은 상태값인데 다른 뜻이다', () => {
    expect(classifyCaptureSettling('never-grew', 0)).toBe('blank');
  });

  test('자라다 «멈췄다»는 `settled`, 자라다 «상한»은 `timed-out`', () => {
    expect(classifyCaptureSettling('settled', 180)).toBe('settled');
    expect(classifyCaptureSettling('capped', 180)).toBe('timed-out');
  });

  const b = (over: Partial<FidelityInput> = {}): FidelityInput => ({
    captureScope: 'viewport', mirrorCompletion: 'completed',
    rawTextChars: 100, rawHttpStatus: 200, renderedTextChars: 1000, mirrorTextChars: 1000,
    pixelRmse: 0.03, pixelDiffRatio: 0.01,
    originPixelStats: { meanLuminance: 0.6, luminanceStdDev: 0.3, luminanceEntropy: 0.8 },
    mirrorPixelStats: { meanLuminance: 0.6, luminanceStdDev: 0.3, luminanceEntropy: 0.8 },
    measuredViewportHeight: 813, croppedToViewport: true, discardedHeightDifference: null,
    ...over,
  });

  test('⭐ 서버 렌더(양쪽 `already-complete`)는 픽셀을 «믿는다» — 이것이 고친 결함이다', () => {
    const v = judgeFidelity(b({ originCaptureSettling: 'already-complete', mirrorCaptureSettling: 'already-complete' }));
    expect(v.captureSettlingTimedOut).toBe(false);
    expect(v.pixelTrustworthy).toBe(true);
  });

  test('⛔ `blank` 는 «못 믿는다» — 빈 그림끼리면 RMSE 가 좋아진다', () => {
    const v = judgeFidelity(b({ originCaptureSettling: 'blank', mirrorCaptureSettling: 'already-complete' }));
    expect(v.captureSettlingTimedOut).toBe(true);
    expect(v.pixelTrustworthy).toBe(false);
    expect(v.summary).toContain('비어 있다');
  });

  test('⛔ 미신뢰 «사유»가 둘로 갈린다 — blank 와 timed-out 이 같은 말을 하지 않는다', () => {
    const blank = judgeFidelity(b({ originCaptureSettling: 'blank' })).summary;
    const timed = judgeFidelity(b({ originCaptureSettling: 'timed-out' })).summary;
    expect(blank).not.toBe(timed);
    expect(timed).toContain('정착 전');
  });
})

// ⛔⭐ 🩸 `airbnb` 에서 「미러 본문 1267.7%」라는 «불가능한 수»가 나왔고,
//    원인은 「원본보다 더 재현했다」가 «아니라» ***분모(렌더 232자)가 거짓***이었다.
describe('isRenderProbeSuspect — 분모가 거짓인지 «말한다»', () => {
  test('⭐ 실측 airbnb — 원문 5098 · 렌더 232 는 «의심스럽다»', () => {
    expect(isRenderProbeSuspect(5098, 232)).toBe(true);
  });

  test('⭐ 실측 정상 — netflix(2276/5027) · spotify(1236/10496) 는 «의심하지 않는다»', () => {
    expect(isRenderProbeSuspect(2276, 5027)).toBe(false);
    expect(isRenderProbeSuspect(1236, 10496)).toBe(false);
  });

  test('⛔ 못 쟀으면 「의심스럽다」가 아니다 — 안 잰 것이다', () => {
    expect(isRenderProbeSuspect(null, 232)).toBe(false);
    expect(isRenderProbeSuspect(5098, null)).toBe(false);
  });

  test('⛔ 렌더가 «0» 이면 원문이 있을 때만 의심한다 — 0으로 나누지 않는다', () => {
    expect(isRenderProbeSuspect(5098, 0)).toBe(true);
    expect(isRenderProbeSuspect(0, 0)).toBe(false);
  });

  test('문턱 언저리 — 딱 1.5 배면 의심하고 그 아래면 아니다', () => {
    expect(isRenderProbeSuspect(150, 100)).toBe(true);
    expect(isRenderProbeSuspect(149, 100)).toBe(false);
  });

  test('⛔ 이 자는 «판정을 바꾸지 않는다» — classifyRenderLocation 은 그대로다', () => {
    // 🩸 그 자는 `5098/232 = 21.98 ≥ 0.8` 이라 「server」라고 «자신 있게» 말한다.
    //    고치지 «않는» 것이 의도다 — 두 축을 섞지 않는다.
    expect(classifyRenderLocation(5098, 232)).toBe('server');
  });
})
