/**
 * state-motion.ts — ***가리킴·누름 상태의 전환***. 모션 축이 스스로 적어 둔 한계를 연다.
 *
 * ⛔ 기존 문면: *"기본 상태만 측정; ***가리킴·누름 상태 전환***과 키프레임 내용은 측정하지 않음"*
 *
 * ⭐⭐ 왜 중요한가 — 52차 `RESULT-17` 이 못 박았다:
 *    ***「가속 곡선이 사실상 디자인 토큰이다」*** (stripe `cubic-bezier(0.25,1,0.5,1)` ×623).
 *    그런데 그 곡선은 «대부분 `:hover` 에 걸린다». 기본 상태만 재면 «전부 `ease`»로 보인다.
 *    📏 실측(crates.io): 기본 상태 전환 28개가 «전부 ease» 였다 — 그게 그 사이트의 서명일 리 없다.
 *
 * ⛔⭐ 방법은 «스타일시트를 읽는 것»이지 «상태를 흉내 내는 것»이 아니다.
 *    상태를 흉내 내려면 요소마다 강제해야 하고, 그건 페이지를 «건드리는» 일이다.
 *    ⇒ CSSOM 에서 `:hover`·`:focus`·`:active` 규칙의 `transition`/`animation` 을 «읽는다».
 * ⛔ 교차 출처 시트는 규칙을 «안 준다» — 그 사실을 «값으로» 낸다(`unreadableSheets`).
 */

import { parseTransitionShorthand, splitTopLevel } from './transition-shorthand.js';

export interface StateMotionRule {
  /** `hover` · `focus` · `active` · `focus-visible` */
  readonly state: string;
  /** 그 상태에서 선언된 전환 길이(예: `0.3s`) */
  readonly durations: readonly string[];
  /** 가속 곡선 — ⭐ 이것이 «디자인 서명»이다 */
  readonly easings: readonly string[];
  readonly properties: readonly string[];
  readonly count: number;
  /** ⛔ 변수를 «푼 뒤에도» 남은 칸 수. 0 이 아니면 길이·곡선은 «부분»이다. */
  readonly unresolvedVars: number;
  /** ⭐ `transition: var(--x)` 를 «풀어서» 길이·곡선을 얻은 칸 수. ⛔ 뿌리(`:root`) 기준 값이다. */
  readonly resolvedVars: number;
}

export interface StateMotionReport {
  readonly rules: readonly StateMotionRule[];
  /** 읽은 시트 수 */
  readonly sheetsRead: number;
  /** ⛔ 규칙을 «못 준» 시트 수(교차 출처). 0 이 아니면 아래 목록은 «부분»이다. */
  readonly unreadableSheets: number;
  /** ⭐ 기본 상태에 «없던» 가속 곡선 — 「기본만 재면 놓치는 것」 */
  readonly easingsOnlyInStates: readonly string[];
  /**
   * ⛔⭐ 한 이름에 «서로 다른 값»이 둘 이상 선언된 변수들.
   * 뿌리 값으로 풀었으므로 ***이 이름들이 쓰인 칸은 「그 요소에서도 그렇다」를 보증하지 않는다***.
   */
  readonly ambiguousVars: readonly string[];
  readonly note: string;
}

const STATES = ['hover', 'focus-visible', 'focus', 'active'] as const;

/**
 * `var(--name)` · `var(--name, 폴백)` 을 무는 «패턴 문자열».
 *
 * ⛔⭐⭐ 2026-09-10 🅕 실측 — ***여기서 「조용한 0」이 났다.***
 *    페이지 표현식은 «템플릿 리터럴»이라 그 «안»에 정규식 리터럴을 쓰면
 *    `\s` → `s` · `\(` → `(` 로 ***백슬래시가 먹힌다***. 그러면 `/var(s*(--x)…)/` 라는
 *    ***«문법상 유효한 다른 정규식»***이 되어 아무것도 안 물고, 오류도 «안 난다».
 * ✅ 그래서 패턴을 «밖»에 두고 `JSON.stringify` 로 넣는다 — ***그러면 이 상수를 «직접 시험»할 수 있다***.
 */
export const VAR_PATTERN = 'var\\(\\s*(--[A-Za-z0-9_-]+)\\s*(?:,([^()]*(?:\\([^()]*\\)[^()]*)*))?\\)';

/**
 * 페이지 «안»에서 돌 표현식.
 * ⛔ 반환은 «JSON 문자열» — 이 저장소의 같은 계약을 따른다.
 */
export function buildStateMotionExpression(): string {
  return `(() => {
  const states = ${JSON.stringify(STATES)};
  const acc = {};
  let sheetsRead = 0, unreadable = 0;
  const bump = (state, key, value) => {
    if (!value) return;
    const slot = acc[state] || (acc[state] = { durations: {}, easings: {}, properties: {}, count: 0 });
    slot[key][value] = (slot[key][value] || 0) + 1;
  };
  const varDecls = {};        // ⭐ \`--name\` → 선언된 «서로 다른» 값들. 둘 이상이면 «못 고른다».
  const pending = [];         // \`transition: var(…)\` 라 CSSOM 이 안 갈라 준 칸
  const collectVars = (style) => {
    if (!style || typeof style.length !== 'number') return;
    for (let i = 0; i < style.length; i += 1) {
      const prop = style[i];
      if (typeof prop !== 'string' || prop.slice(0, 2) !== '--') continue;
      const value = (style.getPropertyValue(prop) || '').trim();
      if (!value) continue;
      (varDecls[prop] || (varDecls[prop] = {}))[value] = true;
    }
  };
  const walk = (rules) => {
    for (const rule of rules) {
      // ⛔⭐ 2026-09-10 🅕 실측 — 여기서 «조용한 0» 이 났다.
      //    Chrome 의 CSS 중첩 지원 이후 ***CSSStyleRule 도 cssRules 를 «갖는다»***(빈 리스트).
      //    빈 리스트는 «truthy» 라 옛 판(if (rule.cssRules) { …; continue; })이
      //    ***모든 규칙을 건너뛰었다*** — 양성 대조군에서 0건이 나왔다.
      //    ✅ 길이를 «보고», 중첩과 선택자를 «둘 다» 처리한다(한 규칙이 둘 다 가질 수 있다).
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);   // @media·@supports·중첩 안으로
      const selector = rule.selectorText;
      if (!selector) continue;
      collectVars(rule.style);   // ⭐ \`:root\` 든 어디든 — 선언은 «전부» 모은다
      const hit = states.find((s) => selector.includes(':' + s));
      if (!hit) continue;
      const style = rule.style;
      if (!style) continue;
      const dur = style.getPropertyValue('transition-duration') || style.getPropertyValue('animation-duration');
      const ease = style.getPropertyValue('transition-timing-function') || style.getPropertyValue('animation-timing-function');
      const prop = style.getPropertyValue('transition-property');
      const shorthand = style.getPropertyValue('transition');
      if (!dur && !ease && !prop && !shorthand) continue;
      const slot = acc[hit] || (acc[hit] = { durations: {}, easings: {}, properties: {}, count: 0 });
      slot.count += 1;
      // ⛔⭐ 2026-09-10 실측 — ***롱핸드도 var() 를 «안 풀어 준다».***
      //    첫 판은 transition 단축형만 되짚었다. 그런데 표준 관행 하나가
      //    transition-timing-function: var(--ease-1) 처럼 «롱핸드로만» 덮어쓰는 것이라,
      //    그때 곡선이 «문자 그대로» var(--ease-1) 로 나갔다(대조가 통째로 어긋난다).
      if (dur && dur.indexOf('var(') !== -1) pending.push({ state: hit, text: dur, kind: 'duration' });
      else for (const v of (dur || '').split(',')) bump(hit, 'durations', v.trim());
      if (ease && ease.indexOf('var(') !== -1) pending.push({ state: hit, text: ease, kind: 'easing' });
      else for (const v of (ease || '').split(/,(?![^(]*\\))/)) bump(hit, 'easings', v.trim());
      for (const v of (prop || '').split(',')) bump(hit, 'properties', v.trim());
      // ⛔⭐ shorthand 가 var() 면 CSSOM 이 «안 풀어 준다» — 길이·곡선을 «못 가른다».
      //    📏 실측(crates.io): \`transition: var(--transition-instant)\` 3규칙.
      //    ⇒ 「곡선이 없다」가 아니라 «못 쟀다»다. 그 사실을 «값으로» 남긴다.
      if (!dur && !ease && shorthand) {
        if (shorthand.includes('var(')) pending.push({ state: hit, text: shorthand.trim(), kind: 'shorthand' });
        else bump(hit, 'properties', shorthand.trim());
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); sheetsRead += 1; }
    catch (e) { unreadable += 1; }   // ⛔ 교차 출처 — 「규칙이 없다」가 아니라 「못 읽었다」
  }
  // ⛔⭐ 변수를 «푸는 자리»는 여기다 — 시트를 다 읽은 «뒤»라야 선언을 전부 안다.
  //    ✅ 값은 \`:root\` 의 «계산된» 값으로 읽는다(getComputedStyle) — 선언 문자열이 아니라 «적용된» 값.
  //    ⛔ 그래서 이 값은 ***「뿌리에서 그렇다」***까지다. 하위에서 덮어썼으면 그 요소에선 다르다.
  const rootStyle = getComputedStyle(document.documentElement);
  const VAR_RE = new RegExp(${JSON.stringify(VAR_PATTERN)}, 'g');
  const usedNames = {};
  const resolveOnce = (text) => text.replace(VAR_RE, (whole, name, fallback) => {
    usedNames[name] = true;
    const value = (rootStyle.getPropertyValue(name) || '').trim();
    if (value) return value;
    if (fallback !== undefined && fallback.trim()) return fallback.trim();
    return whole;   // ⛔ 못 풀었으면 «그대로 둔다» — 빈 문자열로 지우면 「0」이 된다
  });
  const resolved = {};
  for (const item of pending) {
    let text = item.text;
    // 변수가 변수를 가리킬 수 있다 — 단 «무한»은 막는다(4겹이면 실무에서 충분하다).
    for (let round = 0; round < 4 && text.indexOf('var(') !== -1; round += 1) {
      const next = resolveOnce(text);
      if (next === text) break;
      text = next;
    }
    (resolved[item.state] || (resolved[item.state] = [])).push({ kind: item.kind, text });
  }
  // ⛔⭐ 「한 이름에 값이 둘 이상 선언됐다」 = 뿌리 값을 골라 쓰면 «조용히 틀릴 수» 있다.
  const ambiguousVars = Object.keys(usedNames).filter((n) => varDecls[n] && Object.keys(varDecls[n]).length > 1).sort();
  const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v);
  return JSON.stringify({
    resolved, ambiguousVars,
    rules: Object.entries(acc).map(([state, v]) => ({
      state, count: v.count, durations: top(v.durations), easings: top(v.easings), properties: top(v.properties),
      unresolvedVars: v.unresolvedVars || 0,
    })),
    sheetsRead, unreadableSheets: unreadable,
  });
})()`;
}

/** ⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다 — `null` 을 낸다. */
export function parseStateMotion(raw: unknown, baseEasings: readonly string[] = []): StateMotionReport | null {
  if (typeof raw !== 'string') return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof o.sheetsRead !== 'number') return null;
  const rawRules = (Array.isArray(o.rules) ? o.rules : []) as StateMotionRule[];
  const resolvedMap = (o.resolved !== null && typeof o.resolved === 'object'
    ? o.resolved
    : {}) as Record<string, unknown>;
  // ⭐⭐ 변수를 푼 칸을 «같은 통»에 합친다 — 그러지 않으면 「곡선 없음」으로 보이고,
  //    그 사이트의 «서명»(RESULT-17)이 통째로 빠진다.
  const rules: StateMotionRule[] = rawRules.map((rule) => {
    // ⛔ 옛 모양(문자열 배열)도 «받는다» — 형식을 바꿨다고 옛 산출을 던지지 않는다.
    const raw = Array.isArray(resolvedMap[rule.state]) ? (resolvedMap[rule.state] as unknown[]) : [];
    const items = raw.map((entry) => (typeof entry === 'string'
      ? { kind: 'shorthand' as const, text: entry }
      : entry as { kind?: string; text?: string }));
    const durations = [...rule.durations];
    const easings = [...rule.easings];
    const properties = [...rule.properties];
    const add = (into: string[], values: readonly string[]) => {
      for (const v of values) if (v && !into.includes(v)) into.push(v);
    };
    let resolvedVars = 0;
    let unresolvedVars = 0;
    for (const item of items) {
      const text = typeof item.text === 'string' ? item.text : '';
      if (text === '') continue;
      const stillVar = text.includes('var(');
      // ⭐ 롱핸드는 «그 칸만» 채운다 — 단축형 파서에 넣으면 `0.14s` 가 「대상」으로 샌다.
      if (item.kind === 'easing' || item.kind === 'duration') {
        if (stillVar) { unresolvedVars += 1; continue; }
        resolvedVars += 1;
        const values = splitTopLevel(text, ',');
        add(item.kind === 'easing' ? easings : durations, values);
        continue;
      }
      const parts = parseTransitionShorthand(text);
      if (parts.durations.length > 0 || parts.easings.length > 0) resolvedVars += 1;
      if (parts.unresolved > 0) unresolvedVars += 1;
      add(durations, parts.durations);
      add(easings, parts.easings);
      add(properties, parts.properties);
    }
    return { ...rule, durations, easings, properties, resolvedVars, unresolvedVars };
  });
  const base = new Set(baseEasings.map((e) => e.trim()));
  const seen = new Set<string>();
  for (const rule of rules) for (const easing of rule.easings) if (!base.has(easing.trim())) seen.add(easing.trim());
  const unreadable = typeof o.unreadableSheets === 'number' ? o.unreadableSheets : 0;
  const ambiguousVars = (Array.isArray(o.ambiguousVars) ? o.ambiguousVars : []).filter(
    (n): n is string => typeof n === 'string',
  );
  return {
    rules,
    sheetsRead: o.sheetsRead,
    unreadableSheets: unreadable,
    easingsOnlyInStates: [...seen].sort(),
    ambiguousVars,
    note: unreadable > 0
      // ⛔ 「없다」로 읽히지 않게 «수»를 같이 낸다
      ? `시트 ${o.sheetsRead}개를 읽었고 ${unreadable}개는 «못 읽었다»(교차 출처) — 아래는 «부분»이다`
      : `시트 ${o.sheetsRead}개를 전부 읽었다`,
  };
}

/** DESIGN.md 의 `### 상태 전환` 절. */
export function renderStateMotionSection(report: StateMotionReport | null): string[] {
  const L = ['### 상태 전환 (가리킴·누름) — ⭐ ***가속 곡선이 «디자인 서명»이다***', ''];
  if (report === null) {
    L.push('⚪ 상태 전환을 **못 쟀다** — 추출이 실패했다. ⛔ 「상태 전환이 없다」가 «아니다».');
    return L;
  }
  L.push(`> ${report.note}`);
  L.push('');
  if (report.rules.length === 0) {
    L.push(report.unreadableSheets > 0
      ? '⚪ 상태 규칙을 **못 찾았다** — 그런데 못 읽은 시트가 있다. ⛔ 「없다」로 읽지 마라.'
      : '- 상태 전환 규칙이 **없다** (읽은 시트 전부에서)');
    return L;
  }
  for (const rule of report.rules) {
    L.push(`- \`:${rule.state}\` — 규칙 ${rule.count}개`);
    if (rule.durations.length) L.push(`  - 길이: ${rule.durations.join(' · ')}`);
    if (rule.easings.length) L.push(`  - ⭐ 가속 곡선: ${rule.easings.join(' · ')}`);
    if (rule.properties.length) L.push(`  - 대상: ${rule.properties.join(' · ')}`);
    if (rule.resolvedVars > 0) {
      L.push(`  - ⭐ 그중 ${rule.resolvedVars}개는 \`transition: var(…)\` 를 **«풀어서» 잰 것**`);
      L.push('    (⛔ 뿌리 `:root` 의 계산된 값이다 — 하위에서 덮어썼으면 그 요소에선 다르다)');
    }
    if (rule.unresolvedVars > 0) {
      L.push(`  - ⚪ 그리고 ${rule.unresolvedVars}개는 **풀고도 못 갈랐다** (변수가 «선언되지 않았다»)`);
      L.push('    (⛔ 「곡선이 없다」가 «아니다» — 「이 사다리로는 못 잰다」다)');
    }
  }
  if (report.ambiguousVars.length) {
    L.push('');
    L.push(`- ⛔⭐ **한 이름에 값이 둘 이상** 선언된 변수: ${report.ambiguousVars.join(' · ')}`);
    L.push('> 뿌리 값으로 풀었다 — ***그 요소에서도 같은 값인지는 «안 쟀다»***. (테마·미디어로 갈리는 자리)');
  }
  if (report.easingsOnlyInStates.length) {
    L.push('');
    L.push(`- ⭐⭐ ***기본 상태에 «없던» 가속 곡선***: ${report.easingsOnlyInStates.join(' · ')}`);
    L.push('> 🔑 기본 상태만 재면 이 값들을 «전부 놓친다» — 그리고 화면은 「전부 ease」처럼 보인다.');
  }
  return L;
}


/**
 * 씨앗 문서의 `### 상태 전환` 절을 «되읽는다».
 * ⛔⭐ `RESULT-21` 의 교훈 — 씨앗 쪽과 페이지 쪽을 «같은 자»로 재야 한다.
 * ⛔ 못 읽으면 `null` — 「상태 전환이 없다」와 「절이 없다」는 다른 값이다.
 */
export function readSeedStateEasings(seed: string): readonly string[] | null {
  const heading = /^###\s+상태 전환[^\n]*$/m.exec(seed);
  if (heading === null) return null;
  const body = seed.slice(heading.index + heading[0].length).split(/^#{1,6}\s/m, 1)[0];
  const rows = [...body.matchAll(/^\s*-\s*⭐?\s*가속 곡선:\s*(.+)$/gm)];
  if (rows.length === 0) return [];
  const out = new Set<string>();
  for (const row of rows) for (const value of row[1].split('·')) {
    const trimmed = value.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out].sort();
}
