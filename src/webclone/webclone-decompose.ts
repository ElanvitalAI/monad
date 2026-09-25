// ── WebClone 분해기 — 「받은 페이지」를 «재현 가능한 리소스»로 가른다 (2026-09-08) ──
//
// ⛔⭐ 문제: 웹 클론에는 방법이 넷인데(정적 미러 · DOM/CSS 추출 · Vision 재생성 ·
//    에이전트 파이프라인) 셋은 ***재현 불가***다. 미러는 SPA 에서 빈 셸을 받고,
//    Vision 은 추측이라 같은 입력에 다른 출력을 낸다. 이 파일은 ***B(측정값)*** 축만 맡는다 —
//    ***같은 바이트를 넣으면 같은 스펙이 나온다***(ditto.site 가 「결정론적 컴파일러」로 부른 성질).
//    📄 지형도 = `내부 문서 `MANUAL-web-clone-to-reproducible-resource-2026-09-08`` §1
//
// 원칙:
//   • ⛔ ***추측하지 않는다.*** 값이 문서에 «없으면» `null` 을 낸다. 지어내면 그 순간
//     「측정」과 「환각」이 한 값으로 접히고, 다음 창이 그것을 근거로 쓴다.
//   • ⛔ ***부수효과 0.*** 네트워크·파일·시계를 안 만진다. 그래야 시험이 실물 없이 문다.
//   • ⭐ 산출은 «디자인 씨앗»이지 «코드»가 아니다 — DESIGN.md 로 직렬화될 값만 담는다.
//     코드 생성은 다음 단계(emit)의 몫이고, 그래야 같은 스펙으로 여러 스택을 낼 수 있다.
//   • ⭐ 「무엇을 못 읽었나」를 «산출에» 싣는다(`unresolved`) — 빈 칸을 조용히 채우면
//     사람이 그것을 「원본에 없던 것」으로 읽는다.

/** 하나의 색 토큰. `source` 가 「어디서 왔나」를 남긴다 — 재현의 근거다. */
export interface ColorToken {
  readonly name: string;
  readonly value: string;
  /** 이 값을 어느 선택자·프로퍼티에서 읽었나. 추적 불가면 null. */
  readonly source: string | null;
}

/** 타입 스케일 한 칸. 문서에 없던 축은 null 로 남는다(0 이 아니다). */
export interface TypeStep {
  readonly role: string;
  readonly fontSize: string | null;
  readonly letterSpacing: string | null;
  readonly fontWeight: string | null;
  readonly lineHeight: string | null;
}

/** 섹션 하나 — 「무엇이 몇 열로 어떤 여백을 갖나」. */
export interface SectionSpec {
  readonly id: string;
  readonly selector: string;
  readonly display: string | null;
  readonly columns: string | null;
  readonly gap: string | null;
  readonly padding: string | null;
  readonly background: string | null;
}

export interface MotionSpec {
  readonly keyframes: readonly string[];
  /** `prefers-reduced-motion` 블록이 «있나». 없으면 접근성 바닥이 뚫린 것이다. */
  readonly honoursReducedMotion: boolean;
}

export interface CloneSpec {
  readonly url: string;
  readonly slug: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly lang: string | null;
  readonly colors: readonly ColorToken[];
  readonly fontStacks: readonly string[];
  readonly typeScale: readonly TypeStep[];
  readonly sections: readonly SectionSpec[];
  readonly breakpoints: readonly string[];
  readonly motion: MotionSpec;
  /** 외부에서 끌어와야 할 것 — 이미지·오디오·폰트. 상대 경로 그대로다. */
  readonly assetRefs: readonly string[];
  /** ⛔ 「읽으려 했는데 못 읽은 것」. 빈 배열이 「완전하다」를 뜻하지 않는다 —
   *  분해기가 «찾지 않은» 축은 여기 안 온다. 그 목록은 매뉴얼 §6 이 canonical. */
  readonly unresolved: readonly string[];
}

/** URL → 파일 시스템·S3 키로 쓸 수 있는 슬러그. 결정론적이다. */
export function cloneSlug(url: string): string {
  let host = url;
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname.replace(/\/+$/, '');
  } catch {
    // URL 이 아니면 문자열 전체를 슬러그화한다 — 던지지 않는다.
  }
  const raw = `${host}${path}`.toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'clone';
}

/** `<meta name|property="x" content="y">` 한 칸. 속성 순서가 뒤집혀도 문다. */
function readMeta(html: string, key: string): string | null {
  const attr = `(?:name|property)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`;
  const forward = new RegExp(`<meta[^>]*${attr}[^>]*content=["']([^"']*)["']`, 'i');
  const backward = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}`, 'i');
  return forward.exec(html)?.[1] ?? backward.exec(html)?.[1] ?? null;
}

/**
 * `:root` 계열 블록의 커스텀 프로퍼티.
 *
 * ⛔⭐⭐ **선택자가 `:root` «하나»라고 가정하지 마라.** 실측 2026-09-08:
 *    Tailwind v4 는 `@theme` 토큰을 ***`:root,:host {`*** 에 낸다. 첫 판의 정규식
 *    `/:root\s*\{/` 은 «쉼표 하나» 때문에 그 블록을 못 물었고, 그래서
 *    ***디자인 시스템 40개***(`--text-base` · `--tracking-tight` · `--leading-snug` ·
 *    `--spacing` · `--radius-xs` · `--container-sm` …)를 통째로 놓쳤다.
 *    📏 computed 판이 «디자인 토큰 59개»를 볼 때 이 함수는 «19개»만 봤다.
 *    ⇒ 🔑 ***「0」이나 「적다」를 읽기 전에 「내 선택자 가정이 맞나」를 먼저 묻는다.***
 *
 * ⚠️ 미디어쿼리 «안»의 재정의는 여전히 «다른 축»이라 안 담는다 — 섞으면 「어느 판인가」가 사라진다.
 *    그래서 최상위(중첩 밖) 블록만 읽고, 못 푸는 축은 `cascade-order` 로 계속 신고한다.
 */
export function extractRootTokens(css: string): ColorToken[] {
  const out: ColorToken[] = [];
  const seen = new Set<string>();
  // `:root` 를 «포함»하는 선택자 목록 — `:root` · `:root,:host` · `html:root` 를 다 문다.
  for (const m of css.matchAll(/([^{}]*:root[^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    for (const decl of m[2].split(';')) {
      const d = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i.exec(decl);
      if (!d) continue;
      // ⛔ 먼저 나온 것을 남긴다 — 뒤가 이기는 cascade 를 여기서 «흉내내지» 않는다.
      //    그 축은 이 층이 못 푸는 것이고, `cascade-order` 로 이미 신고한다.
      if (seen.has(d[1])) continue;
      seen.add(d[1]);
      out.push({ name: d[1], value: d[2], source: selector });
    }
  }
  return out;
}

/** 선택자 하나의 선언 블록. 첫 일치만 — CSS 는 뒤가 이기지만, 번들된 파일에서
 *  「어느 것이 이겼나」는 이 층에서 알 수 없다. ⇒ 그 한계를 unresolved 로 낸다. */
export function readRule(css: string, selector: string): Record<string, string> | null {
  const idx = css.indexOf(selector);
  if (idx < 0) return null;
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const out: Record<string, string> = {};
  for (const decl of css.slice(open + 1, close).split(';')) {
    const m = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i.exec(decl);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const TYPE_ROLES: ReadonlyArray<readonly [string, string]> = [
  ['h1', 'h1'],
  ['h2', 'h2'],
  ['h3', 'h3'],
  ['eyebrow', '.eyebrow'],
];

/** 길이 토큰을 px 로 환산해 «정렬»만 한다. ⛔ 표시값은 원문 그대로 남긴다. */
function toPx(v: string): number {
  const n = parseFloat(v);
  if (v.endsWith('rem') || v.endsWith('em')) return n * 16;
  return n;
}

/**
 * 브레이크포인트 — 큰 것부터.
 *
 * ⛔⭐ **문법이 «둘»이다.** 옛 `max-width: N` ⊕ Media Queries Level 4 범위 `(width <= N)`.
 *    Tailwind v4 는 ***범위 문법으로 낸다*** — 그래서 옛 문법만 찾으면 «0» 이 나오고,
 *    그 0 이 「반응형이 없다」로 읽힌다.
 *    📏 실측 2026-09-08: 이 함수의 첫 판이 정확히 그랬다. 대상 사이트는 `(width<=800px)` ·
 *       `(width>=48rem)` 를 쓰는데 `max-width` 건수가 **0** 이었다.
 *    ⇒ 🔑 ***「0건」을 읽기 전에 「내 자가 그 문법을 아나」를 먼저 묻는다.***
 */
export function extractBreakpoints(css: string): string[] {
  const seen = new Set<string>();
  const unit = '[0-9.]+(?:px|rem|em)';
  // ⓐ 옛 문법 — max-width / min-width
  for (const m of css.matchAll(new RegExp(`\\((?:max|min)-width\\s*:\\s*(${unit})\\s*\\)`, 'gi'))) {
    seen.add(m[1]);
  }
  // ⓑ Level 4 범위 — (width <= N) · (width >= N) · (width < N) · (width > N)
  for (const m of css.matchAll(new RegExp(`\\(\\s*width\\s*[<>]=?\\s*(${unit})\\s*\\)`, 'gi'))) {
    seen.add(m[1]);
  }
  // ⓒ Level 4 구간 — (400px <= width <= 800px) 의 양끝
  for (const m of css.matchAll(new RegExp(`\\(\\s*(${unit})\\s*[<>]=?\\s*width\\s*[<>]=?\\s*(${unit})\\s*\\)`, 'gi'))) {
    seen.add(m[1]); seen.add(m[2]);
  }
  return [...seen].sort((a, b) => toPx(b) - toPx(a));
}

/** ⛔ 이 축이 없으면 접근성 바닥이 뚫린 것이다 — 「있다/없다」를 «값»으로 낸다. */
export function honoursReducedMotion(css: string): boolean {
  return /@media[^{]*prefers-reduced-motion\s*:\s*reduce/i.test(css);
}

/** 페이지가 끌어오는 외부 자산. 중복 제거 ⊕ ***종류별 순서***(img → audio → video → link → og:image),
 *  같은 종류 안에서는 문서 등장 순. ⛔ 「문서 순」이 아니다 — 결정론이되 그 순서가 아니다. */
export function extractAssetRefs(html: string): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    if (!v || v.startsWith('data:')) return;
    if (!out.includes(v)) out.push(v);
  };
  for (const m of html.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<audio[^>]*\ssrc=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<video[^>]*\ssrc=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<link[^>]*\shref=["']([^"']+\.(?:css|woff2?|ttf|otf))["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) push(m[1]);
  return out;
}

const SECTION_PROBES: ReadonlyArray<readonly [string, string]> = [
  ['header', '.site-header'],
  ['hero', '.hero'],
  ['facts', '.quick-facts'],
  ['section', '.section'],
  ['footer', 'footer'],
];

/**
 * HTML ⊕ CSS 를 재현 가능한 스펙으로 가른다.
 *
 * ⛔ **읽지 못한 축은 `unresolved` 에 «이름»으로 남는다.** 그것이 이 함수의 계약이다 —
 *    호출자는 `spec.colors.length === 0` 을 「색이 없다」로 읽으면 안 되고,
 *    `unresolved` 에 `root-tokens` 가 있는지를 봐야 한다.
 */
export function decompose(input: { url: string; html: string; css: string }): CloneSpec {
  const { url, html, css } = input;
  const unresolved: string[] = [];

  const colors = extractRootTokens(css);
  if (colors.length === 0) unresolved.push('root-tokens');

  const fontStacks = [...new Set(
    [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)]
      .map((m) => m[1].trim())
      .filter((v) => !v.startsWith('var(')),
  )];
  if (fontStacks.length === 0) unresolved.push('font-stacks');

  const typeScale: TypeStep[] = TYPE_ROLES.map(([role, selector]) => {
    const rule = readRule(css, selector) ?? {};
    return {
      role,
      fontSize: rule['font-size'] ?? null,
      letterSpacing: rule['letter-spacing'] ?? null,
      fontWeight: rule['font-weight'] ?? null,
      lineHeight: rule['line-height'] ?? null,
    };
  });
  if (typeScale.every((s) => s.fontSize === null)) unresolved.push('type-scale');

  const sections: SectionSpec[] = [];
  for (const [id, selector] of SECTION_PROBES) {
    const rule = readRule(css, selector);
    if (!rule) continue;
    sections.push({
      id,
      selector,
      display: rule['display'] ?? null,
      columns: rule['grid-template-columns'] ?? null,
      gap: rule['gap'] ?? null,
      padding: rule['padding'] ?? null,
      background: rule['background'] ?? rule['background-color'] ?? null,
    });
  }
  if (sections.length === 0) unresolved.push('sections');

  const keyframes = [...new Set(
    [...css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map((m) => m[1]),
  )].sort();

  // ⛔ 「CSS 우선순위(cascade)를 이 층에서 못 푼다」는 «구조적» 한계다. 늘 적는다.
  unresolved.push('cascade-order');

  return {
    url,
    slug: cloneSlug(url),
    title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    description: readMeta(html, 'description'),
    lang: /<html[^>]*\slang=["']([^"']+)["']/i.exec(html)?.[1] ?? null,
    colors,
    fontStacks,
    typeScale,
    sections,
    breakpoints: extractBreakpoints(css),
    motion: { keyframes, honoursReducedMotion: honoursReducedMotion(css) },
    assetRefs: extractAssetRefs(html),
    unresolved,
  };
}
