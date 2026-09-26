/**
 * seed-to-css.ts — 씨앗(`DESIGN.md`) → ***CSS 토큰***.
 *
 * ⛔⭐ 왜 있나 — 2026-09-10 🅕 실측: `elanousweb` 을 다시 지을 때 내가
 *    `--u: clamp(7px, 0.703vw, 9px)` 을 ***손으로 계산했다***. 그건 드리프트가 나는 자리다
 *    (씨앗을 다시 뽑으면 그 수가 바뀌는데 CSS 는 안 바뀐다).
 *
 * ⛔⭐⭐ 이 자는 ***「잰 것」만 낸다.***
 *    - 이름·의도·컴포넌트 규칙은 «사람이» 채운다 — 씨앗 문서가 이미 그렇게 말한다.
 *    - 못 뽑은 칸은 «비워 두지» 않고 ***주석으로 「왜 못 뽑았나」***를 남긴다.
 *    - ⛔ 없는 값을 «지어내지» 않는다(기본 8px 같은 것을 «넣지 않는다»).
 */

import { declaredRoleTypography } from './seed-conformance.js';
import { reportDesignTokens } from './design-tokens.js';
import { pickBaseUnit, readSeedSpacing } from '../webclone/layout-tokens.js';
import { readSeedKeyframes, renderEasingTokens, renderKeyframesCss } from './seed-motion.js';
import { readSeedStateEasings } from '../webclone/state-motion.js';

export interface SeedCssResult {
  readonly css: string;
  /** ⭐ 뽑은 칸 · 못 뽑은 칸을 «값으로» — 부르는 쪽이 「비었다」를 오독하지 않게 */
  readonly derived: readonly string[];
  readonly missing: readonly string[];
  /**
   * ⛔⭐⭐ 「절에 «있었는데» 이 자가 «못 읽은» 줄」.
   *
   * 🩸 2026-09-11 실측 — 이 칸이 «없어서» 다음이 조용히 일어났다:
   *      youtube 씨앗 `## Palette` — 91줄 중 **37줄**을 버리고 「팔레트 54색」이라고만 말했다.
   *      같은 씨앗 `## Typography` — 34줄을 전부 버리고 「비었거나 없다」고 말했다.
   *    ⇒ ***성공처럼 보이는 칸이 40%를 잃고 있었다.*** 파서는 알고 있었고(`malformed`),
   *      아무도 그 값을 읽지 않았다.
   * ⇒ 🔑 그래서 「0」과 「못 읽었다」 사이에 ***세 번째 칸***을 둔다: 「읽었는데 버렸다」.
   */
  readonly unread: readonly string[];
  /**
   * ⛔⭐⭐⭐ ***씨앗이 «스스로» 「못 쟀다」고 적어 둔 것.***
   *
   * 🩸 2026-09-11 실측 — 열세 번째 사이트의 씨앗을 고르며 나는 **「값 1208 · missing 0」** 이라는
   *    ***수만 보고*** 「쓸 만하다」고 읽었다. ⛔ 그 씨앗은 문서 «안»에 이렇게 적고 있었다:
   *      instagram — *"측정하지 못한 역할 후보: h1, h2, h3, header"* ⊕ *"미러가 자산을 «못 받았다»"*
   *      youtube   — *"측정하지 못한 역할 후보: body, h1, h3, header, footer"*  ← ***body 조차*** 못 쟀다
   *    ⇒ 🔑 ***씨앗은 이미 말하고 있었고, 자가 그것을 «안 옮겼다».***
   * ⛔ 이 칸은 「팔레트를 몇 개 뽑았나」와 «다른 축»이다 —
   *    ***토큰이 아무리 많아도 제목 역할이 없으면 그 씨앗으로는 화면을 못 짓는다.***
   * ⚠️ 판정하지 «않는다» — 씨앗의 «문장»을 그대로 옮긴다. 쓸지 말지는 사람이 정한다.
   */
  readonly seedSaysUnmeasured: readonly string[];
  /**
   * ⭐⭐ 씨앗이 「측정된 역할」 표에 담은 역할 수 — ***토큰 수와 «다른 축»이다.***
   * 📏 2026-09-11 씨앗 15개 전수: 실제로 지은 아홉은 전부 **≥ 6**, 못 쓴 여섯은 전부 **≤ 4**.
   * ⛔ 그래도 ***판정선을 박지 않는다*** — 수만 낸다. 쓸지 말지는 사람이 정한다.
   */
  readonly roleCount: number;
}

/** ⛔ 씨앗이 「못 쟀다」를 적는 문면. ⚠️ 전수가 아니다 — 추출기가 문면을 바꾸면 여기도 늙는다. */
export const SEED_UNMEASURED_MARKERS: readonly string[] = [
  '측정하지 못한 역할',
  '미러가 자산을 «못 받았다',
  '상태 규칙을 **못 찾았다**',
  '모션 토큰을 «못 읽었다',
];

/** 씨앗 문서에서 「스스로 못 쟀다고 적은 줄」을 «그대로» 뽑는다. ⛔ 해석하지 않는다. */
export function readSeedSelfReported(seed: string): readonly string[] {
  const out: string[] = [];
  for (const line of seed.split('\n')) {
    const t = line.replace(/^[>\s-]+/, '').trim();
    if (SEED_UNMEASURED_MARKERS.some((m) => t.includes(m))) out.push(t.slice(0, 140));
  }
  return [...new Set(out)];
}

/** `### 본문 폭` 절의 첫 값. ⛔ 못 읽으면 `null` — 0 이 아니다. */
export function readSeedMeasure(seed: string): number | null {
  const heading = /^###\s+본문 폭[^\n]*$/m.exec(seed);
  if (heading === null) return null;
  const body = seed.slice(heading.index + heading[0].length).split(/^#{1,6}\s/m, 1)[0];
  const m = /^-\s*(\d+)px/m.exec(body);
  return m ? Number(m[1]) : null;
}

export interface SeedScale {
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly ratio: number;
}

/** `### 반응형` 절의 «비례» 줄. ⛔ 여러 줄이면 «가장 넓은 구간»을 쓴다. */
/**
 * ⛔⭐⭐ ***`×1` 은 「비례 눈금」이 «아니다» — 영가설이다.***
 * 「폭이 바뀌어도 간격이 그대로다」를 「비례해 커진다」로 읽으면
 * ***참인데 아무 말도 안 하는 수***가 되고, 그 위에 clamp 를 세우면 «움직이지 않는» clamp 가 나온다.
 * 📏 2026-09-10 실측: 추출기가 apple·bilryo-dongne 에 `×1` 을 내고 있었고,
 *    문면은 그것을 ⭐⭐ 「비례해 «커진다»」라고 썼다(0.5 에도 「커진다」라고 썼다).
 * ⇒ 여기서 «걸러» 낸다. 부르는 쪽은 `null` 을 「비례하지 않는다」로 읽는다.
 */
export const SEED_RATIO_EPSILON = 0.02;

export function readSeedProportional(seed: string): SeedScale | null {
  const rows = [...seed.matchAll(/(\d+)px\s*→\s*(\d+)px\s*(?:에서\s*)?\**\s*[×x]\s*([\d.]+)/g)];
  if (rows.length === 0) return null;
  const spans = rows
    .map((m) => ({ minWidth: Number(m[1]), maxWidth: Number(m[2]), ratio: Number(m[3]) }))
    .filter((s) => Math.abs(s.ratio - 1) > SEED_RATIO_EPSILON);
  if (spans.length === 0) return null;
  return spans.reduce((a, b) => (b.maxWidth - b.minWidth > a.maxWidth - a.minWidth ? b : a));
}

const slug = (name: string) => name.replace(/^--/, '');

/**
 * ⭐ 간격 눈금을 «단위 + 배수»로 낸다.
 * ⛔ 배수로 «안 떨어지는» 값은 버리지 않고 그대로 남긴다 — 씨앗의 사실이다.
 */
function spacingBlock(steps: readonly { px: number }[], scale: SeedScale | null, missing: string[]): string[] {
  if (steps.length === 0) {
    missing.push('간격 눈금 — 씨앗에 `### 간격 눈금` 절이 없다');
    return ['  /* ⚪ 간격: 씨앗에 `### 간격 눈금` 절이 «없다» — 여기 값을 «지어내지» 않는다 */'];
  }
  const values = [...new Set(steps.map((s) => s.px))].sort((a, b) => a - b);
  const unit = values[0];
  const out: string[] = [];
  if (scale) {
    // ⭐ 눈금이 «비례해» 커진다 ⇒ 값을 나열하지 않고 «뿌리 하나»를 키운다.
    //    `clamp(min, k vw, max)` 에서 k = max / maxWidth × 100 ⇒ maxWidth 에서 정확히 max 가 된다.
    // ⛔⭐ 「가장 작은 값」이나 「2배수」를 단위로 쓰면 «그럴듯한데 틀린» CSS 가 나온다.
    //    📏 2026-09-10 실측: 첫 판이 `clamp(16px, …, 18px)` 을 냈다 — 18 은 «단위»가 아니라 2×9 다.
    //       그 CSS 는 모든 간격을 «두 배»로 만든다. 참인 값이라 눈에 안 띈다.
    //    ✅ 이미 있는 «데이터에서 찾는» 자를 쓴다(재발명 0).
    const picked = pickBaseUnit(steps.map((x) => ({ px: x.px, count: 1, kinds: [] })));
    const maxUnit = picked.unit ?? unit;
    const k = Math.round((maxUnit / scale.maxWidth) * 100 * 1000) / 1000;
    const minUnit = Math.max(1, Math.round(maxUnit / scale.ratio));
    out.push(`  /* ⭐ 씨앗이 「눈금이 «비례해» 커진다」고 말했다 (${scale.minWidth}px → ${scale.maxWidth}px 에서 ×${scale.ratio}).`);
    out.push(`     단위 ${maxUnit}px — ${picked.unit === null ? '⚪ 눈금을 «못 골라» 최소값을 썼다' : picked.reason}`);
    // ⛔⭐⭐ 2026-09-10 실측 — ***안 움직이는 `clamp` 를 「비례한다」고 말하며 내고 있었다.***
    //    ⓐ min === max 면 `clamp(4px, k, 4px)` 은 «상수»다. 그런데 주석은 「뿌리 하나를 키운다」고 쓴다.
    //    ⓑ 그리고 ratio ≤ 1 이면(폭이 커질수록 간격이 «작아진다») 좁은 쪽이 «더 커야» 하는데
    //       `clamp(min, …, max)` 는 min > max 를 «표현할 수 없다»(min 이 이긴다).
    //    📏 그 결과 준수 검사가 「씨앗 ×0.909 ↔ 페이지 ×1」이라는 «참인» 어긋남을 냈다.
    // ✅ 못 내는 것을 «내지 않는다» — 고정 단위를 내고 «왜»를 같이 적는다.
    if (minUnit <= maxUnit && minUnit !== maxUnit) {
      out.push('     ⇒ 값을 «나열하지» 않고 뿌리 하나를 키운다. k = 최대단위 / 최대폭 × 100 */');
      out.push(`  --u: clamp(${minUnit}px, ${k}vw, ${maxUnit}px);`);
    } else {
      const why = minUnit === maxUnit
        ? `비율 ×${scale.ratio} 로는 단위가 ${maxUnit}px 에서 «안 움직인다»(min=max)`
        : `비율 ×${scale.ratio} 는 «좁을수록 크다» — clamp 로는 표현할 수 없다(min>max)`;
      out.push(`     ⚪ 그런데 ${why}. */`);
      out.push(`  /* ⚪ 그래서 «고정 단위»를 낸다 — ⛔ 안 움직이는 clamp 를 「비례한다」고 내지 않는다. */`);
      out.push(`  --u: ${maxUnit}px;`);
    }
    // ⛔⭐⭐ 2026-09-10 실측 — ***여기에 사다리가 «박혀» 있었다***: `[1, 2, 3, 4, 6]`.
    //    씨앗의 눈금을 «안 보고» 배수를 지어내므로, 실제로 이런 일이 났다:
    //      씨앗   8 · 12 · 16 · 20 · 24 · 34   (20px 이 «최빈» — 15회)
    //      생성   4 · 8 · 12 · 16 · 24         ← 4 는 씨앗에 «없고», 최빈 20 이 «빠졌다»
    //    ⇒ 그 토큰으로 지으면 준수 검사가 «간격 어긋남»을 낸다. 실제로 냈다.
    // ✅ 배수를 «씨앗에서» 뽑는다 — 나누어떨어지는 값만, 잰 그대로.
    const multiples = [...new Set(values.filter((v) => v % maxUnit === 0).map((v) => v / maxUnit))]
      .sort((a, b) => a - b);
    if (multiples.length === 0) {
      out.push('  /* ⚪ 어떤 씨앗 값도 이 단위의 배수가 «아니다» — 사다리를 «지어내지» 않는다 */');
    } else {
      for (const n of multiples) out.push(`  --s${n}: calc(var(--u) * ${n});`);
    }
    const off = values.filter((v) => v % maxUnit !== 0);
    if (off.length) out.push(`  /* ⚪ 배수로 «안 떨어지는» 씨앗 값: ${off.join('px · ')}px — 사람이 판단한다 */`);
  } else {
    out.push('  /* ⚪ 씨앗에 «비례» 줄이 없다 — 잰 값을 «그대로» 낸다(뿌리를 «지어내지» 않는다) */');
    values.slice(0, 8).forEach((v, i) => out.push(`  --space-${i + 1}: ${v}px;`));
  }
  return out;
}

export function buildTokensCss(seed: string, meta: { source?: string; measuredAt?: string } = {}): SeedCssResult {
  const report = reportDesignTokens(seed);
  const derived: string[] = [];
  const missing: string[] = [];
  // ⛔ 버린 줄을 «세어서» 낸다 — 침묵하면 다음 사람이 「0」으로 읽는다.
  const unread: string[] = [];
  const noteUnread = (heading: string, section: { readonly malformed: readonly string[] }) => {
    // ⛔⭐ 버린 줄을 «전부» 세면 소음이 된다 — `## Motion` 은 산문 불릿이 26줄이고
    //    그것들은 «토큰이 되려던 줄이 아니다». 이 저장소가 이미 배운 것이다:
    //    ***경고가 소음이 되면 사람은 전부를 무시한다***(`measureDeclaredPairs` 주석).
    // ✅ 그래서 「`--` 로 «시작하는데» 못 읽은 줄」만 센다 — 산문은 `--` 로 시작하지 않는다.
    const wanted = section.malformed.filter((line) => line.trimStart().startsWith('--'));
    if (wanted.length === 0) return;
    unread.push(`${heading} — 토큰처럼 생긴 ${wanted.length}줄을 «못 읽었다»(첫 줄: ${wanted[0]})`);
  };
  noteUnread('`## Palette`', report.palette);
  noteUnread('`## Typography`', report.typography);
  noteUnread('`## Motion`', report.motion);
  const L: string[] = [
    '/* tokens.css — ⛔ 이 파일은 «씨앗에서 생성»된다. 손으로 고치지 마라.',
    `   생성: elanous repo design-css${meta.source ? ` (출처 ${meta.source})` : ''}`,
    meta.measuredAt ? `   씨앗을 잰 때: ${meta.measuredAt}` : '   ⚪ 씨앗을 «언제» 쟀는지 모른다',
    '   ⭐ 여기 있는 것은 «잰 값»뿐이다 — 이름·의도·컴포넌트 규칙은 사람이 채운다. */',
    ':root {',
  ];

  if (report.palette.tokens.length) {
    derived.push(`팔레트 ${report.palette.tokens.length}색`);
    L.push('  /* 색 — 씨앗 `## Palette` */');
    for (const t of report.palette.tokens) L.push(`  --${slug(t.name)}: ${t.value};`);
  } else {
    missing.push('팔레트 — 씨앗 `## Palette` 이 비었거나 없다');
    L.push('  /* ⚪ 색: 씨앗에서 «못 읽었다» — 여기 값을 «지어내지» 않는다 */');
  }

  L.push('');
  if (report.typography.tokens.length) {
    derived.push(`활자 토큰 ${report.typography.tokens.length}종`);
    L.push('  /* 활자 — 씨앗 `## Typography` */');
    for (const t of report.typography.tokens) L.push(`  --${slug(t.name)}: ${t.value};`);
  } else {
    missing.push('활자 — 씨앗 `## Typography` 이 비었거나 없다');
    L.push('  /* ⚪ 활자: 씨앗에서 «못 읽었다» */');
  }

  L.push('');
  L.push('  /* 간격 — 씨앗 `### 간격 눈금` ⊕ `### 반응형` */');
  const steps = readSeedSpacing(seed) ?? [];
  const scale = readSeedProportional(seed);
  if (steps.length) derived.push(`간격 ${steps.length}종${scale ? ` (비례 ×${scale.ratio})` : ''}`);
  L.push(...spacingBlock(steps, scale, missing));

  L.push('');
  const measure = readSeedMeasure(seed);
  if (measure === null) {
    missing.push('본문 폭 — 씨앗 `### 본문 폭` 절이 없다');
    L.push('  /* ⚪ 본문 폭: 씨앗에 `### 본문 폭` 절이 «없다» */');
  } else {
    derived.push(`본문 폭 ${measure}px`);
    L.push(`  --measure: ${measure}px;   /* 원본에서 «글자를 직접 담은» 블록의 최빈 폭 */`);
  }

  L.push('');
  // ⭐ 모션 — 가속 곡선은 «값»이라 토큰이 되고, 키프레임은 «블록»이라 :root 밖으로 나간다.
  const easings = readSeedStateEasings(seed);
  if (easings === null) {
    missing.push('가속 곡선 — 씨앗 `### 상태 전환` 절이 없다');
    L.push('  /* ⚪ 가속 곡선: 씨앗에 `### 상태 전환` 절이 «없다» */');
  } else if (easings.length === 0) {
    // ⛔ 절은 있는데 값이 없다 — 「못 읽었다」가 아니라 「관측이 0」이다. 둘을 가른다.
    L.push('  /* ⚪ 가속 곡선: 절은 있는데 관측된 곡선이 «0개»다 (「못 읽었다」가 아니다) */');
  } else {
    derived.push(`가속 곡선 ${easings.length}종`);
    L.push('  /* 가속 곡선 — 씨앗 `### 상태 전환`. ⛔ 이름은 «지어내지» 않았다 — 번호다. */');
    L.push(...renderEasingTokens(easings));
  }

  L.push('}');

  const frames = readSeedKeyframes(seed);
  if (frames === null) {
    missing.push('키프레임 — 씨앗 `### 키프레임` 절이 없다');
    L.push('');
    L.push('/* ⚪ 키프레임: 씨앗에 `### 키프레임` 절이 «없다» — 여기에 움직임을 «지어내지» 않는다 */');
  } else if (frames.length > 0) {
    derived.push(`키프레임 ${frames.length}개`);
    L.push('');
    L.push('/* 움직임 — 씨앗 `### 키프레임` 의 «쓰이는» 것만. ⛔ 이름을 안 바꿨다(대조가 끊긴다). */');
    L.push(...renderKeyframesCss(frames));
  } else {
    L.push('');
    L.push('/* ⚪ 키프레임: 절은 있는데 «쓰이는» 것이 0개다 */');
  }

  if (missing.length) {
    L.push('');
    L.push('/* ⛔ 이 씨앗에서 «못 뽑은» 것 — 빈 칸은 「없다」가 아니라 「못 읽었다」다:');
    for (const m of missing) L.push(`   · ${m}`);
    L.push(' */');
  }
  if (unread.length) {
    L.push('');
    L.push('/* 🚨 절에 «있었는데» 이 자가 못 읽은 줄 — ⛔ 위의 수는 그만큼 «모자란» 수다:');
    for (const u of unread) L.push(`   · ${u}`);
    L.push(' */');
  }
  // ⛔⭐⭐ ***「역할 수」가 씨앗의 «쓸모»를 가른다*** — 토큰 수와 «다른 축»이다.
  //    📏 2026-09-11 씨앗 15개 전수: 내가 «실제로 지은» 아홉은 전부 역할 **≥ 6**,
  //       못 쓴 여섯은 전부 **≤ 4** 였다(coupang 2 · spotify 1 · woowahan 1 · youtube 0 · instagram 4 · toss 4).
  //    ⛔ 그래도 ***판정선을 박지 않는다*** — 오늘 「자가 낸 수를 판정선에 적으면 순환」임을 배웠다.
  //       ⇒ «수»만 낸다. 쓸지 말지는 사람이 정한다.
  const roleCount = Object.keys(declaredRoleTypography(seed, report)).length;
  if (roleCount > 0) derived.push(`역할 ${roleCount}개`);
  else missing.push('역할 — 씨앗에 `### 측정된 역할` 표가 «없다»(제목·본문 스타일을 못 쓴다)');

  const seedSaysUnmeasured = readSeedSelfReported(seed);
  if (seedSaysUnmeasured.length) {
    L.push('');
    L.push('/* 🚨 씨앗이 «스스로» 「못 쟀다」고 적은 것 — ⛔ 토큰 수와 «다른 축»이다:');
    for (const u of seedSaysUnmeasured) L.push(`   · ${u}`);
    L.push('   ⛔ 제목 역할이 없으면 토큰이 아무리 많아도 그 씨앗으로는 화면을 못 짓는다. */');
  }
  return { css: `${L.join('\n')}\n`, derived, missing, unread, seedSaysUnmeasured, roleCount };
}
