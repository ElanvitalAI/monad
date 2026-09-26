/**
 * 📈⭐⭐ **`lightweight-charts` 로 그린다 — 그리고 «좌표를 그 차트에게 묻는다»** (2026-09-01 · 42차).
 *
 * 🚨 계기(대표): *"외부에서 github 에서 차트용 프로그램을 찾아서 서비스 구현이 어떨까요?"*
 *    ⇒ 우리가 손으로 그린 SVG 는 축 눈금도 날짜도 그리드도 «없었다».
 *
 * 🔑⭐⭐ **그런데 이 갈래의 진짜 값은 «그림»이 아니라 «좌표»다.**
 *    RFC §7c 가 잰 것: ***관문 ⓒ(축 범위를 내나)가 세 사이트 어디도 안 선다.***
 *    그런데 이 라이브러리는 ***`priceToCoordinate`·`timeToCoordinate` 를 «공개»한다***.
 *    ⇒ 우리 차트에서는 그 병목이 «완전히» 사라진다 — 축을 «추정»하지 않고 «묻는다».
 *
 * 📏 42차 관문 실측(예비 봇 9404):
 * ```
 * 단일 파일 인라인   193KB · setDocumentContent ***47ms***   ⇐ §7c 의 「크기 한계 미측정」이 닫혔다
 * 라이브러리 기동    lib:"object" · canvas 7
 * 좌표 API          priceToCoordinate(316.85) → 227.6px · timeToCoordinate → 1174px
 * ```
 * ⛔ CDN 을 쓰지 «않는다» — 우리 페이지는 `Page.setDocumentContent` 로 띄우므로 «인라인»이어야 한다
 *    (그리고 그것이 CSP·네트워크 의존을 «0» 으로 만든다).
 * 📜 자산 = `assets/vendor/lightweight-charts.standalone.production.js` (Apache-2.0).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { Candlestick } from './chart.js';

/** ⛔ 「없다」와 「못 읽었다」를 가른다. */
export type VendorLoad = { ok: true; script: string; bytes: number } | { ok: false; reason: string };

/** ⛔ `process.cwd()` 로 찾지 «않는다» — 이 파일 기준이다(42차가 CLI 에서 한 번 밟았다). */
export function vendorScriptPath(): string {
  return join(dirname(dirname(import.meta.dir)), 'assets', 'vendor', 'lightweight-charts.standalone.production.js');
}

/** ⛔ 193KB 를 «매번» 읽지 않는다 — 같은 프로세스에서 반복 호출하면 속도 목표에 역행한다(자기 리뷰). */
let vendorMemo: { path: string; load: VendorLoad } | null = null;
/** ⛔ 시험이 기억을 «지울» 수 있어야 한다. */
export function forgetVendorScript(): void { vendorMemo = null; }

export function loadVendorScript(
  path = vendorScriptPath(),
  deps: { exists?: (p: string) => boolean; read?: (p: string) => string } = {},
): VendorLoad {
  // ⛔ 주입(deps)이 있으면 기억을 «쓰지도 만들지도» 않는다 — 시험이 서로 새면 안 된다.
  const memoizable = deps.exists === undefined && deps.read === undefined;
  if (memoizable && vendorMemo !== null && vendorMemo.path === path) return vendorMemo.load;
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf8'));
  if (!exists(path)) return { ok: false, reason: `차트 라이브러리를 «못 찾았다»: ${path}` };
  let script: string;
  try { script = read(path); } catch (e) {
    return { ok: false, reason: `차트 라이브러리를 못 읽었다: ${e instanceof Error ? e.message : String(e)}` };
  }
  // ⛔ 「파일이 있다」와 「그 라이브러리다」는 다른 값이다 — 전역 이름이 들어 있나 본다.
  if (!script.includes('LightweightCharts')) {
    return { ok: false, reason: `그 파일에 «LightweightCharts» 가 없다(${script.length}바이트) — 다른 파일인가` };
  }
  const load: VendorLoad = { ok: true, script, bytes: script.length };
  if (memoizable) vendorMemo = { path, load };
  return load;
}

/**
 * 🩸⭐⭐ **`<script>` 안에 넣을 것을 «안전하게»** — 순수. (자기 리뷰 `#15073`)
 *
 * ⛔ HTML 파서는 `</script` 를 만나면 «거기서» 스크립트를 끝낸다 — 그것이 문자열 «안»이어도 그렇다.
 *    ⇒ vendor 나 데이터에 그 글자가 있으면 ***페이지가 깨지고 뒤가 HTML 로 읽힌다***.
 * 📏 42차 실측: 지금 vendor 에는 `</script` 가 **0건**이다. ⛔ 그러나
 *    ***「지금 안 난다」와 「원리상 안 난다」는 다른 값이다*** — 라이브러리 판이 바뀌면 난다.
 * 🔑 `<\/script` 는 JS 문자열·정규식에서 `</script` 와 «같은 값»이고 HTML 파서는 «안 문다».
 */
export function escapeForScriptTag(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * 🩸 JSON 을 `<script>` 안에 넣을 때. 순수.
 * ⛔ `JSON.stringify` 는 `<` 를 «이스케이프 안 한다» — 그래서 따로 접는다.
 */
export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** 🎨 색 값만 통과시킨다. 순수. ⛔ 임의 문자열이 HTML 속성으로 새면 태그를 탈출한다. */
export function safeColor(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$|^[a-zA-Z]{3,20}$/.test(value.trim())
    ? value.trim() : fallback;
}

/** 🎯 그림에 얹는 판정 — ⛔ 「언제·무슨 자로」가 «필수»다(점수만 두면 어제 것을 오늘로 읽는다). */
export interface ChartVerdict {
  readonly total: number;
  readonly signal: string;
  readonly asOf: string;
  readonly preset: string;
}

export interface LwcOptions {
  /** 오름/내림 색 — ⛔ 우리 SVG 원장과 «같은 값»을 기본으로(두 그림이 다른 말을 하면 안 된다). */
  readonly upColor?: string;
  readonly downColor?: string;
  readonly background?: string;
  /**
   * 📉 이동평균 기간들(봉 수). 기본 `[20, 60]` · 빈 배열이면 «안 그린다».
   * ⛔ 「판정」이 아니라 «관측»이다 — 사는 때·파는 때를 말하지 «않는다».
   */
  readonly movingAverages?: readonly number[];
  /**
   * 🏷️⭐⭐ **그림 자신이 「무엇인가」를 말한다** (2026-09-01 · 42차)
   *
   * 🚨 계기 — 아침 루틴이 그림을 보내는데 ***그 그림에 종목명이 «없었다»***.
   *    캡션(파일명)에만 있어서, 사진만 저장하거나 나중에 보면 ***무엇의 차트인지 모른다.***
   * 🔑 ⇒ ***산출은 자기가 무엇인지 말해야 한다*** — 이 저장소의 상시 주제다.
   * ⛔ 비워 두면 «안 그린다»(빈 상자를 두지 않는다).
   */
  readonly title?: string;
  /**
   * 🎯⭐⭐ **판정을 그림 «위에»** (2026-09-01 · 42차 · 대표 허락)
   *
   * 🚨 이 칸은 로드맵이 ***「코나투스 게이트 뒤」***로 미뤄 뒀던 자리다.
   *    📏 42차 실측: `asset-attractiveness` 스킬은 `conatus` 를 ***0건*** 부른다
   *       ⇒ 기술적으로는 게이트 «밖»이었고, 관문은 ***재측정이 아니라 «허락»***이었다.
   *    ✅ 대표 이 그 허락을 주셨다(2026-09-01 밤).
   *
   * ⛔⭐ **판정은 「언제·무슨 자로」와 «떼어 놓지» 않는다** — 점수만 보이면
   *    ***어제 것을 오늘 것으로 읽는다.*** ⇒ `asOf`·`preset` 을 «같이» 싣는다.
   * ⛔ 그리고 코나투스 데이터(`trade-blackboard` 등)엔 «안 붙인다» — 로드맵이 그은 선이다.
   */
  readonly verdict?: ChartVerdict;
}

/** 🎯 신호 색 — ⛔ 모르는 신호는 «회색»이다(초록/빨강으로 «짐작»하지 않는다). */
export function signalColor(signal: string): string {
  const up = signal.trim().toUpperCase();
  if (up === 'BUY' || up === 'STRONG_BUY') return '#3fb950';
  if (up === 'SELL' || up === 'STRONG_SELL') return '#f85149';
  if (up === 'HOLD' || up === 'NEUTRAL') return '#8b949e';
  return '#8b949e';
}

/**
 * 🔒 HTML 본문에 넣을 글자를 «접는다» — ⛔ 제목은 «바깥»에서 온다(종목명·기간).
 *    🔑 이 파일이 이미 같은 규율을 갖고 있다(`escapeForScriptTag`·`safeColor`) — 같은 자리다.
 */
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 이동평균 한 줄의 색 — ⛔ 기간 수보다 적으면 «돌려 쓴다»(색이 없어서 안 그리는 일은 없다). */
const MA_COLORS = ['#58a6ff', '#bc8cff', '#f0883e'] as const;

/**
 * 📉⭐⭐ **단순이동평균 — 순수하다**(2026-09-01 · 42차)
 *
 * ⛔ **모자란 구간을 «지어내지» 않는다** — 앞의 `period-1` 개는 «점이 없다».
 *    🔑 이 저장소의 규율 그대로다: ***모르는 것을 0 으로 접지 않는다.***
 * ⛔ 그리고 봉이 기간보다 «적으면» ***빈 배열***을 낸다 — 부르는 쪽이 「안 그린다」로 답한다.
 *    (예: `-1m`(21봉)에 MA60 을 그리려 하면 «한 점도 없다».)
 * ⛔ 유한하지 않은 종가는 «구간 전체»를 버린다 — 평균 하나가 NaN 이면 그 줄이 사라진다.
 */
export function movingAverage(
  candles: readonly Candlestick[],
  period: number,
): { time: number; value: number }[] {
  if (!Number.isInteger(period) || period < 2) return [];
  if (candles.length < period) return [];
  const out: { time: number; value: number }[] = [];
  /**
   * 🩸⛔⭐⭐ **`NaN` 하나가 누적합을 «영구히» 오염시켰다** (사후 자기 리뷰 `#15117` must-fix)
   *
   * 🚨 옛 판은 `sum += close` 로 «전부» 더했다. 그러면 결측 하나가 들어온 뒤
   *    ***그 값이 창에서 «빠져도» sum 이 NaN 으로 남아 뒤의 모든 점이 사라진다.***
   *    ⇒ 실제 데이터에 구멍이 하나만 있어도 ***그 뒤 MA 가 «통째로» 없어진다.***
   * 🔑 ⇒ ***유한값의 합***과 ***창 안의 «못 쓴 개수»***를 «따로» 센다.
   *    창이 깨끗해지면 그 자리부터 다시 점이 나온다.
   */
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const entering = candles[i]!.close;
    if (Number.isFinite(entering)) sum += entering; else bad += 1;
    if (i >= period) {
      const leaving = candles[i - period]!.close;
      if (Number.isFinite(leaving)) sum -= leaving; else bad -= 1;
    }
    if (i < period - 1) continue;
    // ⛔ 창에 «못 쓴 값»이 하나라도 있으면 점을 «안 낸다» — 모자란 평균을 지어내지 않는다.
    if (bad > 0) continue;
    const value = sum / period;
    if (Number.isFinite(value)) out.push({ time: candles[i]!.time, value });
  }
  return out;
}

/** 차트에 물어 얻는 값 — ⛔ 축을 «추정»하지 않는다. */
export interface LwcProbe {
  readonly ok: boolean;
  /** 캔들이 그려진 영역(픽셀). 도형을 그 «안»에 두려면 필요하다. */
  readonly plot?: { left: number; top: number; width: number; height: number };
  /** 물어본 (시각,가격) 각각의 픽셀. ⛔ 차트가 «못 풀면» null 이 온다 — 그것도 답이다. */
  readonly points?: readonly ({ x: number | null; y: number | null })[];
  readonly reason?: string;
}

/**
 * 페이지 HTML 을 만든다. 순수(라이브러리 문자열을 «받는다»).
 * ⛔ 데이터는 «초» 단위 UTC 로 준다 — 이 라이브러리의 계약이다(ms 를 주면 조용히 엉뚱한 해로 간다).
 */
export function renderLwcPage(candles: readonly Candlestick[], script: string, opts: LwcOptions = {}): string {
  // ⛔ 색은 «검증»해서 쓴다 — 임의 문자열이 style 속성으로 새면 태그를 탈출한다(자기 리뷰).
  const up = safeColor(opts.upColor, '#16a34a');
  const down = safeColor(opts.downColor, '#dc2626');
  const bg = safeColor(opts.background, '#0d1117');
  const data = candles.map((c) => ({
    time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close,
  }));
  // 📉 ⛔ 점이 «하나도 없는» 기간은 «뺀다» — 봉보다 긴 기간을 주면 그렇게 된다.
  const maSeries = (opts.movingAverages ?? [20, 60])
    .map((period, index) => ({
      period,
      color: MA_COLORS[index % MA_COLORS.length]!,
      data: movingAverage(candles, period).map((p) => ({ time: Math.floor(p.time / 1000), value: p.value })),
    }))
    .filter((m) => m.data.length > 0);
  // 🏷️ 제목 ⊕ 범례를 «오버레이»로 둔다 — ⛔ 차트 영역을 «안 좁힌다»(pointer-events 도 안 뺏는다).
  const title = (opts.title ?? '').trim();
  const legend = maSeries.map((m) => ({ label: `MA${m.period}`, color: m.color }));
  /**
   * 🎯 판정 줄 — ⛔ 「점수」만 두지 «않는다». 언제·무슨 자로 잰 것인지 «붙여» 둔다.
   * 🔑 그래야 사람이 ***오래된 판정을 지금 것으로 안 읽는다.***
   */
  const v = opts.verdict;
  const verdictHtml = v === undefined ? '' :
    `<div style="font-size:13px;font-weight:600;margin-top:5px;color:${signalColor(v.signal)}">`
    + `🎯 매력도 ${escapeHtmlText(String(Math.round(v.total * 10) / 10))} · ${escapeHtmlText(v.signal)}</div>`
    + `<div style="font-size:11px;font-weight:400;margin-top:1px;color:#8b949e">`
    + `${escapeHtmlText(v.preset)} · ${escapeHtmlText(v.asOf)} 기준</div>`;
  const overlay = title === '' && legend.length === 0 && v === undefined ? '' :
    `<div data-elanous-overlay style="position:absolute;left:12px;top:10px;z-index:5;pointer-events:none;`
    + `font:600 15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e6edf3">`
    + (title === '' ? '' : `<div>${escapeHtmlText(title)}</div>`)
    + (legend.length === 0 ? '' :
        `<div style="font-weight:500;font-size:12px;margin-top:3px">`
        + legend.map((l) => `<span style="color:${l.color};margin-right:10px">━ ${escapeHtmlText(l.label)}</span>`).join('')
        + `</div>`)
    + verdictHtml
    + `</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>elanous chart</title></head>`
    + `<body style="margin:0;background:${bg}"><div id="elanous-chart" style="position:relative;width:100vw;height:100vh"></div>`
    + overlay
    + `<script>${escapeForScriptTag(script)}</script>`
    + `<script>(() => {
  const el = document.getElementById('elanous-chart');
  const chart = LightweightCharts.createChart(el, {
    layout: { background: { color: ${jsonForScriptTag(bg)} }, textColor: '#c9d1d9' },
    grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    rightPriceScale: { borderColor: '#30363d' },
    timeScale: { borderColor: '#30363d' },
  });
  const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: ${jsonForScriptTag(up)}, downColor: ${jsonForScriptTag(down)}, borderVisible: false,
    wickUpColor: ${jsonForScriptTag(up)}, wickDownColor: ${jsonForScriptTag(down)},
  });
  series.setData(${jsonForScriptTag(data)});
  // 📉 이동평균 — ⛔ 점이 «없으면» 시리즈를 만들지도 않는다(빈 줄이 범례만 차지한다).
  for (const ma of ${jsonForScriptTag(maSeries)}) {
    const line = chart.addSeries(LightweightCharts.LineSeries, {
      color: ma.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    line.setData(ma.data);
  }
  chart.timeScale().fitContent();
  // 🔑⭐ ***좌표를 「차트에게 묻는」 문*** — 이것이 이 갈래의 전부다.
  //    ⛔ 축을 추정하지 않는다. 못 풀면 null 을 그대로 돌려준다(모르는 것을 0 으로 접지 않는다).
  window.__elanousChartProbe = (wanted) => {
    try {
      const rect = el.getBoundingClientRect();
      return JSON.stringify({
        ok: true,
        plot: { left: Math.round(rect.left), top: Math.round(rect.top),
                width: Math.round(rect.width), height: Math.round(rect.height) },
        points: (wanted || []).map((w) => ({
          x: chart.timeScale().timeToCoordinate(Math.floor(w.time / 1000)),
          y: series.priceToCoordinate(w.price),
        })),
      });
    } catch (e) { return JSON.stringify({ ok: false, reason: String(e).slice(0, 200) }); }
  };
})();</script></body></html>`;
}

/**
 * 🏷️👁️⭐⭐ **오버레이가 «보이나»를 되읽는다** (사후 자기 리뷰 `#15122` should-fix)
 *
 * 🚨 이 저장소는 주석 SVG 에 대해 ***「그렸다 ≠ 보인다」***를 이미 못 박았다
 *    (`inject.ts` — `namespaceURI` ⊕ `getBoundingClientRect` 로 되읽는다).
 *    ⛔ 그런데 제목·범례 «오버레이»는 그 판정을 «안 받고» 있었다 — 시험이 «문자열»만 봤다.
 * 🔑 ⇒ 같은 자로 잰다: ***DOM 에 «있나» ⊕ 크기가 «0 이 아닌가» ⊕ 클릭을 «안 뺏나».***
 */
export function overlayProbeExpression(): string {
  return `(() => { try {
    const el = document.querySelector('[data-elanous-overlay]');
    if (!el) return JSON.stringify({ ok: false, reason: '오버레이가 DOM 에 «없다»' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ ok: true, width: Math.round(r.width), height: Math.round(r.height),
      pointerEvents: getComputedStyle(el).pointerEvents, text: (el.textContent || '').slice(0, 80) });
  } catch (e) { return JSON.stringify({ ok: false, reason: String(e).slice(0, 150) }); } })()`;
}

export interface OverlayVerdict {
  readonly verdict: 'ok' | 'missing' | 'zero-size' | 'steals-clicks' | 'unreadable';
  readonly detail?: string;
}

/** 🏷️ 오버레이 판정 — 순수. ⛔ 「못 읽었다」와 「없다」를 «다른 값»으로 둔다. */
export function interpretOverlayProbe(raw: unknown): OverlayVerdict {
  let parsed: { ok?: boolean; reason?: string; width?: number; height?: number; pointerEvents?: string; text?: string };
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) as typeof parsed : (raw as typeof parsed); }
  catch { return { verdict: 'unreadable', detail: '판정 문자열을 «못 읽었다»' }; }
  if (parsed === null || parsed === undefined) return { verdict: 'unreadable', detail: '판정이 «비었다»' };
  if (parsed.ok !== true) {
    return (parsed.reason ?? '').includes('«없다»')
      ? { verdict: 'missing', detail: parsed.reason ?? '' }
      : { verdict: 'unreadable', detail: parsed.reason ?? '' };
  }
  if (!(typeof parsed.width === 'number' && typeof parsed.height === 'number')) {
    return { verdict: 'unreadable', detail: '크기를 «못 읽었다»' };
  }
  // ⛔ 크기 0 은 「있다」가 아니다 — 주석 SVG 에서 이미 값을 치른 자리다(rect 0×0).
  if (parsed.width <= 0 || parsed.height <= 0) {
    return { verdict: 'zero-size', detail: `${parsed.width}×${parsed.height}` };
  }
  // ⛔ 클릭을 뺏으면 사람이 그 페이지를 «못 쓴다» — 우리 봇도 못 누른다.
  if (parsed.pointerEvents !== 'none') {
    return { verdict: 'steals-clicks', detail: String(parsed.pointerEvents ?? '') };
  }
  return { verdict: 'ok', detail: parsed.text ?? '' };
}

/** 차트에 물을 표현식. 순수 — 시험이 그 문자열을 «직접» 문다. */
export function probeExpression(wanted: readonly { time: number; price: number }[]): string {
  return `window.__elanousChartProbe ? window.__elanousChartProbe(${jsonForScriptTag(wanted)})`
    + ` : JSON.stringify({ ok: false, reason: '차트가 «아직» 안 떴다(또는 다른 페이지다)' })`;
}

/** 차트가 «한 말»을 읽는다. 순수. ⛔ 「못 읽었다」와 「못 풀었다」를 가른다. */
export function interpretProbe(raw: unknown): LwcProbe {
  if (typeof raw !== 'string') return { ok: false, reason: '차트가 «답을 안 냈다»' };
  try {
    const parsed = JSON.parse(raw) as LwcProbe;
    if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: '차트 답이 객체가 아니다' };
    return parsed;
  } catch {
    return { ok: false, reason: `차트 답이 JSON 이 아니다: ${raw.slice(0, 120)}` };
  }
}
