// ── computed 토큰 → `DESIGN.md` 렌더러 — 하이브리드 추출의 «산출» (2026-09-08) ──
//
// ⛔⭐ 왜 하이브리드인가 — 오늘 실측이 그 답을 냈다:
//    A 정적 미러      픽셀 RMSE ***4.67%*** · 본문 98.3% · 비용 «초·무료»
//                    ⇒ ***에셋(이미지·폰트)을 가장 싸고 충실하게 가져온다***
//                    ⛔ 그런데 «유지보수 가능한 코드»가 아니고, 남의 저작물이다
//    B′ computed 추출 디자인 토큰 ***59개*** (정규식 판 19) · clamp·var·cascade 가 «풀린 값»
//                    ⇒ ***look&feel 의 «규칙»을 정확히 가져온다*** · 비용 «30초·무료»
//    C Vision        색은 7/8 로 좋은데 내용 ***7.8%*** · LLM 비용
//                    ⇒ ⛔ 라이브 URL 이 있으면 쓸 이유가 약하다
//    🔑 ⇒ ***에셋은 A 에서, 규칙은 B′ 에서.*** 이 파일은 B′ 의 산출을 씨앗 문서로 바꾼다.
//
// 원칙:
//   • ⭐ 산출은 elanous `design-check` 가 «그대로 읽는» 문법이다 — `## 절` + `- ` 불릿.
//     ⛔ 새 파서를 만들지 않는다(`design-doc.ts` 의 `readSectionItems` 가 정본).
//   • ⛔ 추측하지 않는다 — 못 읽은 축은 절을 «비우고» 그 사실을 문서에 적는다.
//   • ⛔ 이 파일은 파일·네트워크를 안 만진다. 순수하다.

import {
  ALPHA_NEEDS_BACKGROUND, DEFAULT_DELTA_E, countUncomposited, formatMergedColor,
  mergePerceptualDuplicates, parseRgb,
} from './color-perception.js';
import { renderLayoutSection } from './layout-tokens.js';
import { renderResponsiveSection } from './responsive-layout.js';
import { renderStateMotionSection } from './state-motion.js';
import { renderKeyframesSection } from './keyframes.js';
import { formatBreakpointRange } from './breakpoint-search.js';

export interface ComputedRoleView {
  readonly [prop: string]: unknown;
}

/**
 * ⛔⭐ 이 두 타입은 «여기서 선언하지 않는다» — `computed-tokens.ts` 가 정본이다.
 *
 * 🩸 2026-09-10 실측: 같은 모양이 «두 벌»이었고, 측정 쪽에 칸을 더해도(획·국소 바탕)
 *    이쪽 선언은 «안 따라와» 소비 코드가 그 칸을 못 봤다(타입 에러 4건).
 *    ⇒ 「두 벌이면 한쪽이 늙는다」를 이 자리가 그대로 보여 줬다.
 * ✅ 한 벌로 모으고 이름만 이어 준다(밖에서 이 이름으로 가져가는 곳은 «없다» — 전수로 확인).
 */
export type { PaintedColorFrequency, PaintedColors } from './computed-tokens.js';
// ⛔ `export type … from` 은 «내보내기»만 한다 — 이 파일 «안»에서 쓰려면 따로 들여야 한다.
import type { PaintedColorFrequency, PaintedColors } from './computed-tokens.js';

export interface DesignMdInput {
  /** 프로덕션 추출 경로가 `parseExtraction`에서 받는 진단 포함 원본 입력. */
  readonly tokens: import('./computed-tokens.js').ComputedTokens;
  readonly title: string | null;
  // ⛔🩸 아래 셋은 «tokens 의 같은 칸을 되풀이»한다. 한때 «필수»로 선언돼 있었는데
  //    구현은 `customProperties`·`roles` 를 «tokens 에서» 읽고 `paintedColors` 만 겉에서 읽었다.
  //    ⇒ 계약과 구현이 갈렸고, 운영 호출부(`extract-design-run`·`archive-run`)가 옛 «평평한» 모양으로
  //      부르다 2026-09-10 에 «런타임에 죽었다»(`diagnostics.customProperties` 가 undefined).
  //    ✅ 이제 «선택»이고, 안 주면 `tokens` 에서 읽는다 — 되풀이가 계약을 못 깬다.
  /** ⚪ 선택 — 안 주면 `tokens.customProperties` */
  readonly customProperties?: Readonly<Record<string, string>>;
  /** ⚪ 선택 — 안 주면 `tokens.roles` */
  readonly roles?: Readonly<Record<string, ComputedRoleView>>;
  /** ⚪ 선택 — 안 주면 `tokens.paintedColors`. `null` 은 「못 쟀다」로 «명시»한 값이다. */
  readonly paintedColors?: PaintedColors | null;
  /** ⛔ 관측된 «불가능한 위계». 빈 배열은 「위반 없음」이고, 이 칸이 «없으면» tokens 에서 읽는다. */
  readonly typographyWarnings?: readonly import('./computed-tokens.js').TypographyWarning[];
  /** ⭐ 실제로 쓰인 크기 사다리. ⚪ 안 주면 추출본의 것을 쓰고, 그것도 없으면 절을 «안 만든다». */
  readonly typeScale?: readonly import('./computed-tokens.js').TypeScaleStep[];
  /** ⚪ 선택 — 간격·폭 관측. `null` 은 「못 쟀다」로 «명시»한 값이고, 안 주면 절을 «생략»한다. */
  readonly layout?: import('./layout-tokens.js').LayoutReport | null;
  /** ⚪ 선택 — 여러 폭에서 잰 결과. 안 주면 반응형 절을 «안 만든다». */
  readonly responsive?: import('./responsive-layout.js').ResponsiveReport;
  /** ⚪ 선택 — 분기 «후보»를 이분으로 좁힌 구간. 안 주면 그 줄을 «안 만든다». */
  readonly breakpointRanges?: readonly { readonly between: readonly [number, number]; readonly range: import('./breakpoint-search.js').BreakpointRange | null }[];
  /** ⚪ 선택 — 가리킴·누름 상태의 전환. `null` 은 「못 쟀다」로 «명시»한 값이다. */
  readonly stateMotion?: import('./state-motion.js').StateMotionReport | null;
  readonly keyframes?: import('./keyframes.js').KeyframesReport | null;
  /** 미러가 실제로 받아 온 자산 경로 */
  readonly assets: readonly string[];
}

const COLOR_RE = /^(#|rgb|hsl|oklch|color\()/i;

/** ⛔ Tailwind 내부 배관(`--tw-*`)은 «디자인 신호가 아니다» — 씨앗에 넣으면 소음이 된다. */
export function designTokens(props: Readonly<Record<string, string>>): Array<{ name: string; value: string }> {
  return Object.entries(props)
    .filter(([name]) => !name.startsWith('--tw-'))
    .map(([name, value]) => ({ name, value: value.trim() }))
    .filter((t) => t.value !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function splitTokens(tokens: ReadonlyArray<{ name: string; value: string }>): {
  palette: Array<{ name: string; value: string }>;
  typography: Array<{ name: string; value: string }>;
  motion: Array<{ name: string; value: string }>;
  other: Array<{ name: string; value: string }>;
} {
  const palette: Array<{ name: string; value: string }> = [];
  const typography: Array<{ name: string; value: string }> = [];
  const motion: Array<{ name: string; value: string }> = [];
  const other: Array<{ name: string; value: string }> = [];
  for (const t of tokens) {
    if (COLOR_RE.test(t.value)) palette.push(t);
    else if (/font|text|leading|tracking|weight/i.test(t.name)) typography.push(t);
    else if (/anim|ease|duration|transition|motion/i.test(t.name)) motion.push(t);
    else other.push(t);
  }
  return { palette, typography, motion, other };
}

/** `rgb(23, 45, 36)` · `#172d24` 를 «같은 값»으로 본다. ⛔ 못 풀면 null(0으로 접지 않는다). */
export function normaliseColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return `#${h}`;
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Number(n)));
    if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

/**
 * ⭐⭐ **값 → 토큰 «이름» 역참조.** 이게 없으면 씨앗의 `## Contrast pairs` 를 파서가 «못 읽는다».
 *
 * 🩸 실측 2026-09-08: 첫 판이 쌍을 «값»(`rgb(23,45,36)`)으로 적었고,
 *    `readContrastPairs` 는 «토큰 이름»(`--ink on --ground`)을 기대해 ***0건***을 읽었다.
 *    ⇒ 렌더러는 「썼다」고 믿고 파서는 「없다」고 말하는, 오늘 반복해서 본 그 모양이다.
 */
export function nameForColor(
  value: string,
  palette: ReadonlyArray<{ name: string; value: string }>,
): string | null {
  const want = normaliseColor(value);
  if (want === null) return null;
  // ⛔ 같은 값에 이름이 여럿이면 «먼저 것»을 쓴다 — 어느 것이 의도인지 문서가 안 말한다.
  for (const t of palette) if (normaliseColor(t.value) === want) return t.name;
  return null;
}

/** 역할에서 「글자색 ↔ 바탕색」 쌍을 뽑는다. ⛔ 투명 바탕은 «쌍이 아니다»(뒤가 뭔지 모른다). */
export function contrastPairsFrom(
  roles: Readonly<Record<string, ComputedRoleView>>,
): Array<{ role: string; color: string; background: string }> {
  const out: Array<{ role: string; color: string; background: string }> = [];
  for (const [role, v] of Object.entries(roles)) {
    const color = typeof v['color'] === 'string' ? (v['color'] as string) : null;
    const bg = typeof v['background-color'] === 'string' ? (v['background-color'] as string) : null;
    if (!color || !bg) continue;
    if (/rgba\([^)]*,\s*0\s*\)/.test(bg) || bg === 'transparent') continue;
    out.push({ role, color, background: bg });
  }
  return out;
}

function bullets(items: ReadonlyArray<{ name: string; value: string }>): string {
  return items.length === 0 ? '' : items.map((t) => `- ${t.name}: ${t.value}`).join('\n');
}

/**
 * ⭐ 페이지의 «바탕» — 가장 많이 쓰인 «불투명한» 배경색.
 * ⛔ 없으면 `undefined` — ***흰색으로 «몰지» 않는다***(어두운 테마 사이트에서 전부 틀린다).
 */
function groundColor(paintedColors: PaintedColors): string | undefined {
  for (const color of paintedColors.backgrounds) {
    const parsed = parseRgb(color.value);
    if (parsed !== null && parsed.a >= 1) return color.value;
  }
  return undefined;
}

function paintedColorRankings(paintedColors: PaintedColors | null): string[] {
  if (paintedColors === null) return ['⚪ painted 색을 **못 쟀다** — 요소를 훑지 못했다.'];
  const ground = groundColor(paintedColors);
  // ⭐⭐ 국소 바탕 — 한 알파색이 «여러» 바탕 위에 있으면 페이지 바탕 하나로 편 값은 «부분»이다.
  //    ⛔ 조용히 하나를 고르지 않는다 — 그 사실을 «값으로» 낸다.
  const overs = paintedColors.alphaOver ?? [];
  const multiGround = overs.filter((o) => o.grounds.length > 1);
  const fold = (colors: readonly PaintedColorFrequency[]) =>
    mergePerceptualDuplicates(colors.map((c) => ({ value: c.value, count: c.count })), DEFAULT_DELTA_E, ground);
  const rankings = (label: string, colors: readonly PaintedColorFrequency[]) => {
    const total = colors.reduce((sum, color) => sum + color.count, 0);
    if (total === 0) return `- ${label}: 관측된 색이 없다 (0개 요소)`;
    // ⭐ 「눈이 같다고 보는 색」을 접는다 — ⛔ 알파는 «바탕 위에 합성한 뒤»에 잰다.
    //    ⛔ 접은 것을 «말한다»(대표 줄에 목록이 붙는다) — 조용히 사라지면 「색이 줄었다」로 오독된다.
    return fold(colors)
      .map((c) => `- ${label}: ${formatMergedColor(c, total)}`)
      .join('\n');
  };
  const all = [...paintedColors.backgrounds, ...paintedColors.text];
  const foldedCount = all.length - (fold(paintedColors.backgrounds).length + fold(paintedColors.text).length);
  const uncomposited = countUncomposited(all.map((c) => ({ value: c.value, count: c.count })), ground);
  return [
    `> ⭐ 지각적으로 «같은» 색을 접었다 — 접힌 문면 **${foldedCount}개** (임계 ΔE ${DEFAULT_DELTA_E} · CIE76).`,
    ground === undefined
      // ⛔ 「바탕을 못 골랐다」를 «말한다» — 이때 투명한 색은 하나도 안 접힌다
      ? `> ⚪ **바탕색을 «못 골랐다»** — 불투명한 배경 관측이 없다. ⛔ ${ALPHA_NEEDS_BACKGROUND}.`
      : `> ⭐ 알파는 **바탕 \`${ground}\` 위에 합성한 뒤** 쟀다 — ⛔ 한 겹이다(겹쳐 쌓인 반투명은 못 편다).`,
    uncomposited > 0 ? `> ⚪ 그래서 **${uncomposited}개**의 투명한 색이 «안 접힌 채» 남아 있다 — 부풀어 보인다.` : '',
    // ⛔⭐ 한 색이 «여러» 바탕 위에 놓였으면 페이지 바탕 하나로 편 값은 그 색의 «한 경우»일 뿐이다.
    paintedColors.alphaOver === undefined
      ? '> ⚪ 국소 바탕을 **못 쟀다** — 알파는 페이지 바탕 하나로만 폈다.'
      : multiGround.length > 0
        ? `> ⛔⭐ **${multiGround.length}개**의 투명한 색이 «여러 바탕» 위에 있다 — `
          + `${multiGround.slice(0, 3).map((o) => `\`${o.value}\` (바탕 ${o.grounds.length}종)`).join(' · ')}`
          + '. 아래 합성값은 «페이지 바탕» 기준이라 그 색의 «한 경우»일 뿐이다.'
        : '',
    `> ⛔ 접힌 것은 대표 줄 옆에 «이름으로» 남는다 — 사라지지 않는다.`,
    '',
    rankings('배경', paintedColors.backgrounds),
    rankings('글자', paintedColors.text),
  ].filter((line) => line !== '');
}

function transitionBullets(input: DesignMdInput): string[] {
  const transitions = input.tokens.transitions;
  if (transitions.status === 'unreadable') return ['⚪ 계산된 전환을 **못 쟀다** — 요소를 훑지 못했다. ⛔ 「움직임이 없다」가 아니다.', `> 한계: ${transitions.limitation}`];
  if (transitions.status === 'none') return ['- 계산된 전환이 걸린 요소: 0개 — **움직임이 없다**.', `> 한계: ${transitions.limitation}`];
  const frequencies = (label: string, values: readonly { value: string; count: number }[]) =>
    values.map(({ value, count }) => `- ${label}: ${value} (${count}개 요소)`).join('\n');
  return [
    `- 계산된 전환이 걸린 요소: ${transitions.elementCount}개`,
    frequencies('길이', transitions.durations),
    frequencies('가속 곡선', transitions.easings),
    frequencies('대상 프로퍼티', transitions.properties),
    `> 한계: ${transitions.limitation}`,
  ].filter(Boolean);
}

/**
 * 씨앗 문서를 낸다.
 *
 * ⛔ 빈 절은 «지우지 않고» 「못 읽었다」를 적어 둔다 — 비어 있는 것과 없는 것은 다른 값이다.
 */
/**
 * ⛔⭐⭐⭐ ***「축이 전부 ⚪」와 「페이지가 안 열렸다」는 다른 값이다.***
 *
 * 📏 2026-09-10 실측(coupang): 역할 2개(body·h1)만 잡히고 링크·버튼·머리·바닥이 «전부» 없고
 *    커스텀 속성 0개 · 간격 2종 · 팔레트 2개가 나왔다. 각 절은 정직하게 ⚪ 를 냈지만,
 *    ***열 대상 교차표에서 그것이 「쿠팡은 팔레트가 2개인 사이트」로 «보였다»***.
 * 🔑 판정선은 «임의 임계»가 아니라 구조로 잡는다 — ***링크도 버튼도 머리도 바닥도 «하나도» 없는 것은
 *    「단순한 웹 페이지」가 아니라 「웹 페이지가 아니다」***. 봇 벽·동의 벽·늦은 렌더의 모양이다.
 * ⛔ 「못 쟀다」로만 두지 않고 «한 줄로 말한다» — 읽는 쪽이 이 씨앗을 안 쓰게.
 */
export function pageBarelyRendered(diagnostics: {
  readonly missing: readonly string[];
  readonly customProperties?: unknown;
}): string | null {
  const dead = ['link', 'button', 'header', 'footer'];
  const missing = new Set(diagnostics.missing);
  if (!dead.every((r) => missing.has(r))) return null;
  return `📏 링크·버튼·머리·바닥이 **하나도** 안 잡혔다 (못 잰 역할: ${diagnostics.missing.join(', ')}).`;
}

export function renderDesignMd(input: DesignMdInput): string {
  const { tokens: diagnostics } = input;
  const tokens = designTokens(diagnostics.customProperties);
  const { palette, typography, motion, other } = splitTokens(tokens);
  const pairs = contrastPairsFrom(diagnostics.roles);
  const L: string[] = [];

  L.push(`# Design — ${input.title ?? diagnostics.url}`);
  L.push('');
  L.push('> ⛔ **추출본이다.** 브라우저가 «계산한» 값(cascade·`clamp()`·`var()` 가 풀린 값)만 담았다.');
  L.push('> 판단·이름·의도는 사람이 채운다 — ⛔ 여기 있는 이름은 «원본의 이름»이지 내 결정이 아니다.');
  L.push(`> 📏 원본: ${diagnostics.url} · 뷰포트 ${diagnostics.viewport.w}×${diagnostics.viewport.h} (잰 값)`);
  L.push(`> 측정 조건: 브라우저 reduced-motion 강제 ${diagnostics.browserForcedReducedMotion ? 'ON' : 'OFF'} — 페이지의 접근성 정책과 다른 축이다.`);
  const notRendered = pageBarelyRendered(diagnostics);
  if (notRendered !== null) {
    L.push('>');
    L.push(`> 🚨🚨 **⛔ 이 페이지는 사실상 «안 열렸다» — 아래 값 전부를 그렇게 읽어라.**`);
    L.push(`> ${notRendered}`);
    L.push('> 🔑 ⇒ ***「이 사이트는 디자인이 단순하다」가 «아니다». 「내가 못 봤다」다.***');
    L.push('> ⚠️ 봇 차단·동의 벽·늦은 렌더가 흔한 원인이다 — 다시 재기 전에는 이 문서를 씨앗으로 쓰지 마라.');
  }
  L.push('');
  L.push('## Craft rulebooks');
  L.push('');
  for (const r of ['anti-ai-slop', 'accessibility-baseline', 'animation-discipline', 'color', 'typography', 'typography-hierarchy-editorial']) {
    L.push(`- ${r}`);
  }
  L.push('');

  L.push('## Palette');
  L.push('');
  L.push(palette.length ? bullets(palette) : '⚠️ 색 토큰을 «못 읽었다** — 원본이 커스텀 프로퍼티를 안 쓰거나 이름이 다르다.');
  L.push('');

  L.push('## Painted colors');
  L.push('');
  L.push('> 실제 요소의 computed 색을 센 순위다 — 토큰 목록과 다르며 배경과 글자를 섞지 않는다.');
  // ⛔ `undefined`(안 줌)와 `null`(못 쟀다고 «말함»)을 가른다 — 안 줬으면 tokens 에서 읽는다
  L.push(...paintedColorRankings(input.paintedColors === undefined ? diagnostics.paintedColors : input.paintedColors));
  L.push('');

  L.push('## Typography');
  L.push('');
  // ⛔⭐ 경고를 «표 앞»에 둔다 — 표를 먼저 읽으면 그 수를 믿어 버린다.
  const warnings = input.typographyWarnings ?? input.tokens.typographyWarnings ?? [];
  if (warnings.length) {
    // ⛔⭐⭐ 문면이 «두 번» 늙었다 — 2026-09-10 열 대상 전수가 그 이유를 냈다.
    //   옛 문면: 「이 표의 위계는 «불가능하다»」 ⊕ 원인은 「문서 첫 번째를 잡는 것」.
    //   📏 그런데 선택을 「가장 흔한 모양」으로 고쳐도 ***6/10 이 그대로였다***(못 박은 선은 ≤3/10).
    //   🔑 ⇒ 틀린 것은 «선택»이 아니라 ***이 경고의 «전제»***였다:
    //      ***현대 마케팅 페이지에서 DOM 제목 «단계»는 시각 «크기»를 따라가지 않는다.***
    //      apple 의 h2 64px > h1 34px 는 결함이 아니라 «설계»다.
    //   ⇒ 그러니 「불가능하다」가 아니라 「따라가지 «않는다»」라고 말하고, 아래 «활자 눈금»을 가리킨다.
    L.push('> ⚠️ ***DOM 제목 «단계»가 시각 «크기»를 따라가지 않는다*** — ⛔ 「씨앗이 틀렸다」가 «아니다».');
    L.push('>');
    for (const warning of warnings) {
      const what = warning.violation === 'not-larger-than-body'
        ? '`body` 보다 «크지 않다»'
        : '앞선 제목보다 «작지 않다»';
      L.push(`> - \`${warning.role}\` 이 ${what}`);
    }
    L.push('>');
    L.push('> 🔑 ⇒ ***다시 지을 때 따라야 할 것은 «태그 순서»가 아니라 아래 「활자 눈금」이다.***');
    L.push('> ⛔ 이 자는 값을 «보정하지 않는다» — 재고 «말할» 뿐이다.');
    L.push('> 📏 2026-09-10 열 대상 전수: **6/10** 이 이 상태였다 ⇒ 예외가 아니라 «흔한 일»이다.');
    L.push('');
  }
  L.push(typography.length ? bullets(typography) : '⚠️ 타이포 토큰을 «못 읽었다**.');
  if (diagnostics.roles['h1'] || diagnostics.roles['body']) {
    L.push('');
    L.push('### 측정된 역할 (computed — ⛔ 토큰이 아니라 «실제 값»이다)');
    L.push('');
    L.push('| 역할 | size | weight | line-height | letter-spacing |');
    L.push('|---|---|---|---|---|');
    for (const [role, v] of Object.entries(diagnostics.roles)) {
      const g = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '—');
      L.push(`| ${role} | ${g('font-size')} | ${g('font-weight')} | ${g('line-height')} | ${g('letter-spacing')} |`);
    }
  }
  const headingSizes = ['h1', 'h2', 'h3'].flatMap((role) => {
    const value = diagnostics.roles[role]?.['font-size'];
    const size = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
    return Number.isFinite(size) ? [{ role, size, value }] : [];
  });
  if (headingSizes.length > 0) {
    L.push('');
    L.push('### 계층 진단');
    L.push('');
    L.push(`- 측정된 제목 후보: ${headingSizes.map(({ role, value }) => `${role} ${value}`).join(' → ')}`);
    for (let index = 1; index < headingSizes.length; index += 1) {
      const parent = headingSizes[index - 1];
      const child = headingSizes[index];
      if (child.size >= parent.size) L.push(`- ⚠️ 후보 불일치: ${child.role} (${child.value})가 ${parent.role} (${parent.value})보다 작지 않다 — 시각 계층을 확인한다.`);
    }
  }
  const scale = input.typeScale ?? diagnostics.typeScale;
  if (scale !== undefined && scale.length > 0) {
    L.push('');
    L.push('### 활자 «눈금» — ⭐ ***실제로 쓰인 크기***(태그가 아니라)');
    L.push('');
    L.push('> ⛔ 「글자를 «직접» 담은 보이는 요소」만 셌다. 큰 것부터, 같은 크기면 많이 쓰인 순.');
    L.push('');
    for (const step of scale.slice(0, 12)) {
      L.push(`- ${step.size}px / ${step.weight} — ${step.count}개 요소`);
    }
    if (scale.length > 12) L.push(`- … 그 밖 ${scale.length - 12}칸`);
  }

  // ⛔⭐ 「고른 모양을 몇 개가 입었나」를 «낸다» — 40 중 1 이면 그 값은 «대표»가 아니다.
  //    📏 이 자는 이제 「문서 첫 번째」가 아니라 「가장 흔한 모양」을 고른다(2026-09-10) —
  //    그 선택이 «소수»에 기댔을 때 읽는 쪽이 알아야 한다.
  const thin = Object.entries(diagnostics.roles)
    .map(([role]) => [role, diagnostics.diagnostics?.[role]] as const)
    .filter(([, d]) => d !== undefined && d.chosenCount !== undefined && d.visible > 3 && d.chosenCount * 2 <= d.visible);
  if (thin.length > 0) {
    L.push('');
    L.push(`- ⚠️ 고른 모양이 «과반이 아닌» 역할: ${thin.map(([role, d]) => `${role} (${d!.chosenCount}/${d!.visible} · 모양 ${d!.styleGroups}종)`).join(' · ')} — 이 역할의 값은 «대표»가 아닐 수 있다.`);
  }
  if (diagnostics.missing.length > 0) {
    L.push('');
    L.push(`- ⚠️ 측정하지 못한 역할 후보: ${diagnostics.missing.join(', ')} — 이 역할들의 계층·스타일은 이 문서에서 판단하지 않는다.`);
  }
  L.push('');

  L.push('## Motion');
  L.push('');
  L.push(motion.length ? bullets(motion) : '⚠️ 모션 토큰을 «못 읽었다**.');
  L.push(...transitionBullets(input));
  L.push('');
  L.push(`- \`prefers-reduced-motion\` 존중: ${diagnostics.honoursReducedMotion === true ? '✅ 있다'
    : diagnostics.honoursReducedMotion === false ? '🔴 **없다 — 이대로 베끼면 접근성 바닥이 뚫린다**'
    : '⚪ **못 읽었다** — 교차 출처 스타일시트라 규칙을 안 준다. ⛔ 「없다」가 아니다'}`);
  L.push('');

  // ⭐ 52차부터 「씨앗에 «아예 없다»」로 이월돼 있던 축. 안 주면 절을 «안 만든다»(빈 절 소음 금지).
  if (input.layout !== undefined) {
    L.push(...renderLayoutSection(input.layout));
    L.push('');
    if (input.responsive !== undefined) {
      L.push(...renderResponsiveSection(input.responsive));
      if (input.breakpointRanges?.length) {
        L.push('');
        L.push('#### 분기 «구간» — 이분으로 좁혔다');
        for (const b of input.breakpointRanges) L.push(...formatBreakpointRange(b.range, b.between));
      }
      L.push('');
    }
  }

  if (input.keyframes !== undefined) {
    L.push(...renderKeyframesSection(input.keyframes));
    L.push('');
  }
  if (input.stateMotion !== undefined) {
    L.push(...renderStateMotionSection(input.stateMotion));
    L.push('');
  }

  L.push('## Contrast pairs');
  L.push('');
  L.push('> ⭐ 실제로 겹치는 쌍만 적는다 — 전 조합을 재면 경고가 소음이 된다.');
  L.push('> ⛔ 아래는 **원본에서 관측된 쌍**이고, 토큰 이름으로 다시 쓰는 것은 사람 몫이다.');
  L.push('');
  // ⭐ 파서가 읽는 것은 «토큰 이름» 쌍이다. 이름을 못 찾은 쌍은 아래 주석 줄로 «따로» 남긴다.
  const named: string[] = [];
  const unnamed: string[] = [];
  const seenPair = new Set<string>();
  for (const p of pairs) {
    const fg = nameForColor(p.color, palette);
    const bg = nameForColor(p.background, palette);
    if (fg && bg && fg !== bg) {
      const key = `${fg}|${bg}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      named.push(`- ${fg} on ${bg}`);
    } else {
      unnamed.push(`  · ${p.role}: \`${p.color}\` on \`${p.background}\``);
    }
  }
  L.push(named.length ? named.join('\n') : '⚠️ 토큰 «이름»으로 풀리는 쌍이 «없었다** — 아래 원값을 보고 사람이 이름을 붙인다.');
  if (unnamed.length) {
    L.push('');
    L.push('> ⛔ 아래는 «토큰 이름을 못 찾은» 쌍이다(원본이 그 색을 커스텀 프로퍼티로 안 뒀다).');
    L.push('> 파서는 이 줄들을 «안 읽는다** — 사람이 위 목록으로 올려야 검사에 든다.');
    L.push('>');
    for (const u of unnamed) L.push(`> ${u.trim()}`);
  }
  L.push('');

  if (other.length) {
    L.push('## 그 밖의 토큰 (분류 안 됨)');
    L.push('');
    L.push('> ⛔ 자동 분류가 못 가른 것들이다. 사람이 위 절로 옮기거나 버린다.');
    L.push('');
    L.push(bullets(other));
    L.push('');
  }

  L.push('## Assets');
  L.push('');
  L.push('> ⛔ **아래는 원본 저작물이다.** 재현 «근거»로 로컬에 두고 «공개 재배포하지 않는다**.');
  L.push('> 배포하려면 자기 에셋으로 교체한다 — 그것이 클론과 파생물을 가르는 선이다.');
  L.push('');
  L.push(input.assets.length ? input.assets.map((a) => `- ${a}`).join('\n') : '⚠️ 미러가 자산을 «못 받았다**.');
  L.push('');

  L.push('## ⛔ 이 추출본이 «답하지 못하는» 것');
  L.push('');
  L.push('```');
  L.push(input.layout === undefined
    ? '레이아웃 규칙   ⚪ 이 판에선 «안 쟀다** — `## Layout` 절이 없다'
    : '레이아웃 «틀»    그리드 줄·칸 이름은 여전히 없다 — `## Layout` 은 «간격과 폭»까지다');
  L.push('상호작용        정지 화면만 봤다');
  L.push('접힌 곳 아래    뷰포트 하나만 쟀다 — 전체 페이지는 별도 캡처가 필요하다');
  L.push('의도            «왜 이 색인가»는 원본만 안다');
  L.push('```');
  L.push('');
  return L.join('\n');
}
