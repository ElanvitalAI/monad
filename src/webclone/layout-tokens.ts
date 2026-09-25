/**
 * layout-tokens.ts — ***간격·레이아웃*** 축. 52차부터 「씨앗에 «아예 없다»」로 이월돼 있었다.
 *
 * ⛔ 그리고 `design-md.ts` 가 그것을 «자기 입으로» 적어 뒀다:
 *    *"레이아웃 규칙 — 토큰에 없다. 그리드·간격은 역할 표의 박스와 화면으로 봐야 한다"*
 *    ⇒ 이 자가 그 칸을 연다.
 *
 * ⭐⭐ 규율은 팔레트와 «같다» — ***「선언된 변수」가 아니라 「실제로 «쓰인» 값」을 빈도로 센다.***
 *    (52차 §2 가 세 결함의 뿌리로 지목한 그것.)
 *
 * ⛔ 이 자가 답하는 것: 「이 페이지가 «어떤 간격 눈금»과 «어떤 폭»으로 서 있나」.
 * ⛔ 안 답하는 것: 「왜 그렇게 했나」·「반응형에서 어떻게 바뀌나」 — 아래 `LAYOUT_BLIND_SPOTS`.
 */

/** ⛔ 이 자가 원리상 «못 보는» 것. 결과에 «값으로» 실린다. */
export const LAYOUT_BLIND_SPOTS: readonly string[] = [
  'one-viewport: 한 폭(잰 뷰포트)에서만 봤다 — 반응형 분기는 «안 보인다»',
  'above-the-fold-only: 스크롤 전 화면만 계산된다 — 아래쪽 리듬은 다를 수 있다',
  'computed-not-authored: `clamp()`·`%`·`vw` 가 «풀린 px» 로 보인다 — 저자의 규칙이 아니라 «결과»다',
  'no-grid-template: 그리드 «틀»(줄·칸 이름)은 안 담는다 — 여기 있는 것은 «간격과 폭»뿐이다',
  'shadow-dom-closed: closed shadow root 안은 «안 보인다»',
];

export interface SpacingStep {
  readonly px: number;
  /** 이 값이 «실제로 걸린» 횟수 */
  readonly count: number;
  /** 이 값이 나온 자리 — padding·margin·gap */
  readonly kinds: readonly string[];
}

export interface ContainerWidth {
  readonly px: number;
  readonly count: number;
  /** 잰 뷰포트 폭 대비 비율 */
  readonly ratio: number;
}

export interface LayoutReport {
  readonly url: string;
  readonly viewport: { readonly w: number; readonly h: number };
  /** 빈도순 간격 눈금. ⛔ 빈 배열은 「간격이 없다」가 아니라 「하나도 못 봤다」다 — `sampled` 를 읽어라. */
  readonly spacing: readonly SpacingStep[];
  /** ⭐ 간격의 «기본 단위» 후보. ⛔ null 은 「못 골랐다」 — 0 이 아니다. */
  readonly baseUnit: number | null;
  readonly baseUnitReason: string;
  /** 본문이 실제로 차지한 폭(빈도순) */
  readonly containers: readonly ContainerWidth[];
  /** 형제 블록 사이 세로 간격(빈도순) — 「리듬」 */
  readonly verticalRhythm: readonly SpacingStep[];
  /** 훑은 요소 수. ⛔ 0 이면 위 목록의 「빈 배열」은 «못 쟀음»이다. */
  readonly sampled: number;
  readonly blindSpots: readonly string[];
}

/**
 * ⭐ 기본 단위 고르기 — ***가장 흔한 값이 아니라, 상위 값들을 «나누는» 수***.
 * ⛔ 후보를 못 고르면 `null` 을 낸다. 「4」로 «찍지» 않는다 — 8pt 격자가 아닌 사이트가 있다.
 */
export function pickBaseUnit(steps: readonly SpacingStep[]): { unit: number | null; reason: string } {
  const top = steps.filter((s) => s.px > 0).slice(0, 8);
  if (top.length < 3) return { unit: null, reason: `표본이 ${top.length}종뿐 — 눈금을 말할 근거가 없다` };

  // ⛔⭐ 후보를 «고정 목록»으로 두지 않는다 — 2026-09-10 🅕 실측:
  //    crates.io 의 간격이 9·18·27·36·54(9의 배수)였는데 내 목록엔 «9 가 없었다».
  //    ⇒ 자기가 아는 값만 찾는 자는 «모르는 격자»를 영영 못 본다.
  // ⛔⭐ 2·3 은 여전히 후보가 아니다 — 짝수는 거의 다 2 로 나뉜다(참이지만 «아무 말도 안 한다»).
  const candidates: { unit: number; hits: number }[] = [];
  for (let unit = 4; unit <= 32; unit += 1) {
    candidates.push({ unit, hits: top.filter((s) => s.px % unit === 0).length });
  }
  // ⭐ 커버리지가 같으면 «큰 쪽»이 더 많은 것을 말한다(8 이 4 보다 정보가 많다)
  const best = candidates.reduce((a, b) => (b.hits > a.hits || (b.hits === a.hits && b.unit > a.unit) ? b : a));
  const ratio = best.hits / top.length;
  const pct = Math.round(ratio * 100);

  if (ratio >= 0.75) {
    return { unit: best.unit, reason: `상위 ${top.length}종 중 ${best.hits}종(${pct}%)이 ${best.unit}px 의 배수다` };
  }
  // ⛔ 눈금이라 «부르지 않는다». 그러나 「아무것도 못 봤다」와 「가장 잘 맞는 후보가 이것뿐이다」는 다른 값이다.
  return {
    unit: null,
    reason: best.hits >= 2
      ? `⚪ 눈금이라 부를 만한 것이 «없다» — 가장 잘 맞는 후보는 ${best.unit}px 이지만 상위 ${top.length}종 중 ${best.hits}종(${pct}%)뿐이다`
        + ` (여러 계열이 섞였거나 clamp·rem 유동 간격이다)`
      : `⚪ 상위 ${top.length}종을 «공통으로 나누는» 수(4 이상)를 못 찾았다 — 격자가 없거나 내가 못 봤다`,
  };
}

/**
 * 페이지 «안»에서 돌 표현식.
 * ⛔ 반환은 «JSON 문자열» — 이 저장소의 같은 계약(`computed-tokens.ts`)을 따른다.
 */
export function buildLayoutExpression(limits = { elements: 4000, steps: 14 }): string {
  return `(() => {
  const px = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? Math.round(n) : null; };
  const bump = (map, key, kind) => {
    const cur = map.get(key) || { count: 0, kinds: new Set() };
    cur.count += 1; cur.kinds.add(kind); map.set(key, cur);
  };
  const spacing = new Map();
  const widths = new Map();
  const rhythm = new Map();
  const all = [...document.querySelectorAll('body *')].slice(0, ${limits.elements});
  let sampled = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    sampled += 1;
    for (const [kind, props] of [
      ['padding', ['padding-top','padding-right','padding-bottom','padding-left']],
      ['margin',  ['margin-top','margin-bottom']],
      ['gap',     ['row-gap','column-gap']],
    ]) {
      for (const prop of props) {
        const v = px(cs.getPropertyValue(prop));
        if (v === null || v <= 0 || v > 400) continue;   // 0 은 «간격이 아니고», 400 초과는 레이아웃이 아니라 여백 덩어리
        bump(spacing, v, kind);
      }
    }
    // 본문 폭 후보 — 글자를 «직접» 담은 블록만(래퍼는 뺀다)
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 20);
    if (hasOwnText && r.width > 120 && r.width <= innerWidth) bump(widths, Math.round(r.width), 'text-block');
  }
  // 세로 리듬 — 형제 블록 사이의 «실제» 간격
  for (const parent of all) {
    const kids = [...parent.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect();
      const b = kids[i].getBoundingClientRect();
      const gapPx = Math.round(b.top - a.bottom);
      if (gapPx > 0 && gapPx <= 400) bump(rhythm, gapPx, 'sibling');
    }
  }
  const top = (map, n) => [...map.entries()]
    .sort((x, y) => y[1].count - x[1].count || x[0] - y[0])
    .slice(0, n)
    .map(([value, v]) => ({ px: value, count: v.count, kinds: [...v.kinds].sort() }));
  return JSON.stringify({
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight },
    spacing: top(spacing, ${limits.steps}),
    containers: top(widths, 6).map((w) => ({ px: w.px, count: w.count, ratio: Math.round(w.px / innerWidth * 1000) / 1000 })),
    verticalRhythm: top(rhythm, 8),
    sampled,
  });
})()`;
}

/** ⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다 — `null` 을 내고 부르는 쪽이 「못 쟀다」를 적게 한다. */
/**
 * ⭐ 본문 폭은 «몇 px 씩» 흔들린다(517 ↔ 513 은 같은 칸이다). ±2% 안이면 묶는다.
 * ⛔ 묶을 때 «가장 흔한 쪽»의 px 를 대표로 쓴다 — 평균을 내면 «아무 데도 없는 값»이 나온다.
 */
export function clusterContainers(list: readonly ContainerWidth[], tolerance = 0.02): ContainerWidth[] {
  const out: ContainerWidth[] = [];
  for (const item of [...list].sort((a, b) => b.count - a.count)) {
    const hit = out.find((o) => Math.abs(o.px - item.px) / Math.max(1, o.px) <= tolerance);
    if (hit) {
      const merged: ContainerWidth = { px: hit.px, count: hit.count + item.count, ratio: hit.ratio };
      out[out.indexOf(hit)] = merged;
    } else {
      out.push(item);
    }
  }
  return out.sort((a, b) => b.count - a.count || b.px - a.px);
}

export function parseLayout(raw: unknown): LayoutReport | null {
  if (typeof raw !== 'string') return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof o.url !== 'string' || typeof o.sampled !== 'number') return null;
  const arr = <T,>(v: unknown): readonly T[] => (Array.isArray(v) ? (v as T[]) : []);
  const spacing = arr<SpacingStep>(o.spacing);
  const base = pickBaseUnit(spacing);
  const vp = (o.viewport ?? {}) as { w?: unknown; h?: unknown };
  return {
    url: o.url,
    viewport: { w: typeof vp.w === 'number' ? vp.w : 0, h: typeof vp.h === 'number' ? vp.h : 0 },
    spacing,
    baseUnit: base.unit,
    baseUnitReason: base.reason,
    containers: clusterContainers(arr<ContainerWidth>(o.containers)),
    verticalRhythm: arr<SpacingStep>(o.verticalRhythm),
    sampled: o.sampled,
    blindSpots: LAYOUT_BLIND_SPOTS,
  };
}

/** DESIGN.md 의 `## Layout` 절. ⛔ 「0」 옆에 «왜 0일 수 있는지»를 둔다. */
export function renderLayoutSection(report: LayoutReport | null): string[] {
  const L = ['## Layout — 간격·폭 (⛔ 「선언된 변수」가 아니라 «실제로 걸린» 값의 빈도다)', ''];
  if (report === null) {
    L.push('⚪ 레이아웃을 **못 쟀다** — 추출이 실패했다. ⛔ 「간격이 없다」가 «아니다».');
    return L;
  }
  L.push(`> 훑은 요소 ${report.sampled}개 · 잰 뷰포트 ${report.viewport.w}×${report.viewport.h}`);
  L.push('');
  if (report.sampled === 0) {
    L.push('⚪ 훑은 요소가 **0개**다 — 아래 목록의 「없음」은 «못 쟀음»이다.');
    L.push('');
  }
  L.push(report.baseUnit === null
    ? `- 기본 단위: ⚪ **못 골랐다** — ${report.baseUnitReason}`
    : `- 기본 단위: **${report.baseUnit}px** — ${report.baseUnitReason}`);
  L.push('');
  L.push('### 간격 눈금 (빈도순)');
  L.push('');
  L.push(report.spacing.length
    ? report.spacing.map((s) => `- ${s.px}px — ${s.count}회 (${[...s.kinds].sort().join('·')})`).join('\n')
    : '⚪ 하나도 «못 봤다** — 위 「훑은 요소」 수를 읽어라.');
  L.push('');
  L.push('### 본문 폭 (글자를 직접 담은 블록)');
  L.push('');
  L.push(report.containers.length
    ? report.containers.map((c) => `- ${c.px}px — ${c.count}회 (뷰포트의 ${(c.ratio * 100).toFixed(0)}%)`).join('\n')
    : '⚪ 글자를 «직접» 담은 블록을 못 찾았다 — 모두 래퍼 안에 있을 수 있다.');
  L.push('');
  L.push('### 세로 리듬 (형제 블록 사이)');
  L.push('');
  L.push(report.verticalRhythm.length
    ? report.verticalRhythm.map((s) => `- ${s.px}px — ${s.count}회`).join('\n')
    : '⚪ 형제 간격을 못 봤다.');
  L.push('');
  L.push('> ⛔ 이 절이 «못 보는» 것:');
  for (const spot of report.blindSpots) L.push(`> - ${spot}`);
  return L;
}


/**
 * 씨앗 문서의 `### 간격 눈금` 절을 «되읽는다».
 *
 * ⛔⭐ 왜 «되읽나» — `RESULT-21` 의 교훈이다: ***씨앗 쪽과 페이지 쪽을 «같은 자»로 재야 한다.***
 *    씨앗은 「면적/빈도로 고른 값」인데 페이지를 «다른 방법»으로 재면 어긋남이 구조적으로 난다.
 * ⛔ 못 읽으면 `null` — 빈 배열이 «아니다». 「간격 0종」과 「절이 없다」는 다른 값이다.
 */
export function readSeedSpacing(seed: string): readonly SpacingStep[] | null {
  const heading = /^###\s+간격 눈금[^\n]*$/m.exec(seed);
  if (heading === null) return null;
  const body = seed.slice(heading.index + heading[0].length).split(/^#{1,6}\s/m, 1)[0];
  const rows = [...body.matchAll(/^-\s*(\d+)px\s*—\s*(\d+)회(?:\s*\(([^)]*)\))?/gm)];
  if (rows.length === 0) return null;
  return rows.map((m) => ({
    px: Number(m[1]),
    count: Number(m[2]),
    kinds: (m[3] ?? '').split('·').map((k) => k.trim()).filter(Boolean),
  }));
}
