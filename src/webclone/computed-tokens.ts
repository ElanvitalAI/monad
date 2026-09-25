// ── computed-style 토큰 추출 — «진짜» method B (2026-09-08) ────────────────────
//
// ⛔⭐ 왜 있나: `webclone-decompose.ts` 는 CSS «문자열»을 정규식으로 읽는다. 그래서
//    ***cascade 를 못 푼다*** — 어느 규칙이 이겼는지 모르고, `var()` 도 안 푼다.
//    그 한계를 그 파일이 스스로 `unresolved: ['cascade-order']` 로 «매번» 신고한다.
//    ⇒ 이 파일이 그 칸을 닫는다. 브라우저가 «이미 계산해 둔» 값을 받아온다.
//
// 🔑 그리고 이것이 웹 클론 문헌이 말하는 ***「B: DOM/CSS 추출」의 본체***다 —
//    「픽셀값이 정확하다」는 주장은 정규식이 아니라 `getComputedStyle` 을 전제한다.
//    📏 실측 2026-09-08: 정규식 판으로 재구축한 페이지는 토큰이 옳았는데도 픽셀이 18.87% 벌어졌다.
//
// 원칙:
//   • ⭐ 페이지에서 «돌 코드»는 이 파일의 «상수»다 — 그래야 시험이 문자열로 물 수 있고,
//     브라우저 없이도 「무엇을 묻는지」가 리뷰된다.
//   • ⛔ 추측 0 — 못 읽은 축은 `null`. 요소가 없으면 `missing` 에 «이름»으로.
//   • ⛔ 이 파일은 브라우저를 «안 띄운다». 실행은 `scripts/webclone/extract-computed.ts`.

/** 뽑을 자리 — 「역할 → 선택자」. ⛔ 선택자가 없으면 «지어내지 않고» missing 에 담는다. */
export const COMPUTED_PROBES: ReadonlyArray<readonly [role: string, selector: string]> = [
  ['body', 'body'],
  ['h1', 'h1'],
  ['h2', 'h2'],
  ['h3', 'h3'],
  ['link', 'a'],
  ['button', 'button, .btn, [role="button"]'],
  ['header', 'header, .site-header'],
  ['footer', 'footer'],
];

/** 각 자리에서 읽을 프로퍼티. ⭐ 「디자인을 재현하는 데 필요한 것」만 — 전부 읽으면 노이즈다. */
export const COMPUTED_PROPERTIES: readonly string[] = [
  'color', 'background-color', 'font-family', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'border-radius', 'padding', 'margin',
];

/**
 * 페이지 «안»에서 돌 표현식.
 *
 * ⭐⭐ 커스텀 프로퍼티는 Chrome 111+ 에서 `getComputedStyle(el)` 을 순회하면 나온다 —
 *    ⛔ `getPropertyValue('--x')` 는 «이름을 이미 알 때»만 쓴다. 이름을 «발견»하려면 순회해야 한다.
 * ⛔ 반환은 «JSON 문자열»이다 — CDP `Runtime.evaluate` 가 깊은 객체를 온전히 안 돌려줄 수 있다.
 */
export function buildExtractionExpression(
  probes: typeof COMPUTED_PROBES = COMPUTED_PROBES,
  properties: readonly string[] = COMPUTED_PROPERTIES,
): string {
  const probeJson = JSON.stringify(probes.map(([role, selector]) => ({ role, selector })));
  const propJson = JSON.stringify(properties);
  return `(() => {
  const probes = ${probeJson};
  const props = ${propJson};
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const customProperties = {};
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i];
    if (name.startsWith('--')) customProperties[name] = rootStyle.getPropertyValue(name).trim();
  }
  const roles = {};
  const diagnostics = {};
  const missing = [];
  // ⭐ 「글자를 «직접» 담았나」 — 자식이 담은 것은 «그 자식»의 색이다.
  //    🩸 2026-09-11: 이 필터가 색 수집에 «없어서» <html>·<head>·<script> 의 기본 검정이
  //    「칠한 색」으로 셌다(정확히 14회 = head 안 12 + html + head).
  const hasOwnText = (el) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim().length > 0) return true;
    }
    return false;
  };
  const isRenderedVisible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.contentVisibility === 'hidden' || Number.parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  for (const p of probes) {
    const candidates = Array.from(document.querySelectorAll(p.selector));
    const visible = candidates.filter((el) => isRenderedVisible(el, getComputedStyle(el)));
    // ⛔⭐⭐⭐ 「문서 첫 번째」를 잡으면 ***네비 라벨·건너뛰기 링크가 「본문 제목」이 된다.***
    //    📏 2026-09-10 열 대상 전수: 위계가 «불가능»한 대상이 6/10 이었다
    //    (starbucks h1=h2=body=16px · apple h2 64px > h1 34px).
    // 🔑 ⇒ 역할의 «모양»은 그 역할이 ***가장 흔히 입는 모양***이다. 빈도로 고른다.
    //    ⛔ 동점이면 «면적이 큰 쪽» — 같은 빈도면 더 두드러진 것이 그 역할의 얼굴이다.
    const groups = {};
    for (const el of visible) {
      const cs2 = getComputedStyle(el);
      const k = cs2.fontSize + '|' + cs2.fontWeight;
      const r2 = el.getBoundingClientRect();
      if (!groups[k]) groups[k] = { count: 0, area: 0, first: el };
      groups[k].count += 1;
      groups[k].area += r2.width * r2.height;
    }
    let winner = null;
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      if (winner === null || g.count > winner.count || (g.count === winner.count && g.area > winner.area)) winner = g;
    }
    const selected = winner ? winner.first : null;
    diagnostics[p.role] = {
      matched: candidates.length,
      visible: visible.length,
      selected: selected ? candidates.indexOf(selected) : null,
      // ⛔ 「몇 개가 이 모양인가」를 «낸다» — 1/40 이면 읽는 쪽이 의심할 수 있다.
      styleGroups: Object.keys(groups).length,
      chosenCount: winner ? winner.count : 0,
    };
    if (!selected) { missing.push(p.role); continue; }
    const cs = getComputedStyle(selected);
    const out = {};
    for (const prop of props) out[prop] = cs.getPropertyValue(prop).trim() || null;
    const r = selected.getBoundingClientRect();
    out['__box'] = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    roles[p.role] = out;
  }
  let paintedColors;
  try {
    const backgrounds = {};
    const text = {};
    const strokes = {};   // ⭐ 획 — 테두리·아웃라인. 배경·글자와 «다른» 모집단이다.
    const add = (counts, value) => { counts[value] = (counts[value] || 0) + 1; };
    const alphaIsZero = (value) => {
      const normalized = value.trim();
      return /^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?%?$/i.test(normalized)
        && Number.parseFloat(normalized) === 0;
    };
    const transparent = (value) => {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'transparent') return true;
      if (!/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\(/.test(normalized)) return false;
      const slashAlpha = normalized.match(/\\/\\s*([^\\s/)]+)\\s*\\)$/)?.[1];
      if (slashAlpha !== undefined) return alphaIsZero(slashAlpha);
      const commaComponents = normalized.slice(normalized.indexOf('(') + 1, -1).split(',').map((component) => component.trim());
      return commaComponents.length === 4 && alphaIsZero(commaComponents[3]);
    };
    // ⛔⭐⭐ 2026-09-10 실측 — ***모집단이 「배경·글자」뿐이라 «테두리 전용» 토큰이 영영 안 잡혔다.***
    //    씨앗이 선언하고 화면이 border-left·outline 에 «실제로 쓰는» 색인데
    //    준수 검사는 「선언했는데 안 칠했다」는 «참인데 틀린» 어긋남을 냈다.
    // ✅ 획(stroke) 을 «세 번째 모집단»으로 센다 — 배경·글자와 «섞지 않는다»(뜻이 다르다).
    // ⛔ 보이는 것만 — 폭 0 이거나 style:none 이면 브라우저가 기본색을 주므로 세면 «쏟아진다».
    // ⛔⭐⭐ 국소 바탕 — 「그 색이 «무엇 위에» 놓였나」.
    //    🩸 RESULT-27 이 ⚪ 로 적어 둔 칸: 지금까지 알파를 «페이지 바탕 하나» 위에만 폈다.
    //       카드(흰색) 위의 rgba 와 페이지(아이보리) 위의 rgba 는 «다른 색»으로 보이는데 같게 읽혔다.
    //    ✅ 요소마다 «가장 가까운 불투명 조상 배경»을 찾아 그 위에 편다.
    //    ⛔ 못 찾으면 null — 흰색으로 «몰지» 않는다.
    // ⛔⭐ 정규식을 «안 쓴다» — 이 문자열은 템플릿 리터럴이라 백슬래시가 먹히고,
    //    그러면 「문법상 유효한 다른 정규식」이 되거나 아예 안 파싱된다(오늘 네 번째다).
    //    ✅ 문자열 연산만으로 알파를 읽는다.
    const alphaOf = (value) => {
      const v = String(value || '').trim();
      if (v === '') return 0;
      const open = v.indexOf('(');
      if (open === -1) return 1;                       // 이름 색·hex → 불투명으로 본다
      const inner = v.slice(open + 1, v.lastIndexOf(')'));
      const slash = inner.lastIndexOf('/');
      if (slash !== -1) {
        const a = inner.slice(slash + 1).trim();
        const n = a.charAt(a.length - 1) === '%' ? parseFloat(a) / 100 : parseFloat(a);
        return Number.isFinite(n) ? n : 1;
      }
      const parts = inner.split(',');
      if (parts.length === 4) { const n = parseFloat(parts[3]); return Number.isFinite(n) ? n : 1; }
      return 1;
    };
    const opaqueBg = (value) => !transparent(value) && alphaOf(value) >= 1;
    const groundOf = (el) => {
      // ⛔ 조상을 «못 걷는» 환경이 있다(시험 하네스의 가짜 DOM 등).
      //    그때 답은 「못 찾았다」(null)다 — 흰색으로 «몰지» 않고, 여기서 «전체를 죽이지도» 않는다.
      try {
        let node = el && el.parentElement ? el.parentElement : null;
        let hops = 0;
        while (node && hops < 64) {
          const bg = getComputedStyle(node).backgroundColor;
          if (opaqueBg(bg)) return bg;
          node = node.parentElement;
          hops += 1;
        }
      } catch (e) { void e; }
      return null;
    };
    const hasAlpha = (value) => value && !transparent(value) && !opaqueBg(value);
    const alphaOver = {};   // 알파색 → { 국소 바탕 → 횟수 }
    const noteOver = (color, el) => {
      const g = groundOf(el);
      if (g === null) return;
      const slot = alphaOver[color] || (alphaOver[color] = {});
      slot[g] = (slot[g] || 0) + 1;
    };
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const drawn = (width, style) => style !== 'none' && style !== 'hidden' && parseFloat(width) > 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      // ⛔⭐ 🩸 2026-09-11 — ***안 보이는 요소와 «글자를 안 담은» 요소를 「칠했다」로 세지 않는다.***
      //    실측: 자작 13개 중 11개가 rgb(0,0,0) 을 «정확히 14회» 냈고,
      //    그 14 는 ***html ⊕ head ⊕ head 안 12개***였다 — 화면에 글자를 «하나도» 안 낸다.
      //    ⇒ 그 값들이 「토큰 밖 색」으로도, conform 의 「칠했다」로도 셌다.
      const shown = isRenderedVisible(el, cs);
      if (shown && !transparent(cs.backgroundColor)) add(backgrounds, cs.backgroundColor);
      if (shown && hasOwnText(el)) add(text, cs.color);
      if (hasAlpha(cs.backgroundColor)) noteOver(cs.backgroundColor, el);
      if (hasAlpha(cs.color)) noteOver(cs.color, el);
      for (const side of sides) {
        if (!drawn(cs['border' + side + 'Width'], cs['border' + side + 'Style'])) continue;
        const c = cs['border' + side + 'Color'];
        if (!transparent(c)) add(strokes, c);
      }
      if (drawn(cs.outlineWidth, cs.outlineStyle) && !transparent(cs.outlineColor)) add(strokes, cs.outlineColor);
    }
    const frequencies = (counts) => Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const overs = Object.keys(alphaOver).map((color) => ({
      value: color,
      grounds: Object.keys(alphaOver[color]).map((g) => ({ value: g, count: alphaOver[color][g] }))
        .sort((a, b) => b.count - a.count),
    }));
    paintedColors = {
      backgrounds: frequencies(backgrounds), text: frequencies(text), strokes: frequencies(strokes),
      alphaOver: overs,
    };
  } catch { paintedColors = null; }
  // ⭐⭐ 활자 «눈금» — 실제로 «글자를 담은» 보이는 요소의 크기·굵기 빈도.
  // 🩸 왜 생겼나(2026-09-10 열 대상 전수): 역할 표(h1·h2…)는 «DOM 제목 «단계»»를 잰다.
  //    그런데 ***현대 마케팅 페이지에서 제목 단계는 시각 크기를 따라가지 않는다*** —
  //    열 중 «여섯»에서 「h2 가 h1 보다 크다」류가 나왔고, 그것은 오류가 아니라 «그 페이지의 사실»이었다.
  // 🔑 ⇒ 다시 지을 때 따라야 할 것은 «태그 순서»가 아니라 ***실제로 쓰인 크기의 사다리***다.
  let typeScale;
  try {
    const counts = {};
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (!hasOwnText(el)) continue;
      const cs = getComputedStyle(el);
      if (!isRenderedVisible(el, cs)) continue;
      const k = cs.fontSize + '|' + cs.fontWeight;
      counts[k] = (counts[k] || 0) + 1;
    }
    typeScale = Object.keys(counts)
      .map((k) => ({ size: parseFloat(k.split('|')[0]), weight: k.split('|')[1], count: counts[k] }))
      .filter((r) => isFinite(r.size) && r.size > 0)
      .sort((a, b) => b.size - a.size || b.count - a.count);
  } catch { typeScale = null; }

  // 기본 상태에서만 잰다. 가리킴·누름 등 상태 전환과 키프레임 내용은 이 추출 범위 밖이다.
  let transitions;
  try {
    const count = {};
    let elementCount = 0;
    const splitTransitionList = (text) => {
      const values = [];
      let start = 0;
      let depth = 0;
      for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '(') depth += 1;
        else if (text[index] === ')') depth = Math.max(0, depth - 1);
        else if (text[index] === ',' && depth === 0) {
          values.push(text.slice(start, index).trim());
          start = index + 1;
        }
      }
      values.push(text.slice(start).trim());
      return values.filter(Boolean);
    };
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const durations = splitTransitionList(cs.transitionDuration);
      const easings = splitTransitionList(cs.transitionTimingFunction);
      const properties = splitTransitionList(cs.transitionProperty);
      const active = properties.flatMap((property, index) => {
        const duration = durations[index % durations.length];
        const value = Number.parseFloat(duration);
        return property !== 'none' && Number.isFinite(value) && value > 0
          ? [{ duration, easing: easings[index % easings.length], property }] : [];
      });
      if (active.length === 0) continue;
      elementCount += 1;
      const add = (kind, values) => {
        for (const value of new Set(values)) {
          const key = kind + ':' + value;
          count[key] = (count[key] || 0) + 1;
        }
      };
      add('duration', active.map((entry) => entry.duration));
      add('easing', active.map((entry) => entry.easing));
      add('property', active.map((entry) => entry.property));
    }
    const frequencies = (kind) => Object.entries(count)
      .filter(([key]) => key.startsWith(kind + ':'))
      .map(([key, count]) => ({ value: key.slice(kind.length + 1), count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    transitions = { status: elementCount === 0 ? 'none' : 'measured', elementCount,
      durations: frequencies('duration'), easings: frequencies('easing'), properties: frequencies('property'),
      limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음' };
  } catch {
    transitions = { status: 'unreadable', limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음' };
  }
  return JSON.stringify({
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight },
    customProperties,
    roles,
    typeScale,
    diagnostics,
    missing,
    paintedColors,
    transitions,
    // ⛔ 이 둘은 «다른 축»이다 — 2026-09-08 에 한 이름이 둘을 덮고 있었다.
    browserForcedReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    honoursReducedMotion: (() => {
      // 페이지 CSS 가 그 미디어 질의를 «가지고 있나». ⛔ 못 읽으면 null — 「없다」로 몰지 않는다.
      let readable = 0, unreadable = 0, hit = false;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules; readable += 1;
          for (const rule of Array.from(rules)) {
            if (String(rule.conditionText || (rule.media && rule.media.mediaText) || '').includes('prefers-reduced-motion')) hit = true;
          }
        } catch { unreadable += 1; }
      }
      return hit ? true : (unreadable > 0 && readable === 0 ? null : false);
    })(),
  });
})()`;
}

export interface ComputedBox { readonly w: number; readonly h: number; readonly x: number; readonly y: number }
export interface ComputedRole { readonly [prop: string]: string | null | ComputedBox }

/** 활자 눈금 한 칸 — 「이 크기·굵기를 «몇 개»가 입었나」. */
export interface TypeScaleStep {
  readonly size: number;
  readonly weight: string;
  readonly count: number;
}

export interface TransitionFrequency { readonly value: string; readonly count: number }
export interface PaintedColorFrequency { readonly value: string; readonly count: number }
export interface PaintedColors {
  readonly backgrounds: readonly PaintedColorFrequency[];
  readonly text: readonly PaintedColorFrequency[];
  /**
   * ⭐ 획 — 보이는 «테두리·아웃라인» 색. 배경·글자와 «다른» 모집단이다.
   * ⛔ 선택적인 이유: 이 칸이 «없는» 옛 산출을 던지지 않는다(이 저장소가 이미 못 박은 불변식).
   * 🩸 왜 생겼나(2026-09-10): 씨앗이 선언하고 화면이 `border-left`·`outline` 에 «실제로 쓰는» 색인데
   *    모집단이 배경·글자뿐이라 준수 검사가 「안 칠했다」는 «참인데 틀린» 어긋남을 냈다.
   */
  readonly strokes?: readonly PaintedColorFrequency[];
  /**
   * ⭐⭐ 알파색이 «무엇 위에» 놓였나 — 요소마다 «가장 가까운 불투명 조상 배경».
   * 🩸 `RESULT-27` 이 ⚪ 로 적어 둔 칸: 지금까지 알파를 «페이지 바탕 하나» 위에만 폈다.
   *    카드(흰색) 위의 rgba 와 페이지(아이보리) 위의 rgba 는 «다른 색»인데 같게 읽혔다.
   * ⛔ 한 색이 «여러» 바탕 위에 있으면 그것을 «목록으로» 낸다 — 조용히 하나를 고르지 않는다.
   */
  readonly alphaOver?: readonly AlphaOverGround[];
}

/** 알파색 하나와 그것이 놓인 바탕«들». */
export interface AlphaOverGround {
  readonly value: string;
  readonly grounds: readonly PaintedColorFrequency[];
}

/**
 * ⛔⭐ 활자 «위계» 위반 — 52차 실측표의 «첫 줄»이 이것이었다:
 *    ***`h2 13px < body 16px < h3 19px`*** — 불가능한 위계다.
 *
 * ⛔⭐⭐ ***재고 «말할» 뿐, «보정하지 않는다».***
 *    보정하면 「그럴듯한 표」가 나오고, 보는 사람은 씨앗이 «틀렸다»는 것을 영영 못 본다.
 *    (원인은 `querySelector` 가 «문서 첫 번째»를 잡는 것 — 좌측 네비 라벨이 h2 가 된다.
 *     그 원인을 고치는 것은 «다른 축»이고, 이 자는 「이 표는 불가능하다」만 낸다.)
 */
export interface TypographyWarning {
  readonly role: string;
  readonly violation: 'not-larger-than-body' | 'not-smaller-than-previous-heading';
}

function fontSizeOf(role: ComputedRole | undefined): number | null {
  const value = role?.['font-size'];
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * ⭐ computed `font-weight` 를 «수»로. ⛔ 못 읽으면 `null` — 400 으로 «채우지 않는다».
 *    (computed 값은 보통 숫자지만 `normal`·`bold` 로 오는 판이 있다.)
 */
function fontWeightOf(role: ComputedRole | undefined): number | null {
  const value = role?.['font-weight'];
  if (typeof value !== 'string') return null;
  if (value === 'normal') return 400;
  if (value === 'bold') return 700;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 관측된 역할 표에서 «불가능한 위계»만 신고한다.
 * ⛔ 크기를 «못 읽은» 역할은 «건너뛴다» — 「위반 없음」으로도 「위반」으로도 세지 않는다.
 * ⛔ 빈 배열은 「위반 없음」이지 「안 쟀음」이 «아니다» — 못 잰 역할은 애초에 표에 없다.
 */
export function analyseTypographyHierarchy(roles: Readonly<Record<string, ComputedRole>>): TypographyWarning[] {
  const warnings: TypographyWarning[] = [];
  const body = fontSizeOf(roles.body);
  const bodyWeight = fontWeightOf(roles.body);
  let previousHeadingSize: number | null = null;
  // ⛔ 「앞선 제목의 굵기」 — 크기와 «짝»으로 봐야 위계가 선 것을 안다.
  let lastHeadingWeight: number | null = null;
  for (const role of ['h1', 'h2', 'h3']) {
    const size = fontSizeOf(roles[role]);
    if (size === null) continue;
    // ⛔⭐⭐ 🩸 2026-09-11 — ***이 자가 «한 축»(크기)만 보고 판정해서 상용 사이트를 틀리게 읽었다.***
    //    📏 레퍼런스 8개 실측: 위계 경고를 내는 것이 ***6개 중 5개***였다.
    //    그중 `not-larger-than-body` 를 받은 둘(airbnb · youtube)은 «같은 모양»이었다 —
    //      airbnb   body 14px/400 · h3 14px/**500**
    //      youtube  body 16px/400 · h3 16px/**500**
    //    ⇒ ***크기가 같고 «굵기로» 가르는 것은 상용 디자인의 «관행»이다.*** 화면에서 구별된다.
    //    ⚠️ 실측이 말하는 것은 「상용 2/2 가 그렇게 한다」까지다 — 그 관행이 «옳은가»는 디자인 판단이다.
    //    ⛔ 그래서 면제는 «같은 크기 ⊕ 더 굵다» 한 칸뿐이다.
    //       「본문보다 «작다»」는 면제하지 않는다 — 13+8 표본에 그런 제목이 «하나도 없어» 근거가 없다.
    const sameSizeButHeavier = body !== null && size === body
      && bodyWeight !== null && (fontWeightOf(roles[role]) ?? 0) > bodyWeight;
    if (body !== null && size <= body && !sameSizeButHeavier) warnings.push({ role, violation: 'not-larger-than-body' });
    // ⛔⭐⭐ 2026-09-11 — ***「본문 대비」에서 받아들인 원리의 «대칭»을 여기에도 적용한다.***
    //    위계는 크기 «또는» 굵기로 선다. 앞선 제목과 ***크기가 같아도 «더 가벼우면» 위계가 «선다».***
    //    📏 실측(레퍼런스 8): `netflix h2 24px/500 → h3 24px/400` — 화면에서 갈린다.
    //    ⛔ 유지되는 둘은 «진짜»다 — `starbucks h1 16/700 → h2 16/700`(굵기도 같다) ·
    //       `spotify h1 16/700 → h2 24/700`(오히려 «더 크다»).
    //    ⚠️ ***이 면제를 뒷받침하는 표본은 «하나»다***(netflix). 55차가 같은 이유로 미뤘던 칸이고,
    //       이제 상용 8개를 재서 3건 중 1건만 면제됨을 확인했다. ⛔ 자작 13개에는 «영향 0» 이다.
    //       ⇒ 반례를 만나면 «다시 재라».
    const previousHeadingWeight = previousHeadingSize === null ? null : lastHeadingWeight;
    const weight = fontWeightOf(roles[role]);
    const sameSizeButLighter = previousHeadingSize !== null && size === previousHeadingSize
      && previousHeadingWeight !== null && weight !== null && weight < previousHeadingWeight;
    if (previousHeadingSize !== null && size >= previousHeadingSize && !sameSizeButLighter) {
      warnings.push({ role, violation: 'not-smaller-than-previous-heading' });
    }
    previousHeadingSize = size;
    lastHeadingWeight = weight;
  }
  return warnings;
}

/** 역할 선택 관측 — 매칭·렌더링-가시 후보·그중 선택한 원본 인덱스를 각각 보존한다. */
export interface ComputedRoleDiagnostics {
  readonly matched: number;
  readonly visible: number;
  readonly selected: number | null;
  /**
   * ⛔⭐ 「보이는 것 중 «몇 종»의 모양이 있었나」 ⊕ 「고른 모양을 «몇 개»가 입었나」.
   * 🔑 `chosenCount` 가 1 이고 `visible` 이 40 이면 그 값은 «대표»가 아니다 — 읽는 쪽이 의심할 수 있게 낸다.
   * ⚪ 옛 산출에는 «없다» — 그래서 optional 이고, 없으면 「못 쟀음」이지 「1종」이 아니다.
   */
  readonly styleGroups?: number;
  /**
   * ⛔⭐⭐ ***이 값은 «비율»이 아니라 «개수»다*** — 고른 모양을 «몇 개»가 입었나.
   * 🩸 2026-09-11: 옛 이름이 `chosenShare` 였고, ***그 이름 때문에 내가 «비율»로 읽어***
   *    `site-health` 의 한 축이 ***152 표본에서 «0건»*** 이 됐다(퇴화 검사 ⓐ — 항상 같은 값).
   *    📏 실제 분포: `vis>0` 인 137개가 ***전부 1*** 이었다(대부분 역할이 «모양 1종»이다).
   * ⛔ 옛 산출의 `chosenShare` 도 «받는다» — 파서가 이 이름으로 옮긴다(옛 것을 던지지 않는다).
   */
  readonly chosenCount?: number;
}

/** 기본 상태의 computed transition 측정. `none`과 `unreadable`은 의도적으로 다른 값이다. */
export type ComputedTransitions =
  | { readonly status: 'measured' | 'none'; readonly elementCount: number; readonly durations: readonly TransitionFrequency[]; readonly easings: readonly TransitionFrequency[]; readonly properties: readonly TransitionFrequency[]; readonly limitation: string }
  | { readonly status: 'unreadable'; readonly limitation: string };

export interface ComputedTokens {
  readonly url: string;
  readonly viewport: { readonly w: number; readonly h: number };
  /** ⭐ cascade 가 «이미 풀린» 값이다 — `var()` 도 해결돼 있다 */
  readonly customProperties: Readonly<Record<string, string>>;
  readonly roles: Readonly<Record<string, ComputedRole>>;
  /**
   * ⭐⭐ 실제로 «글자를 담은» 보이는 요소의 크기·굵기 사다리(큰 것부터).
   * 🔑 역할 표(`h1`·`h2`…)는 «DOM 제목 단계»를 재고, 이것은 ***실제로 쓰인 크기***를 잰다.
   *    열 대상 중 여섯에서 둘이 «어긋났다» — 그리고 그것은 오류가 아니라 그 페이지의 사실이었다.
   * ⚪ 옛 산출에는 «없다» — 없으면 「못 쟀음」이지 「빈 사다리」가 아니다.
   */
  readonly typeScale?: readonly TypeScaleStep[];
  /** 각 역할의 선택 관측. ⛔ 후보 수·가시성·선택 위치를 한 값으로 접지 않는다. */
  readonly diagnostics: Readonly<Record<string, ComputedRoleDiagnostics>>;
  /** 페이지에 «없던» 역할. ⛔ 빈 값으로 채우지 않는다 */
  readonly missing: readonly string[];
  /** 실제 요소에서 센 배경색과 글자색 빈도. null은 요소 순회를 못 한 측정 실패다. */
  readonly paintedColors: PaintedColors | null;
  /** ⛔ 대표 표를 «고치지 않고», 관측된 글자 크기 위계 위반만 담는다. */
  readonly typographyWarnings: readonly TypographyWarning[];
  /** 기본 상태에서 측정한 전환. 상태 전용 전환은 흉내 내지 않아 이 값에 없다. */
  readonly transitions: ComputedTransitions;
  /** 페이지 CSS 가 `prefers-reduced-motion` 을 «가지고 있나`. ⛔ 시트를 하나도 못 읽으면 **null** —
   *  「못 읽었다」와 「없다」는 다른 값이다(교차 출처 시트는 규칙을 안 준다). */
  readonly honoursReducedMotion: boolean | null;
  /** ⚠️ «측정 조건»이지 대상의 성질이 아니다 — 내 Chrome 이 강제 모드로 떴나.
   *  🩸 이 칸이 없던 동안 위 이름이 이 값을 담았고, 실행마다 ✅↔🔴 로 흔들려
   *  「페이지가 존중을 그만뒀다」처럼 «읽혔다». 그건 페이지가 아니라 «내 플래그»였다. */
  readonly browserForcedReducedMotion: boolean;
}

/** ⛔ 브라우저가 준 문자열을 «믿지 않고» 형태를 확인한다 — 실패는 null 이다(던지지 않는다). */
function parseRoleDiagnostics(value: unknown): Readonly<Record<string, ComputedRoleDiagnostics>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const diagnostics: Record<string, ComputedRoleDiagnostics> = {};
  for (const [role, item] of Object.entries(value)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    // ⛔ 옛 이름 `chosenShare` 도 받는다 — 이름만 틀렸고 «담긴 것은 개수»였다.
    const { matched, visible, selected, styleGroups } = entry;
    const chosenCount = entry.chosenCount ?? entry.chosenShare;
    if (typeof matched !== 'number' || !Number.isInteger(matched) || matched < 0
      || typeof visible !== 'number' || !Number.isInteger(visible) || visible < 0 || visible > matched
      || (selected !== null && (typeof selected !== 'number' || !Number.isInteger(selected) || selected < 0 || selected >= matched))
      || (selected === null && visible !== 0)
      || (typeof selected === 'number' && visible === 0)) return null;
    diagnostics[role] = {
      matched,
      visible,
      selected,
      // ⛔ 옛 산출은 이 둘을 안 준다 — 없으면 «넣지 않는다»(0 으로 몰면 「1종」과 「못 쟀음」이 섞인다).
      ...(typeof styleGroups === 'number' && Number.isInteger(styleGroups) && styleGroups >= 0 ? { styleGroups } : {}),
      ...(typeof chosenCount === 'number' && Number.isInteger(chosenCount) && chosenCount >= 0 ? { chosenCount } : {}),
    };
  }
  return diagnostics;
}

function parseTransitions(value: unknown): ComputedTransitions | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const limitation = typeof v.limitation === 'string' ? v.limitation : null;
  if (!limitation) return null;
  if (v.status === 'unreadable') return { status: 'unreadable', limitation };
  if (v.status !== 'measured' && v.status !== 'none') return null;
  const frequencies = (items: unknown): TransitionFrequency[] | null => Array.isArray(items)
    && items.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.value === 'string' && typeof entry.count === 'number'
        && Number.isInteger(entry.count) && entry.count > 0;
    })
    ? items as TransitionFrequency[] : null;
  const durations = frequencies(v.durations);
  const easings = frequencies(v.easings);
  const properties = frequencies(v.properties);
  const elementCount = v.elementCount;
  if (typeof elementCount !== 'number' || !Number.isInteger(elementCount) || elementCount < 0 || !durations || !easings || !properties) return null;
  const hasFrequencies = durations.length > 0 && easings.length > 0 && properties.length > 0;
  if ((v.status === 'measured' && (elementCount === 0 || !hasFrequencies))
    || (v.status === 'none' && (elementCount !== 0 || durations.length !== 0 || easings.length !== 0 || properties.length !== 0))) return null;
  return { status: v.status, elementCount, durations, easings, properties, limitation };
}

function parsePaintedColors(value: unknown): PaintedColors | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) return null;
  const frequencies = (items: unknown): PaintedColorFrequency[] | null => Array.isArray(items)
    && items.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.value === 'string' && typeof entry.count === 'number'
        && Number.isInteger(entry.count) && entry.count > 0;
    }) ? items as PaintedColorFrequency[] : null;
  const v = value as Record<string, unknown>;
  const backgrounds = frequencies(v.backgrounds);
  const text = frequencies(v.text);
  // ⛔⭐⭐ 2026-09-10 실측 — ***페이지는 획을 내는데 이 줄이 그것을 «버리고» 있었다.***
  //    수집을 더하고 타입을 더하고 소비 쪽까지 이었는데, ***파서 한 줄이 안 이어져***
  //    산출이 계속 `⚪획 못 쟀음` 이었다. 「있다」와 「닿는다」는 다른 값이다 — 또 밟았다.
  // ⛔ 없으면 `undefined`(= 「못 쟀음」), 모양이 틀려도 `undefined` — «지어내지» 않는다.
  const strokes = v.strokes === undefined ? undefined : (frequencies(v.strokes) ?? undefined);
  // ⛔⭐ 지난번에 «바로 이 자리»를 빠뜨려 수집·타입·소비가 다 참인데 산출이 0 이었다.
  //    네 자리(수집·타입·파서·소비)를 «같이» 잇는다.
  const alphaOver = ((): AlphaOverGround[] | undefined => {
    if (!Array.isArray(v.alphaOver)) return undefined;
    const out: AlphaOverGround[] = [];
    for (const item of v.alphaOver) {
      if (typeof item !== 'object' || item === null) return undefined;
      const e = item as Record<string, unknown>;
      const grounds = frequencies(e.grounds);
      if (typeof e.value !== 'string' || grounds === null) return undefined;
      out.push({ value: e.value, grounds });
    }
    return out;
  })();
  if (!backgrounds || !text) return null;
  const base = { backgrounds, text };
  return {
    ...base,
    ...(strokes === undefined ? {} : { strokes }),
    ...(alphaOver === undefined ? {} : { alphaOver }),
  };
}

/** ⛔ 모양이 안 맞는 칸은 «버린다» — 지어내지 않는다. */
function readTypeScale(raw: readonly unknown[]): TypeScaleStep[] {
  const out: TypeScaleStep[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size <= 0) continue;
    if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 0) continue;
    out.push({ size: r.size, weight: typeof r.weight === 'string' ? r.weight : '400', count: r.count });
  }
  return out;
}

export function parseExtraction(raw: unknown): ComputedTokens | null {
  const text = typeof raw === 'string' ? raw : null;
  if (text === null) return null;
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { return null; }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.url !== 'string') return null;
  const vp = o.viewport as { w?: unknown; h?: unknown } | undefined;
  if (!vp || typeof vp.w !== 'number' || typeof vp.h !== 'number') return null;
  const transitions = parseTransitions(o.transitions);
  const diagnostics = parseRoleDiagnostics(o.diagnostics);
  const paintedColors = parsePaintedColors(o.paintedColors);
  if (
    transitions === null
    || diagnostics === null
    || (paintedColors === null && o.paintedColors !== null && o.paintedColors !== undefined)
  ) return null;
  const roles = (o.roles ?? {}) as Record<string, ComputedRole>;
  return {
    url: o.url,
    viewport: { w: vp.w, h: vp.h },
    customProperties: (o.customProperties ?? {}) as Record<string, string>,
    roles,
    // ⛔ 「없다」와 「빈 사다리」를 가른다 — 옛 산출은 이 칸을 «안 준다».
    ...(Array.isArray(o.typeScale) ? { typeScale: readTypeScale(o.typeScale) } : {}),
    diagnostics,
    missing: Array.isArray(o.missing) ? (o.missing as string[]) : [],
    paintedColors,
    // ⛔ 표를 «고치지 않는다» — 불가능한 위계를 «신고»만 한다
    typographyWarnings: analyseTypographyHierarchy(roles),
    transitions,
    // ⛔ 3상태를 «둘로 접지» 않는다 — true/false/null 이 각각 다른 사실이다.
    honoursReducedMotion: o.honoursReducedMotion === true ? true
      : o.honoursReducedMotion === false ? false : null,
    browserForcedReducedMotion: o.browserForcedReducedMotion === true,
  };
}

/** 색 값만 골라 낸다 — 팔레트 후보. ⛔ 투명·상속값은 «뺀다»(디자인 결정이 아니다). */
export function paletteFrom(tokens: ComputedTokens): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(tokens.customProperties)) {
    if (/^(#|rgb|hsl|oklch|color\()/i.test(value)) out.push({ name, value });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * ⭐⭐ **정규식 판과 computed 판을 «대 본다»** — 이것이 「B 가 정말 정확한가」의 답이다.
 *
 * ⛔ 「같은 이름」이 아니라 «같은 값»으로 센다 — 토큰 이름은 내가 바꿔 붙이기 때문이다.
 */
export interface ExtractionComparison {
  readonly regexOnly: readonly string[];
  readonly computedOnly: readonly string[];
  readonly shared: readonly string[];
  /** computed 가 더 많이 찾았나 — 그것이 cascade 를 푼 값이다 */
  readonly computedFoundMore: boolean;
}

export function compareExtractions(
  regexValues: readonly string[],
  computedValues: readonly string[],
): ExtractionComparison {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
  const r = new Set(regexValues.map(norm));
  const c = new Set(computedValues.map(norm));
  const shared = [...r].filter((v) => c.has(v)).sort();
  return {
    regexOnly: [...r].filter((v) => !c.has(v)).sort(),
    computedOnly: [...c].filter((v) => !r.has(v)).sort(),
    shared,
    computedFoundMore: c.size > r.size,
  };
}
