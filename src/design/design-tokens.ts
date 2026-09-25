// ── DESIGN.md 의 «토큰 어휘» — 씨앗과 대비 계산기를 잇는다 (2026-09-08) ─────────
//
// ⛔⭐ 결손이었다: `anti-ai-slop` 은 ***「활성 DESIGN.md 가 `--accent` 를 제공한다」***를
//    전제하는데, 이 저장소의 루트 `DESIGN.md` 는 **규칙서 «이름»만 15줄**이었다.
//    ⇒ 규칙이 묶일 값이 «없었다». 그리고 그 옆에 `measureContrast` 가 «따로» 있었지만
//      둘을 잇는 자가 없어, 팔레트를 선언해도 아무도 대비를 안 쟀다.
//    🔑 이 파일이 그 둘을 잇는다.
//
// ⭐ **파서를 새로 만들지 않는다** — `readSectionItems` 가 이미 「`## 절` + `- ` 불릿」을 읽는다.
//    📏 실측 2026-09-08: `## Palette` 에 `- --accent: #9d783f` 를 넣고 그대로 읽혔다.
//    ⛔ 두 번째 파서를 만들면 그 순간 「같은 문서에 자가 둘」이 된다(`design-doc.ts` 주석이 이미 경고한다).
//
// 원칙:
//   • ⛔ 선언이 «없는» 것과 «틀린» 것을 가른다 — 없으면 `declared: []`, 틀리면 `malformed` 에 이름으로.
//   • ⛔ 대비 판정은 「못 쟀다」를 «통과»로 접지 않는다.
//   • ⚠️ 이 파일은 「그래서 고쳐라」를 말하지 않는다 — 값과 판정만 낸다. 처방은 사람 몫이다.

import { measureContrast, WCAG_NORMAL_TEXT_CONTRAST_RATIO } from '../theme/contrast.js';
import { readSectionItems } from './design-doc.js';

export const PALETTE_HEADING = '## Palette';
export const TYPOGRAPHY_HEADING = '## Typography';
export const MOTION_HEADING = '## Motion';
/** ⭐ 「실제로 겹치는 쌍」을 문서가 «말한다» — 없으면 전 조합을 재게 되고 그건 소음이다. */
export const CONTRAST_PAIRS_HEADING = '## Contrast pairs';

export interface DeclaredToken {
  readonly name: string;
  readonly value: string;
}

export interface TokenSection {
  readonly tokens: readonly DeclaredToken[];
  /** ⛔ 불릿인데 `--name: value` 모양이 «아닌» 줄. 조용히 버리지 않는다. */
  readonly malformed: readonly string[];
}

/**
 * ⭐ 커스텀 프로퍼티 «이름»에 쓸 수 있는 글자.
 *
 * ⛔⭐⭐ 2026-09-11 실측 — ***이 자리에 `_` 가 «없어서» 씨앗을 조용히 버리고 있었다.***
 *    youtube(`--lb-primitive-font-family_brand`) 씨앗에서:
 *      `## Typography`  토큰 **0** · 버린 줄 **34**  ⇒ 도구는 「비었거나 없다」고 말했다
 *      `## Palette`     토큰 54 · 버린 줄 **37**     ⇒ 도구는 「팔레트 54색」이라고만 말했다
 *    ⇒ 🔑 ***성공처럼 «보이는» 칸에서 40%를 잃고 있었다.*** 「0」이 아니라 「못 읽었다」였다.
 * ✅ CSS 사양의 `<custom-property-name>` 은 `--` 뒤에 «ident 글자»가 온다 —
 *    영숫자 · `-` · **`_`** · 비-ASCII(U+0080 이상). 여기를 사양에 맞춘다.
 * ⛔ 그래도 「전부 읽는다」는 «아니다» — 이스케이프(`\\41`)는 여전히 못 읽고, 그래서 버린 줄을 «센다».
 */
const CUSTOM_PROPERTY_NAME = /--[A-Za-z0-9_\u{80}-\u{10FFFF}-]+/u;

/** `- --accent: #9d783f` 한 줄. ⛔ 값에 콜론이 있어도(폰트 스택 등) 첫 콜론에서만 가른다. */
function parseTokenLine(line: string): DeclaredToken | null {
  const m = new RegExp(`^(${CUSTOM_PROPERTY_NAME.source})\\s*:\\s*(.+)$`, 'u').exec(line.trim());
  if (!m) return null;
  const value = m[2].trim();
  return value === '' ? null : { name: m[1], value };
}

export function readTokenSection(document: string, heading: string): TokenSection {
  const tokens: DeclaredToken[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();
  for (const item of readSectionItems(document, heading)) {
    const t = parseTokenLine(item);
    if (t === null) { malformed.push(item); continue; }
    // ⛔ 같은 이름을 두 번 선언하면 «둘 다» 남기지 않는다 — 어느 것이 참인지 문서가 안 말한다.
    if (seen.has(t.name)) { malformed.push(`${item}  (중복 선언)`); continue; }
    seen.add(t.name);
    tokens.push(t);
  }
  return { tokens, malformed };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface ContrastPair {
  readonly foreground: DeclaredToken;
  readonly background: DeclaredToken;
  /** 못 쟀으면 null — ⛔ 0 이 아니다 */
  readonly ratio: number | null;
  readonly meetsNormalText: boolean;
}

/**
 * 선언된 팔레트에서 «잴 수 있는» 색 쌍을 전부 잰다.
 *
 * ⛔ 「어느 쌍이 실제로 쓰이나」는 이 층이 «모른다» — 그것은 CSS·화면의 축이다.
 *    그래서 이 함수는 ***「선언된 색들끼리 대비가 어떤가」***만 답한다.
 *    ⇒ 🔑 통과가 「접근성 OK」를 뜻하지 «않는다». 그 한계를 호출자가 표시해야 한다.
 */
export function measureDeclaredContrasts(
  palette: readonly DeclaredToken[],
  foregroundNames: readonly string[],
  backgroundNames: readonly string[],
): ContrastPair[] {
  const byName = new Map(palette.map((t) => [t.name, t]));
  const out: ContrastPair[] = [];
  for (const fgName of foregroundNames) {
    const fg = byName.get(fgName);
    if (!fg || !HEX.test(fg.value)) continue;
    for (const bgName of backgroundNames) {
      const bg = byName.get(bgName);
      if (!bg || !HEX.test(bg.value)) continue;
      const ratio = measureContrast(fg.value, bg.value);
      out.push({
        foreground: fg, background: bg, ratio,
        meetsNormalText: ratio !== null && ratio >= WCAG_NORMAL_TEXT_CONTRAST_RATIO,
      });
    }
  }
  return out;
}

/** `- --ink on --ground` 한 줄. ⛔ 「on」이 구분자다 — 사람이 읽는 문장이 곧 계약이다. */
export function parseContrastPairLine(line: string): { fg: string; bg: string } | null {
  // ⛔ 이름 문법은 «한 자»를 쓴다 — 여기만 좁으면 팔레트에선 읽힌 토큰이 쌍에서 사라진다.
  const n = CUSTOM_PROPERTY_NAME.source;
  const m = new RegExp(`^(${n})\\s+on\\s+(${n})$`, 'u').exec(line.trim());
  return m ? { fg: m[1], bg: m[2] } : null;
}

export interface DeclaredPairs {
  readonly pairs: ReadonlyArray<{ fg: string; bg: string }>;
  readonly malformed: readonly string[];
}

export function readContrastPairs(document: string): DeclaredPairs {
  const pairs: Array<{ fg: string; bg: string }> = [];
  const malformed: string[] = [];
  for (const item of readSectionItems(document, CONTRAST_PAIRS_HEADING)) {
    const p = parseContrastPairLine(item);
    if (p === null) malformed.push(item); else pairs.push(p);
  }
  return { pairs, malformed };
}

/**
 * ⭐⭐ **선언된 쌍만** 잰다 — 전 조합이 아니다.
 *
 * 🩸 계기: 전 조합을 재니 14색 × 4바탕 = 16쌍 중 12개가 경고였는데, 그 대부분이
 *    ***실제로 겹치지 않는 조합***이었다(`--ink on --brand` 는 아무 데서도 안 쓴다).
 *    ⇒ 경고가 «소음»이 되면 사람은 전부를 무시한다. 그래서 문서가 「무엇이 겹치나」를 말한다.
 * ⛔ 그리고 선언이 «없으면» 「통과」가 아니라 ***「안 쟀다」***다 — 호출자가 그것을 표시해야 한다.
 */
export function measureDeclaredPairs(
  palette: readonly DeclaredToken[],
  pairs: ReadonlyArray<{ fg: string; bg: string }>,
): ContrastPair[] {
  const out: ContrastPair[] = [];
  for (const p of pairs) {
    const [one] = measureDeclaredContrasts(palette, [p.fg], [p.bg]);
    if (one) out.push(one);
  }
  return out;
}

export interface DesignTokenReport {
  readonly palette: TokenSection;
  readonly typography: TokenSection;
  readonly motion: TokenSection;
  /** 팔레트에 색으로 «읽히는» 토큰 수. ⛔ 선언 수와 다르다(폰트·간격도 팔레트에 섞일 수 있다) */
  readonly colorTokenCount: number;
  /** ⭐ `anti-ai-slop` 이 전제하는 그 토큰이 «있나» */
  readonly hasAccent: boolean;
  /** 어느 절도 «선언이 없으면» true — 규칙이 묶일 값이 없다는 뜻 */
  readonly empty: boolean;
  /** 문서가 「무엇이 겹치나」를 말했나. ⛔ 비면 대비 판정은 «안 쟀다»가 맞다 */
  readonly contrastPairs: DeclaredPairs;
}

export function reportDesignTokens(document: string): DesignTokenReport {
  const palette = readTokenSection(document, PALETTE_HEADING);
  const typography = readTokenSection(document, TYPOGRAPHY_HEADING);
  const motion = readTokenSection(document, MOTION_HEADING);
  const colorTokenCount = palette.tokens.filter((t) => HEX.test(t.value)).length;
  return {
    palette, typography, motion, colorTokenCount,
    hasAccent: palette.tokens.some((t) => t.name === '--accent'),
    contrastPairs: readContrastPairs(document),
    empty: palette.tokens.length === 0 && typography.tokens.length === 0 && motion.tokens.length === 0,
  };
}
