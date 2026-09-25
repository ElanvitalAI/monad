import { reportDesignTokens, type DesignTokenReport } from './design-tokens.js';
import { readSeedSpacing, type LayoutReport } from '../webclone/layout-tokens.js';
import { readSeedStateEasings, type StateMotionReport } from '../webclone/state-motion.js';
import { readSeedKeyframes } from './seed-motion.js';
import { ratiosAgree, rangesOverlap, readSeedBreakpoint, type SeedBreakpoint } from './seed-responsive.js';
import { readSeedProportional } from './seed-to-css.js';
import type { KeyframesReport } from '../webclone/keyframes.js';
import { normaliseColor } from '../webclone/design-md.js';
import type { ComputedTokens } from '../webclone/computed-tokens.js';

export type ConformanceStatus = 'match' | 'mismatch' | 'unmeasurable';

export interface ConformanceMismatch {
  readonly name: string;
  readonly seed: string;
  readonly page: string | null;
}

export interface ConformanceAxis {
  readonly status: ConformanceStatus;
  readonly mismatches: readonly ConformanceMismatch[];
  readonly reason?: string;
}

export interface SeedConformance {
  readonly color: ConformanceAxis;
  readonly typography: ConformanceAxis;
  readonly fontFamily: ConformanceAxis;
  /** ⭐ 간격 눈금. ⛔ 씨앗에 `### 간격 눈금` 절이 없으면 «못 쟀음»이다(어긋남이 아니다). */
  readonly spacing: ConformanceAxis;
  /** ⭐ 상태 전환의 «가속 곡선». ⛔ 씨앗에 절이 없으면 «못 쟀음»이다. */
  readonly stateMotion: ConformanceAxis;
  /**
   * ⭐ 「무엇이 움직이나」. 씨앗 `### 키프레임` ↔ 페이지의 `@keyframes`.
   * ⛔ 이 축이 보는 것은 ***«움직이는 속성»***이지 이름이 아니다 —
   *    이름은 사람이 붙이는 것이라(원본 이름은 빌드 해시일 수 있다) 이름으로 대조하면
   *    ***「다시 지었다」가 「베꼈다」와 같은 뜻이 된다***.
   */
  readonly keyframes: ConformanceAxis;
  /**
   * ⭐ 반응형 — 「분기가 «같은 구간»에 있나」 ⊕ 「눈금이 «같은 비율»로 커지나」.
   * ⛔ 이 축은 «폭마다 다시 방문»해야 해서 비용이 다르다 ⇒ 안 재고 오면 «못 쟀음»이다.
   */
  readonly responsive: ConformanceAxis;
}

export interface SeedConformanceInput {
  readonly seed: string | DesignTokenReport;
  readonly page: ComputedTokens;
  /** ⭐ 페이지에서 «같은 자»로 잰 간격. 안 주면 간격 축이 「못 쟀음」이 된다. */
  readonly pageLayout?: import('../webclone/layout-tokens.js').LayoutReport | null;
  /** ⭐ 페이지에서 «같은 자»로 잰 상태 전환. 안 주면 그 축이 「못 쟀음」이 된다. */
  readonly pageStateMotion?: import('../webclone/state-motion.js').StateMotionReport | null;
  /** ⭐ 페이지에서 «같은 자»로 잰 키프레임. 안 주면 그 축이 「못 쟀음」이 된다. */
  readonly pageKeyframes?: KeyframesReport | null;
  /**
   * ⭐ 페이지에서 «여러 폭으로» 잰 반응형. ⛔ 비용이 3배라 «부르는 쪽이 폭을 명시»할 때만 온다.
   * 안 오면 그 축은 「못 쟀음」이다 — ⛔ 「반응형이 아니다」가 «아니다».
   */
  readonly pageResponsive?: {
    /**
     * ⛔⭐ 「분기」가 «하나»라고 가정하지 않는다 — 화면엔 여럿일 수 있고,
     *    하나만 견주면 다른 분기가 씨앗과 맞아도 어긋남이 난다.
     */
    readonly breakpoints?: readonly SeedBreakpoint[] | null;
    readonly proportionalRatio?: number | null;
    readonly widths?: readonly number[];
  } | null;
}

interface RoleTypography {
  readonly size: string | null;
  readonly weight: string | null;
}

/**
 * 페이지가 «실제로 칠한» 색.
 *
 * ⛔⭐ 왜 두 자리를 «합치나» — 2026-09-10 🅕 실측:
 *   씨앗 쪽은 「칠해진 색을 «면적»으로」 고르는데, 페이지 쪽은 ***탐침 여덟 자리***(body·h1~h3·
 *   link·button·header·footer)만 봤다. ⇒ ***모집단이 달라 「어긋남」이 구조적으로 나온다.***
 *   📏 저장소 템플릿을 «자기 씨앗»으로 재니 색 어긋남 10/14 · 9/14 가 나왔다(어긋남 0이 정상인데).
 *   📏 같은 자를 「면적으로 고른 씨앗」에 대고 재니 3/9 로 줄었고, 남은 셋은 «진짜»였다
 *      (씨앗이 선언했지만 그 화면이 «안 칠한» 색 — 그 페이지엔 `<a>` 가 없었다).
 *
 * ⇒ 그래서 `paintedColors`(전 요소 훑기 · 이미 착지해 있다)를 «같이» 본다. 두 축을 맞춘다.
 * ⛔ 못 쟀으면(`null`) 탐침만으로 «떨어지지» 않고, 그 사실이 사유로 나간다(아래 `colorAxis`).
 */
function pageColors(page: ComputedTokens): Set<string> {
  const values = Object.values(page.roles)
    .flatMap((role) => [role['color'], role['background-color']])
    .filter((value): value is string => typeof value === 'string');
  const painted = page.paintedColors ?? null;
  if (painted) {
    // ⭐ 획(테두리·아웃라인)도 «칠한 것»이다 — 그 칸이 없는 옛 산출도 던지지 않는다.
    //    🩸 2026-09-10: 모집단이 배경·글자뿐이라, 테두리에만 쓰인 토큰이
    //       「선언했는데 안 칠했다」는 «참인데 틀린» 어긋남으로 나왔다.
    const strokes = painted.strokes ?? [];
    for (const entry of [...painted.backgrounds, ...painted.text, ...strokes]) values.push(entry.value);
  }
  return new Set(values.map(normaliseColor).filter((value): value is string => value !== null));
}

/** ⛔ 「탐침만 봤다」와 「전 요소를 봤다」를 «가른다» — 어긋남을 읽는 쪽이 그 차이를 알아야 한다. */
function colorPopulationNote(page: ComputedTokens): string {
  // ⛔ `null`(못 쟀다)과 `undefined`(그 칸이 아예 없는 옛 산출)를 «같이» 다룬다 — 둘 다 「안 봤다」다
  const painted = page.paintedColors ?? null;
  return painted === null
    ? 'population=probes-only(⚪ painted 색을 못 쟀다 — 어긋남이 «모집단 차이»일 수 있다)'
    // ⛔ 분모를 «정확히» 말한다 — 획을 세면서 사유에 안 적으면 읽는 쪽이 모집단을 틀리게 안다.
    : `population=probes+painted(bg ${painted.backgrounds.length} · fg ${painted.text.length}`
      + `${painted.strokes === undefined ? ' · ⚪획 못 쟀음' : ` · 획 ${painted.strokes.length}`})`;
}

/**
 * ⛔⭐ `export` 인 이유 — ***같은 표를 읽는 자를 «둘» 만들지 않는다.***
 *    이 저장소가 이미 배운 것이다(`byTag` 주석: *"자가 하나면 수도 하나다"*).
 *    📏 2026-09-11: `design-css` 가 「역할 몇 개짜리 씨앗인가」를 내야 했는데,
 *       그 표를 읽는 자가 «여기» 있었다. 새로 쓰지 않고 가져다 쓴다.
 */
export function declaredRoleTypography(seed: string, report: DesignTokenReport): Readonly<Record<string, RoleTypography>> {
  const roles: Record<string, RoleTypography> = {};
  for (const token of report.typography.tokens) {
    const match = /^--font-(size|weight)-([a-z0-9-]+)$/i.exec(token.name);
    if (!match) continue;
    const role = match[2];
    const previous = roles[role] ?? { size: null, weight: null };
    roles[role] = match[1] === 'size'
      ? { ...previous, size: token.value }
      : { ...previous, weight: token.value };
  }
  const heading = /^###\s+측정된 역할\s*\(computed[^)]*\)\s*$/m.exec(seed);
  const table = heading === null ? '' : seed.slice(heading.index + heading[0].length).split(/^#{1,6}\s/m, 1)[0];
  const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  for (const match of table.matchAll(row)) {
    const role = match[1].trim();
    if (role === '역할' || /^-+$/.test(role)) continue;
    roles[role] = { size: match[2].trim(), weight: match[3].trim() };
  }
  return roles;
}

function colorAxis(report: DesignTokenReport, page: ComputedTokens): ConformanceAxis {
  const colors = report.palette.tokens
    .map((token) => ({ ...token, normalized: normaliseColor(token.value) }))
    .filter((token): token is { name: string; value: string; normalized: string } => token.normalized !== null);
  if (colors.length === 0) return { status: 'unmeasurable', mismatches: [], reason: 'seed-palette-section-missing-or-has-no-colors' };
  const actual = pageColors(page);
  if (actual.size === 0) return { status: 'unmeasurable', mismatches: [], reason: 'page-color-observation-missing' };
  const observed = [...actual].sort().join(', ');
  const mismatches = colors.filter((token) => !actual.has(token.normalized))
    .map((token) => ({ name: token.name, seed: token.value, page: observed }));
  // ⛔ 어긋남이 났으면 «무엇을 모집단으로 봤는지»를 같이 낸다 — 「모집단 차이」와 「진짜 어긋남」을 가르게
  return mismatches.length
    ? { status: 'mismatch', mismatches, reason: colorPopulationNote(page) }
    : { status: 'match', mismatches: [] };
}

function typographyAxis(seed: string, report: DesignTokenReport, page: ComputedTokens): ConformanceAxis {
  const declared = declaredRoleTypography(seed, report);
  const entries = Object.entries(declared);
  if (entries.length === 0) return { status: 'unmeasurable', mismatches: [], reason: 'seed-role-typography-section-missing' };
  const mismatches: ConformanceMismatch[] = [];
  let comparisons = 0;
  let missingObservation: string | null = null;
  for (const [role, wanted] of entries) {
    const actual = page.roles[role];
    for (const [property, seedValue] of [['font-size', wanted.size], ['font-weight', wanted.weight]] as const) {
      if (!seedValue || seedValue === '—') continue;
      if (typeof actual?.[property] !== 'string') {
        missingObservation ??= `page-role-or-property-observation-missing:${role}.${property}`;
        continue;
      }
      comparisons += 1;
      const pageValue = actual[property] as string;
      if (pageValue !== seedValue) mismatches.push({ name: `${role}.${property}`, seed: seedValue, page: pageValue });
    }
  }
  if (comparisons === 0) return { status: 'unmeasurable', mismatches: [], reason: missingObservation ?? 'seed-role-typography-has-no-measurable-values' };
  if (missingObservation) return { status: 'unmeasurable', mismatches, reason: missingObservation };
  return { status: mismatches.length ? 'mismatch' : 'match', mismatches };
}

function cssFontFamilyList(value: string): string[] {
  return value.split(',').map((family) => family.trim().replace(/^(?:['\"])(.*)(?:['\"])$/, '$1').trim().toLowerCase());
}

function sameCssFontFamilyList(one: string, other: string): boolean {
  const left = cssFontFamilyList(one);
  const right = cssFontFamilyList(other);
  return left.length === right.length && left.every((family, index) => family === right[index]);
}

function fontFamilyAxis(report: DesignTokenReport, page: ComputedTokens): ConformanceAxis {
  const families = report.typography.tokens.filter((token) => /^--font-(?:family|display|body)(?:-[a-z0-9-]+)?$/i.test(token.name));
  if (families.length === 0) return { status: 'unmeasurable', mismatches: [], reason: 'seed-font-family-declaration-missing' };
  const actual = Object.values(page.roles).map((role) => role['font-family']).filter((value): value is string => typeof value === 'string');
  if (actual.length === 0) return { status: 'unmeasurable', mismatches: [], reason: 'page-font-family-observation-missing' };
  const mismatches = families.filter((token) => !actual.some((value) => sameCssFontFamilyList(token.value, value)))
    .map((token) => ({ name: token.name, seed: token.value, page: actual[0] }));
  return { status: mismatches.length ? 'mismatch' : 'match', mismatches };
}

/** Reports declared-versus-computed differences without scoring or prescribing a verdict. */
/**
 * 간격 축 — ⛔⭐ ***씨앗과 페이지를 «같은 자»로 잰다***(`RESULT-21` 의 교훈).
 *   씨앗은 `### 간격 눈금` 절을 «되읽고», 페이지는 같은 표현식으로 «다시 잰다».
 * ⛔ 「씨앗에 절이 없다」·「페이지를 못 쟀다」는 «어긋남이 아니라» 못 쟀음이다.
 * ⭐ 그리고 «상위 몇 종»만 본다 — 꼬리의 희귀 값까지 맞추라는 것은 «다시 짓기»가 아니다.
 */
function spacingAxis(seed: string, pageLayout: LayoutReport | null): ConformanceAxis {
  const seedSteps = readSeedSpacing(seed);
  if (seedSteps === null) return { status: 'unmeasurable', mismatches: [], reason: 'seed-spacing-section-missing' };
  if (pageLayout === null) return { status: 'unmeasurable', mismatches: [], reason: 'page-layout-not-measured(⚪ 「간격이 없다」가 아니다)' };
  if (pageLayout.spacing.length === 0) {
    return { status: 'unmeasurable', mismatches: [], reason: `page-spacing-empty(훑은 요소 ${pageLayout.sampled}개)` };
  }
  const TOP = 6;
  const pageValues = new Set(pageLayout.spacing.slice(0, TOP * 2).map((s) => s.px));
  const mismatches = seedSteps
    .slice(0, TOP)
    .filter((s) => !pageValues.has(s.px))
    .map((s) => ({ name: `${s.px}px`, seed: `${s.px}px (${s.count}회)`, page: [...pageValues].sort((a, b) => a - b).join(', ') }));
  return mismatches.length
    ? { status: 'mismatch', mismatches, reason: `씨앗 상위 ${TOP}종 ↔ 페이지 상위 ${Math.min(TOP * 2, pageLayout.spacing.length)}종` }
    : { status: 'match', mismatches: [] };
}

/**
 * 상태 전환 축 — ⭐ 「가속 곡선이 «디자인 서명»」이므로 «곡선»만 본다(길이·대상은 안 본다).
 * ⛔ 씨앗에 절이 없거나 페이지를 못 쟀으면 «어긋남이 아니라» 못 쟀음이다.
 * ⛔⭐ 페이지가 `transition: var(…)` 로 «못 갈랐으면» 그것도 못 쟀음이다 —
 *    「곡선이 없다」로 읽어 어긋남을 내면 «거짓 판정»이 된다.
 */
/**
 * ⛔⭐⭐ 2026-09-10 실측 — ***이 축이 「내 화면이 «더 옳을» 때」 「못 쟀음」을 냈다.***
 *
 *    이 자는 `:hover`·`:focus` **선택자에 걸린** `transition` 만 본다.
 *    그런데 ***표준 관행은 전환을 «기본» 선택자에 두는 것***이다 —
 *    그래야 들어갈 때와 «나올 때»가 «둘 다» 부드럽다. 상태 선택자에 두면 나올 때가 «툭» 끊긴다.
 *    📏 crates.io 는 상태 쪽에 뒀고, 내가 다시 지은 화면은 «기본» 쪽에 뒀다.
 *       ⇒ 페이지의 «계산된» 곡선은 `cubic-bezier(0.2, 0, 0, 1)` 로 13개 요소에 «걸려 있는데»
 *          이 축은 `page-declares-no-state-easing` 을 냈다.
 *
 * ✅ ⇒ 상태 쪽이 비면 ***«계산된» 전환으로 되짚는다***.
 *    ⛔ 그러나 «같다고» 말하지 않는다 — 사유에 어느 자리에서 얻었는지 남긴다
 *      (기본 전환은 「가리킬 때 이 곡선으로 바뀐다」를 «보증하지 않는다» — 다른 상태 규칙이 덮을 수 있다).
 */
/**
 * ⛔⭐ 곡선 문면을 «같은 자»로 만든다 — 2026-09-10 실측:
 *    씨앗 `cubic-bezier(0.2, 0, 0, 1)` ↔ 페이지 `cubic-bezier(0.2,0,0,1)`.
 *    ***같은 곡선인데 어긋남으로 나갔다*** (브라우저가 계산된 값의 공백을 접는다).
 * ⛔ 공백·대소문자«만» 접는다 — 수를 반올림하거나 단위를 바꾸면 «진짜 차이»가 사라진다.
 */
function canonicalEasing(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function stateMotionAxis(
  seed: string,
  page: StateMotionReport | null,
  computedEasings: readonly string[] = [],
  /**
   * ⭐⭐ 세 번째 층 — «움직임»의 곡선(단계 ⊕ 쓰는 자리 ⊕ 풀린 단축형).
   * 🩸 `RESULT-29`·`RESULT-30` 이 둘 다 ⚪ 로 적어 둔 칸이었다: 상태 축은 transition 만 보고
   *    키프레임 축은 속성 집합만 봐서 ***애니메이션 곡선을 «어느 축도» 안 셌다***.
   */
  animationEasings: readonly string[] = [],
): ConformanceAxis {
  const seedEasings = readSeedStateEasings(seed);
  if (seedEasings === null) return { status: 'unmeasurable', mismatches: [], reason: 'seed-state-motion-section-missing' };
  if (page === null) return { status: 'unmeasurable', mismatches: [], reason: 'page-state-motion-not-measured(⚪ 「상태 전환이 없다」가 아니다)' };
  if (seedEasings.length === 0) return { status: 'unmeasurable', mismatches: [], reason: 'seed-declares-no-state-easing(씨앗이 곡선을 «안 담았다»)' };
  const unresolved = page.rules.reduce((n, r) => n + r.unresolvedVars, 0);
  const fromState = new Set(page.rules.flatMap((r) => r.easings.map(canonicalEasing)));
  // ⭐⭐ 상태 쪽과 «계산된»(기본) 쪽을 «합친다».
  //    🩸 첫 판은 상태 쪽이 «비었을 때만» 되짚었다. 그런데 표준 패턴 하나가
  //       ***들어갈 때(상태)와 나올 때(기본)의 곡선을 «가르는» 것***이라, 그때 두 곡선이 «다른 층»에 산다.
  //       ⇒ 상태 쪽만 보면 「씨앗 2종 ↔ 페이지 1종」이라는 «참인데 틀린» 어긋남이 난다.
  const fromBase = new Set(computedEasings.map(canonicalEasing));
  const fromAnimation = new Set(animationEasings.map(canonicalEasing));
  const pageEasings = new Set([...fromState, ...fromBase, ...fromAnimation]);
  if (pageEasings.size === 0) {
    return {
      status: 'unmeasurable',
      mismatches: [],
      reason: unresolved > 0
        ? `page-easings-unresolved(${unresolved}개가 transition: var(…) — 못 갈랐다)`
        : `page-declares-no-state-easing(시트 ${page.sheetsRead}개 읽음 · 못 읽음 ${page.unreadableSheets}개 · 계산된 전환도 0)`,
    };
  }
  // ⛔ 「어디서 얻었나」를 사유에 «항상» 붙인다 — 두 자리가 보증하는 것이 다르다.
  //    상태 쪽 = 「가리킬 때 이 곡선」 · 기본 쪽 = 「평소·나올 때 이 곡선」.
  // ⛔ 층별 «수»를 항상 낸다 — 어디서 얻었는지에 따라 보증하는 것이 다르다.
  const source = `상태 선택자 ${fromState.size}종 ⊕ 계산된(기본) 전환 ${fromBase.size}종`
    + ` ⊕ 움직임 ${fromAnimation.size}종`;
  const mismatches = seedEasings
    .filter((e) => !pageEasings.has(canonicalEasing(e)))
    .map((e) => ({ name: e, seed: e, page: [...pageEasings].sort().join(' · ') }));
  return mismatches.length
    ? { status: 'mismatch', mismatches, reason: `씨앗 곡선 ${seedEasings.length}종 ↔ 페이지 ${pageEasings.size}종 · ${source}${unresolved ? ` (⚪ 페이지에 못 갈른 var() ${unresolved}개)` : ''}` }
    : { status: 'match', mismatches: [], reason: source };
}

/**
 * 「무엇이 움직이나」 축.
 *
 * ⛔⭐⭐ ***이름으로 대조하지 않는다.*** 씨앗의 이름은 사람이 붙인 것이고
 *    (원본 이름은 `svelte-1yb2jn5-…` 같은 빌드 해시일 수 있다),
 *    이름으로 채점하면 ***「다시 지었다」가 「베꼈다」와 같은 뜻이 된다.***
 * ✅ 그래서 대조하는 값은 ***「움직이는 속성의 «집합»」***이다 —
 *    `opacity`·`transform` 이 움직이면 그 사이트의 성격이 재현된 것이다.
 *
 * ⛔ 그리고 페이지 쪽은 ***«쓰이는» 것만*** 센다 — 정의만 된 것은 서명이 아니다.
 */
function keyframesAxis(seed: string, page: KeyframesReport | null): ConformanceAxis {
  const seedFrames = readSeedKeyframes(seed);
  if (seedFrames === null) return { status: 'unmeasurable', mismatches: [], reason: 'seed-keyframes-section-missing' };
  if (page === null) return { status: 'unmeasurable', mismatches: [], reason: 'page-keyframes-not-measured(⚪ 「움직임이 없다」가 아니다)' };
  if (seedFrames.length === 0) {
    return { status: 'unmeasurable', mismatches: [], reason: 'seed-declares-no-keyframes(씨앗이 움직임을 «안 담았다»)' };
  }
  const used = page.animations.filter((a) => a.usedBy > 0);
  const pageProps = new Set(used.flatMap((a) => a.animatedProperties.map((p) => p.trim())));
  if (pageProps.size === 0) {
    return {
      status: 'mismatch',
      mismatches: seedFrames.map((f) => ({
        name: f.name,
        seed: [...new Set(f.steps.flatMap((s) => s.declarations.map((d) => d.split(':')[0]!.trim())))].sort().join(' · '),
        page: null,
      })),
      // ⛔ 「정의만 된 것」이 있으면 그 수를 낸다 — 「없다」와 「안 쓴다」는 다른 값이다.
      reason: `page-uses-no-keyframes(정의만 된 것 ${page.definedButUnused.length}개 · 시트 ${page.sheetsRead}개 읽음 · 못 읽음 ${page.unreadableSheets}개)`,
    };
  }
  const mismatches: ConformanceMismatch[] = [];
  for (const frame of seedFrames) {
    const props = [...new Set(frame.steps.flatMap((step) => step.declarations.map((d) => d.split(':')[0]!.trim())))].sort();
    const missing = props.filter((prop) => !pageProps.has(prop));
    if (missing.length === 0) continue;
    mismatches.push({ name: frame.name, seed: missing.join(' · '), page: [...pageProps].sort().join(' · ') });
  }
  const summary = `씨앗 움직임 ${seedFrames.length}개 ↔ 페이지 «쓰이는» 것 ${used.length}개 (속성 ${pageProps.size}종)`;
  return mismatches.length
    ? { status: 'mismatch', mismatches, reason: summary }
    : { status: 'match', mismatches: [], reason: summary };
}

/**
 * 반응형 축.
 *
 * ⛔⭐ ***「같은 값인가」가 아니라 「같은 «규칙»인가」***를 묻는다:
 *    ⓐ 분기가 씨앗의 «구간»과 겹치나 (⛔ 「462 == 462」가 아니다 — 구간은 구간과 견준다)
 *    ⓑ 눈금이 «같은 비율»로 커지나 (값이 달라도 규칙이 같으면 그 스타일이다)
 * ⛔ 둘 중 씨앗이 «안 담은» 칸은 판정하지 않는다 — 없는 것을 어긋남으로 만들지 않는다.
 */
function responsiveAxis(
  seed: string,
  page: SeedConformanceInput['pageResponsive'],
): ConformanceAxis {
  const seedBreakpoint = readSeedBreakpoint(seed);
  const seedScale = readSeedProportional(seed);
  if (seedBreakpoint === null && seedScale === null) {
    return { status: 'unmeasurable', mismatches: [], reason: 'seed-responsive-section-missing' };
  }
  if (page === null || page === undefined) {
    // ⛔ 「반응형이 아니다」가 아니라 「안 쟀다」 — 이 축은 폭을 «명시»해야 잰다.
    return {
      status: 'unmeasurable',
      mismatches: [],
      reason: 'page-not-measured-at-multiple-widths(⚪ 폭을 «명시»해야 잰다 — 비용이 3배다)',
    };
  }
  const mismatches: ConformanceMismatch[] = [];
  const notes: string[] = [];
  if (seedBreakpoint !== null) {
    const pageBreakpoints = page.breakpoints ?? [];
    const shown = pageBreakpoints.map((b) => `${b.lowPx}↔${b.highPx}px`).join(' · ');
    if (pageBreakpoints.length === 0) {
      notes.push('⚪ 페이지 분기를 «못 좁혔다»');
    } else if (!pageBreakpoints.some((b) => rangesOverlap(seedBreakpoint, b))) {
      // ⛔ 「하나도 안 겹친다」일 때만 어긋남이다 — 페이지에 분기가 여럿이어도 «하나»가 맞으면 맞음.
      mismatches.push({
        name: '분기 구간',
        seed: `${seedBreakpoint.lowPx}px ↔ ${seedBreakpoint.highPx}px`,
        page: shown,
      });
    } else {
      notes.push(`분기 ${shown} 중 하나가 씨앗 구간과 «겹친다»`);
    }
  }
  if (seedScale !== null) {
    const pageRatio = page.proportionalRatio ?? null;
    if (pageRatio === null) {
      notes.push('⚪ 페이지 비례 눈금을 «못 봤다»');
    } else if (!ratiosAgree(seedScale.ratio, pageRatio)) {
      mismatches.push({ name: '비례 눈금', seed: `×${seedScale.ratio}`, page: `×${pageRatio}` });
    } else {
      notes.push(`비례 ×${pageRatio} 가 씨앗 ×${seedScale.ratio} 와 «같은 규칙»이다`);
    }
  }
  const reason = [page.widths?.length ? `폭 ${page.widths.join('·')}px 에서 쟀다` : null, ...notes]
    .filter((line): line is string => line !== null)
    .join(' · ');
  // ⛔ 판정할 칸이 «하나도» 없었으면 「맞음」이 아니라 「못 쟀음」이다.
  if (mismatches.length === 0 && notes.every((n) => n.startsWith('⚪'))) {
    return { status: 'unmeasurable', mismatches: [], reason: reason || 'nothing-comparable' };
  }
  return mismatches.length
    ? { status: 'mismatch', mismatches, reason }
    : { status: 'match', mismatches: [], reason };
}

export function compareSeedConformance(input: SeedConformanceInput): SeedConformance {
  const seed = typeof input.seed === 'string' ? input.seed : '';
  const report = typeof input.seed === 'string' ? reportDesignTokens(input.seed) : input.seed;
  return {
    color: colorAxis(report, input.page),
    typography: typographyAxis(seed, report, input.page),
    fontFamily: fontFamilyAxis(report, input.page),
    spacing: spacingAxis(seed, input.pageLayout ?? null),
    keyframes: keyframesAxis(seed, input.pageKeyframes ?? null),
    responsive: responsiveAxis(seed, input.pageResponsive ?? null),
    stateMotion: stateMotionAxis(
      seed,
      input.pageStateMotion ?? null,
      // ⭐ 「같은 방문에서 잰」 계산된 전환 — ⛔ 못 쟀으면 빈 배열이고, 그때는 되짚지 «않는다».
      //    ⛔⭐ 그 칸이 «아예 없는» 옛 산출도 던지지 «않는다» — 이 저장소가 이미 못 박은 불변식이고,
      //       내가 이 줄을 처음 쓸 때 그것을 어겨 시험 17개가 물었다(2026-09-10).
      input.page.transitions?.status === 'measured' ? input.page.transitions.easings.map((e) => e.value) : [],
      // ⭐ 「같은 방문에서 잰」 움직임 곡선 — ⛔ 못 쟀으면 빈 배열이고, 그때는 «안 센다».
      input.pageKeyframes?.easings ?? [],
    ),
  };
}
