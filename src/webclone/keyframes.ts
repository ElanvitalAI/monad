/**
 * keyframes.ts — ***`@keyframes` 안을 읽는다: 「무엇이」 움직이나.***
 *
 * ⛔ 모션 축이 지금까지 답한 것은 「얼마나 오래」(길이)와 「어떤 곡선으로」뿐이다.
 *    ***「무엇이 움직이나」는 한 번도 안 쟀다*** — 그런데 다시 지을 때 화면을 가르는 것은 그쪽이다.
 *    (같은 `300ms ease-out` 이라도 `opacity` 만 움직이는 것과 `transform: translateY(8px)` 는 다른 화면이다.)
 *
 * ⛔⭐ 이 축의 가장 큰 함정 — ***「정의됐다」와 「쓰인다」는 다른 값이다.***
 *    프레임워크·리셋 CSS 가 안 쓰는 `@keyframes` 를 잔뜩 싣는다. 그것을 「디자인 서명」으로 읽으면
 *    ***없는 움직임을 다시 짓는다***. ⇒ 쓰는 규칙 수(`usedBy`)를 «같이» 세고, 0 이면 따로 모은다.
 *
 * ⛔ 같은 이름이 여러 번 정의되면 CSS 는 «마지막»이 이긴다. 우리는 ***조용히 고르지 않는다*** —
 *    중복을 이름으로 낸다(`duplicateNames`).
 */

import { parseAnimationNames, parseTransitionShorthand } from './transition-shorthand.js';

export interface KeyframeStep {
  /**
   * `0%` · `50%` 등.
   * ⛔⭐ 2026-09-10 실측 정정 — ***`from`/`to` 는 «우리가» 아니라 CSSOM 이 `0%`/`100%` 로 바꾼다.***
   *    (`CSSKeyframeRule.keyText` 가 이미 정규화된 값을 준다.)
   *    ⇒ 원문 표기는 ***이 사다리로는 못 잰다*** — 「우리가 안 바꿨다」와 「안 바뀌었다」는 다른 값이다.
   */
  readonly offset: string;
  readonly declarations: readonly string[];
}

export interface KeyframeAnimation {
  readonly name: string;
  readonly steps: readonly KeyframeStep[];
  /**
   * ⭐ 이 애니메이션이 «건드리는» 속성들 — 「무엇이 움직이나」의 답.
   * ⛔⭐ 2026-09-10 정정 — ***`animation-timing-function` 은 여기 들어오면 «안 된다».***
   *    그것은 「움직이는 것」이 아니라 ***「어떻게 움직이나」***다(단계별 곡선).
   *    옛 판은 선언 이름을 «전부» 담아서 `bounce` 의 답이
   *    `animation-timing-function · transform` 이 됐다 — ⛔ 앞의 것은 «움직이지 않는다».
   */
  readonly animatedProperties: readonly string[];
  /**
   * ⭐ 단계에 걸린 «곡선» — `0% { animation-timing-function: … }`.
   * 🔑 이것이 있으면 그 애니메이션은 ***단계마다 다른 가속***을 쓴다(튀는 공 같은 것).
   * ⛔ 없으면 빈 배열이고, 그것은 「곡선이 없다」가 아니라 «단계에 안 걸렸다»다
   *    (전체 곡선은 `animation` 단축형 쪽에 있다).
   */
  readonly stepEasings: readonly string[];
  /** ⛔ 이 이름을 `animation-name` 으로 «쓰는» 규칙 수. 0 이면 정의만 된 것이다. */
  readonly usedBy: number;
  /** 쓰는 선택자 몇 개(최대 3) — 「어디서 움직이나」 */
  readonly usedIn: readonly string[];
}

export interface KeyframesReport {
  readonly animations: readonly KeyframeAnimation[];
  /**
   * ⭐⭐ 이 화면의 «움직임 곡선» 전부 — 단계에 걸린 것 ⊕ «쓰는 자리»에 걸린 것.
   * 🩸 왜 생겼나(2026-09-10): `RESULT-29`·`RESULT-30` 이 둘 다 ⚪ 로 적어 둔 칸이다.
   *    상태 전환 축은 `transition-*` 만 보고, 키프레임 축은 «속성 집합»만 봐서
   *    ***애니메이션의 가속 곡선을 «어느 축도» 안 셌다***. 그런데 곡선이 디자인 서명이다(`RESULT-17`).
   */
  readonly easings: readonly string[];
  /** ⛔ 정의는 됐는데 «아무도 안 쓰는» 이름들 — 서명이 아니다 */
  readonly definedButUnused: readonly string[];
  /** ⛔ 같은 이름이 둘 이상 정의됐다 — 「마지막이 이긴다」를 조용히 고르지 않는다 */
  readonly duplicateNames: readonly string[];
  readonly sheetsRead: number;
  readonly unreadableSheets: number;
}

/** 값에서 «움직이는 것»을 알아보는 데 쓰는 속성 이름은 «데이터»에서 온다 — 목록을 박지 않는다. */
export function buildKeyframesExpression(): string {
  return `(() => {
  const VAR_RE = new RegExp(${JSON.stringify('var\\(\\s*(--[A-Za-z0-9_-]+)\\s*(?:,([^()]*(?:\\([^()]*\\)[^()]*)*))?\\)')}, 'g');
  const pendingAnimations = [];   // \`animation\` 단축형에 var() 가 있어 이름을 «못 얻은» 규칙
  const useEasings = {};          // 애니메이션을 «쓰는 자리»에 걸린 가속 곡선
  const defs = {};          // 이름 → { steps, order }
  const dupes = {};         // 이름 → 정의 횟수
  const uses = {};          // 이름 → { count, selectors }
  let sheetsRead = 0, unreadable = 0;
  const declarationsOf = (style) => {
    const out = [];
    if (!style || typeof style.length !== 'number') return out;
    for (let i = 0; i < style.length; i += 1) {
      const prop = style[i];
      if (typeof prop !== 'string') continue;
      const value = style.getPropertyValue(prop);
      out.push(value ? prop + ': ' + value : prop);
    }
    return out;
  };
  const walk = (rules) => {
    for (const rule of rules) {
      // ⛔⭐⭐ @keyframes 를 가리는 기준 — «자식이 keyText 를 갖는가».
      //
      //    🩸 2026-09-10 실측 정정 — 첫 판은 「이름이 있고 자식 규칙이 있다」로 갈랐다.
      //       그러자 ***\`@layer global { … }\` 이 「키프레임」으로 잡혔다*** (CSSLayerBlockRule 도
      //       name 과 cssRules 를 «둘 다» 갖는다). 게다가 continue 로 ***그 안을 안 걸어***
      //       레이어 «안»의 animation-name 을 통째로 놓쳤다.
      //    🔑 그것을 잡은 것은 시험이 아니라 ***내 산출의 「정의만 된 것」 칸***이었다
      //       (\`global\` · \`global.normalize\` 라는 «이름이 아닌 이름»이 거기 앉아 있었다).
      //    ⛔ rule.type 숫자는 쓰지 않는다(폐기 예정 API).
      //    ⚪ 못 가르는 칸: «빈» 블록(@keyframes x {} 과 @layer x {})은 구별할 근거가 없다 ⇒ 안 담는다.
      const children = rule.cssRules ? Array.from(rule.cssRules) : [];
      const isKeyframes = typeof rule.name === 'string'
        && children.length > 0
        && children.some((child) => typeof child.keyText === 'string');
      if (isKeyframes) {
        dupes[rule.name] = (dupes[rule.name] || 0) + 1;
        const steps = [];
        for (const frame of children) {
          if (typeof frame.keyText !== 'string') continue;
          steps.push({ offset: frame.keyText, declarations: declarationsOf(frame.style) });
        }
        defs[rule.name] = steps;    // ⛔ CSS 처럼 «마지막이 이긴다» — 중복은 위에서 «센다»
        continue;                   // 자식은 keyframe 이라 아래 선택자 처리 대상이 아니다
      }
      if (children.length) walk(children);   // @media·@supports·@layer·중첩 — ⛔ 레이어 «안»도 걷는다
      const style = rule.style;
      if (!style) continue;
      const names = style.getPropertyValue('animation-name');
      if (!names) {
        // ⛔⭐ 단축형에 var() 가 있으면 CSSOM 이 longhand 를 «안 펼친다» ⇒ 이름이 «빈 문자열»이다.
        //    그러면 그 움직임이 「아무도 안 쓴다」로 보인다 — 「정의만 됐다」와 구별이 안 된다.
        const shorthand = style.getPropertyValue('animation');
        if (shorthand && shorthand.indexOf('var(') !== -1) {
          pendingAnimations.push({ text: shorthand, selector: typeof rule.selectorText === 'string' ? rule.selectorText : '' });
        }
        continue;
      }
      for (const raw of names.split(',')) {
        const name = raw.trim();
        if (!name || name === 'none') continue;
        const slot = uses[name] || (uses[name] = { count: 0, selectors: [] });
        slot.count += 1;
        // ⭐ 쓰는 자리의 곡선 — 단계에 걸린 것과 «다른» 자리다(둘 다 서명이다).
        const timing = style.getPropertyValue('animation-timing-function');
        if (timing && timing.indexOf('var(') === -1) {
          for (const one of timing.split(',')) { const t = one.trim(); if (t) useEasings[t] = true; }
        }
        const selector = rule.selectorText;
        if (typeof selector === 'string' && slot.selectors.length < 3) slot.selectors.push(selector);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); sheetsRead += 1; }
    catch (e) { unreadable += 1; }   // ⛔ 교차 출처 — 「없다」가 아니라 「못 읽었다」
  }
  // ⛔ 시트를 다 읽은 «뒤»라야 선언을 전부 안다 — 그때 변수를 푼다.
  const rootStyle = getComputedStyle(document.documentElement);
  const resolveOnce = (text) => text.replace(VAR_RE, (whole, varName, fallback) => {
    const value = (rootStyle.getPropertyValue(varName) || '').trim();
    if (value) return value;
    if (fallback !== undefined && fallback.trim()) return fallback.trim();
    return whole;   // ⛔ 못 풀었으면 «그대로 둔다»
  });
  const resolvedAnimations = pendingAnimations.map((item) => {
    let text = item.text;
    for (let round = 0; round < 4 && text.indexOf('var(') !== -1; round += 1) {
      const next = resolveOnce(text);
      if (next === text) break;
      text = next;
    }
    return { text, selector: item.selector };
  });
  const animations = Object.keys(defs).map((name) => {
    const steps = defs[name];
    const props = {};
    const easings = {};
    for (const step of steps) for (const d of step.declarations) {
      const colon = d.indexOf(':');
      const prop = (colon === -1 ? d : d.slice(0, colon)).trim();
      // ⛔⭐ 「어떻게 움직이나」를 「무엇이 움직이나」에 «섞지 않는다».
      if (prop === 'animation-timing-function') {
        const value = colon === -1 ? '' : d.slice(colon + 1).trim();
        if (value) easings[value] = true;
        continue;
      }
      props[prop] = true;
    }
    const use = uses[name] || { count: 0, selectors: [] };
    return {
      name, steps, animatedProperties: Object.keys(props).sort(),
      stepEasings: Object.keys(easings).sort(),
      usedBy: use.count, usedIn: use.selectors,
    };
  });
  return JSON.stringify({
    animations, resolvedAnimations, useEasings: Object.keys(useEasings),
    duplicateNames: Object.keys(dupes).filter((n) => dupes[n] > 1).sort(),
    sheetsRead, unreadableSheets: unreadable,
  });
})()`;
}

/** ⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다 — `null` 을 낸다. */
export function parseKeyframes(rawInput: unknown): KeyframesReport | null {
  if (typeof rawInput !== 'string') return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(rawInput) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof o.sheetsRead !== 'number') return null;
  const raw = (Array.isArray(o.animations) ? o.animations : []) as KeyframeAnimation[];
  // ⭐ 단축형에 var() 가 있어 페이지 쪽이 «이름을 못 얻은» 규칙들을 «여기서» 잇는다.
  //    ⛔ 파싱은 페이지 «밖»에서 한다 — 표현식 문자열 안의 코드는 시험할 수 없다.
  const resolvedAnimations = (Array.isArray(o.resolvedAnimations) ? o.resolvedAnimations : []) as Array<{
    text?: unknown; selector?: unknown;
  }>;
  const extraUses = new Map<string, string[]>();
  for (const item of resolvedAnimations) {
    if (typeof item.text !== 'string') continue;
    for (const name of parseAnimationNames(item.text)) {
      const selectors = extraUses.get(name) ?? [];
      if (typeof item.selector === 'string' && item.selector) selectors.push(item.selector);
      extraUses.set(name, selectors);
    }
  }
  const animations: KeyframeAnimation[] = raw.map((animation) => {
    const extra = extraUses.get(animation.name);
    if (extra === undefined) return animation;
    return {
      ...animation,
      usedBy: animation.usedBy + Math.max(1, extra.length),
      usedIn: [...animation.usedIn, ...extra].slice(0, 3),
    };
  });
  // ⭐ 곡선 세 자리를 합친다 — 단계 · 쓰는 자리 · «풀린» 단축형.
  //    ⛔ 합치되 «지어내지» 않는다: 안 풀린 var() 에서는 아무것도 안 꺼낸다.
  const curves = new Set<string>();
  // ⛔ 그 칸이 «없는» 옛 산출을 던지지 않는다 — 이 저장소가 이미 못 박은 불변식이다(또 밟았다).
  for (const a of animations) for (const e of a.stepEasings ?? []) if (e) curves.add(e.trim());
  for (const e of (Array.isArray(o.useEasings) ? o.useEasings : [])) if (typeof e === 'string' && e.trim()) curves.add(e.trim());
  for (const item of resolvedAnimations) {
    if (typeof item.text !== 'string') continue;
    for (const e of parseTransitionShorthand(item.text).easings) if (e) curves.add(e.trim());
  }
  return {
    easings: [...curves].sort(),
    // ⭐ 「쓰이는 것」이 먼저 — 정의만 된 것은 서명이 아니다
    animations: [...animations].sort((a, b) => b.usedBy - a.usedBy || a.name.localeCompare(b.name)),
    definedButUnused: animations.filter((a) => a.usedBy === 0).map((a) => a.name).sort(),
    duplicateNames: (Array.isArray(o.duplicateNames) ? o.duplicateNames : []).filter(
      (n): n is string => typeof n === 'string',
    ),
    sheetsRead: o.sheetsRead,
    unreadableSheets: typeof o.unreadableSheets === 'number' ? o.unreadableSheets : 0,
  };
}

/** 한 단계를 사람이 읽는 한 줄로. ⛔ 값을 줄이지 않는다 — 줄이면 다시 못 짓는다. */
export function formatStep(step: KeyframeStep): string {
  return step.declarations.length === 0
    ? `${step.offset}: (선언 없음)`
    : `${step.offset}: ${step.declarations.join('; ')}`;
}

/** DESIGN.md 의 `### 키프레임` 절. */
export function renderKeyframesSection(report: KeyframesReport | null): string[] {
  const L = ['### 키프레임 — ⭐ ***「무엇이」 움직이나***', ''];
  if (report === null) {
    L.push('⚪ 키프레임을 **못 쟀다** — 추출이 실패했다. ⛔ 「움직임이 없다」가 «아니다».');
    return L;
  }
  L.push(report.unreadableSheets > 0
    ? `> 시트 ${report.sheetsRead}개를 읽었고 ${report.unreadableSheets}개는 «못 읽었다»(교차 출처) — 아래는 «부분»이다`
    : `> 시트 ${report.sheetsRead}개를 전부 읽었다`);
  L.push('');
  const used = report.animations.filter((a) => a.usedBy > 0);
  if (used.length === 0) {
    L.push(report.animations.length === 0
      ? '- `@keyframes` 가 **없다** (읽은 시트 전부에서)'
      : `⚪ \`@keyframes\` 는 **${report.animations.length}개** 있는데 ***아무도 «안 쓴다»*** — ⛔ 서명이 아니다.`);
  }
  for (const anim of used) {
    L.push(`- \`${anim.name}\` — 규칙 ${anim.usedBy}개가 쓴다${anim.usedIn.length ? ` (\`${anim.usedIn.join('`, `')}\`)` : ''}`);
    L.push(`  - ⭐ 움직이는 것: ${anim.animatedProperties.join(' · ')}`);
    if ((anim.stepEasings ?? []).length) {
      // ⛔ 「무엇이」와 「어떻게」를 «다른 줄»로 낸다 — 한 줄에 섞으면 둘 다 못 읽는다.
      L.push(`  - ⭐ 단계별 가속 곡선: ${(anim.stepEasings ?? []).join(' · ')}`);
    }
    for (const step of anim.steps) L.push(`  - ${formatStep(step)}`);
  }
  if (report.definedButUnused.length > 0 && used.length > 0) {
    L.push('');
    L.push(`- ⚪ **정의만 되고 «안 쓰이는»** 이름 ${report.definedButUnused.length}개: ${report.definedButUnused.join(' · ')}`);
    L.push('> ⛔ 이것을 서명으로 읽으면 ***없는 움직임을 다시 짓는다***.');
  }
  if (used.length > 0 || report.animations.length > 0) {
    L.push('');
    // ⛔ 「우리가 안 바꿨다」로 읽히지 않게 «누가» 바꿨는지 적는다
    L.push('> ⚪ 단계 표기 `from`/`to` 는 **CSSOM 이 이미 `0%`/`100%` 로 바꿔** 준다 — 원문 표기는 못 쟀다.');
  }
  if (report.duplicateNames.length > 0) {
    L.push('');
    L.push(`- ⛔⭐ **같은 이름이 여러 번 정의됐다**: ${report.duplicateNames.join(' · ')}`);
    L.push('> CSS 는 «마지막»이 이긴다 — 위 내용은 그 마지막이다. ⚠️ 어느 시트가 이겼는지는 «안 쟀다».');
  }
  return L;
}
