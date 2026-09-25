/**
 * seed-to-css.test.ts — ⛔ ***없는 값을 «지어내는가»*** 가 이 자의 가장 위험한 축이다.
 */
import { describe, expect, test } from 'bun:test';

import { buildTokensCss, readSeedMeasure, readSeedProportional, readSeedSelfReported, SEED_UNMEASURED_MARKERS } from './seed-to-css.js';

const SEED = `# S

## Palette

- --ground: #264323
- --ink: #383838

## Typography

- --font-body: "Fira Sans", sans-serif

## Layout

### 간격 눈금 (빈도순)

- 9px — 106회 (gap·padding)
- 18px — 22회 (margin)
- 27px — 28회 (gap)
- 36px — 20회 (padding)

### 본문 폭 (글자를 직접 담은 블록)

- 596px — 10회 (뷰포트의 47%)

### 반응형 — ⭐ 눈금이 «비례해» 커진다

390px → 768px   ×1.114
768px → 1280px  ×1.103

## Contrast pairs
`;

describe('⛔ 없는 값을 «지어내지» 않는다 (가장 위험한 축)', () => {
  test('간격 절이 없으면 «지어내지» 않고 그렇게 말한다', () => {
    const r = buildTokensCss('# S\n\n## Palette\n\n- --ink: #111111\n');
    expect(r.css).toContain('「없다」가 아니라 「못 읽었다」다');
    expect(r.css).not.toMatch(/--s1:/);
    expect(r.missing.join(' ')).toContain('간격 눈금');
  });

  test('팔레트가 없으면 «기본 색»을 넣지 않는다', () => {
    const r = buildTokensCss('# S\n\n## Layout\n\n### 간격 눈금\n\n- 8px — 3회 (gap)\n');
    expect(r.css).toContain('색: 씨앗에서 «못 읽었다»');
    expect(r.css).not.toContain('#000');
    expect(r.css).not.toContain('#fff');
  });

  test('본문 폭이 없으면 --measure 를 «안 낸다»', () => {
    expect(buildTokensCss('# S\n\n## Palette\n\n- --ink: #111111\n').css).not.toContain('--measure:');
  });

  test('⭐ 못 뽑은 칸을 «값으로» 낸다 — 부르는 쪽이 「비었다」를 오독하지 않게', () => {
    const r = buildTokensCss('# S\n');
    expect(r.missing.length).toBeGreaterThanOrEqual(3);
    expect(r.derived).toEqual([]);
  });
});

describe('⭐ 비례가 있으면 «뿌리 하나»를 키운다', () => {
  test('clamp 로 낸다 — 값을 «나열하지» 않는다', () => {
    const r = buildTokensCss(SEED);
    expect(r.css).toMatch(/--u: clamp\(\d+px, [\d.]+vw, \d+px\);/);
    expect(r.css).toContain('--s1: calc(var(--u) * 1);');
    // 🩸 2026-09-10 — 여기에 `--s6` 이 있었다. 그런데 이 씨앗의 눈금은 9·18·27·36 뿐이라
    //    ***×6(54px)은 씨앗에 «없는» 값***이다. 즉 이 줄이 «박힌 사다리 [1,2,3,4,6]»를 못 박고 있었고,
    //    그 사다리가 다른 씨앗에서 «최빈값을 빠뜨리는» 진짜 사고를 냈다(간격 축 어긋남).
    // ✅ 이제 배수는 씨앗에서 나온다 ⇒ 이 씨앗은 ×4 까지다.
    expect(r.css).toContain('--s4: calc(var(--u) * 4);');
    expect(r.css).not.toContain('--s6: calc(var(--u) * 6);');
  });

  test('k = 최대단위 / 최대폭 × 100 — 최대폭에서 «정확히» 최대단위가 된다', () => {
    const css = buildTokensCss(SEED).css;
    const m = /--u: clamp\((\d+)px, ([\d.]+)vw, (\d+)px\)/.exec(css)!;
    const [, minPx, k, maxPx] = m;
    expect(Number(k) * 1280 / 100).toBeCloseTo(Number(maxPx), 1);
    expect(Number(minPx)).toBeLessThan(Number(maxPx));
  });

  test('⭐ 「왜 이렇게 했는지」를 주석으로 남긴다', () => {
    expect(buildTokensCss(SEED).css).toContain('눈금이 «비례해» 커진다');
  });

  test('비례가 «없으면» 잰 값을 그대로 낸다 (뿌리를 지어내지 않는다)', () => {
    const noScale = SEED.replace(/### 반응형[\s\S]*?## Contrast/, '## Contrast');
    const css = buildTokensCss(noScale).css;
    expect(css).toContain('--space-1: 9px;');
    expect(css).not.toContain('--u:');
    expect(css).toContain('뿌리를 «지어내지» 않는다');
  });
});

describe('씨앗 되읽기', () => {
  test('본문 폭 — 못 읽으면 null (0 이 아니다)', () => {
    expect(readSeedMeasure(SEED)).toBe(596);
    expect(readSeedMeasure('# S')).toBeNull();
  });

  test('비례 — 여러 줄이면 «가장 넓은 구간»을 쓴다', () => {
    const s = readSeedProportional(SEED)!;
    expect(s).toMatchObject({ minWidth: 768, maxWidth: 1280 });
  });

  test('비례 줄이 없으면 null', () => {
    expect(readSeedProportional('# S')).toBeNull();
  });
});

describe('생성물이 «자기 출처»를 말한다', () => {
  test('손으로 고치지 말라고 «적는다»', () => {
    expect(buildTokensCss(SEED).css).toContain('손으로 고치지 마라');
  });

  test('잰 때를 모르면 «모른다»고 적는다', () => {
    expect(buildTokensCss(SEED).css).toContain('⚪ 씨앗을 «언제» 쟀는지 모른다');
    expect(buildTokensCss(SEED, { measuredAt: '2026-09-10' }).css).toContain('2026-09-10');
  });

  test('뽑은 것을 «목록»으로 낸다', () => {
    expect(buildTokensCss(SEED).derived.join(' ')).toContain('비례 ×1.103');
  });
});

describe('⛔ 단위를 «잘못 고르면» 그럴듯한데 틀린 CSS 가 나온다', () => {
  // 📏 2026-09-10 실측: 첫 판이 `clamp(16px, …, 18px)` 을 냈다 — 18 은 «단위»가 아니라 2×9.
  //    그 CSS 는 모든 간격을 «두 배»로 만든다. 참인 값이라 «눈에 안 띈다».
  test('9의 배수 눈금에서 단위를 9 로 고른다 (18 이 아니다)', () => {
    const css = buildTokensCss(SEED).css;
    expect(css).toContain('--u: clamp(8px, 0.703vw, 9px);');
    expect(css).not.toContain('clamp(16px');
  });

  test('⭐ 「왜 이 단위인가」를 «주석으로» 남긴다', () => {
    expect(buildTokensCss(SEED).css).toContain('9px 의 배수다');
  });

  test('눈금을 «못 고르면» 그렇게 적고 최소값을 쓴다 (조용히 안 넘어간다)', () => {
    const odd = SEED.replace(
      /### 간격 눈금[\s\S]*?### 본문 폭/,
      '### 간격 눈금 (빈도순)\n\n- 7px — 9회 (gap)\n- 13px — 8회 (gap)\n- 29px — 7회 (gap)\n\n### 본문 폭',
    );
    const css = buildTokensCss(odd).css;
    expect(css).toContain('⚪ 눈금을 «못 골라» 최소값을 썼다');
  });
});

describe('⛔⭐ 간격 사다리를 «지어내지» 않는다 — 씨앗에서 배수를 뽑는다', () => {
  // 🩸 2026-09-10 실측: 사다리가 `[1,2,3,4,6]` 으로 박혀 있어
  //    씨앗(8·12·16·20·24)에서 «최빈 20px 이 빠지고» 씨앗에 없는 4px 이 나왔다.
  //    그 토큰으로 지은 화면이 준수 검사에서 「간격 어긋남」을 냈다.
  const seedWith = (steps: readonly number[]) => [
    '# S', '', '## Palette', '', '- --a: #000000', '',
    '## Typography', '', '- --font-body: X', '',
    '### 간격 눈금', '',
    ...steps.map((px) => `- ${px}px — 10회 (gap)`),
    '', '### 반응형', '', '```', '390px → 1280px   ×1.1', '```', '',
  ].join('\n');

  test('⭐ 씨앗의 배수만 낸다 — 최빈값이 «안 빠진다»', () => {
    const css = buildTokensCss(seedWith([8, 12, 16, 20, 24])).css;
    for (const n of [2, 3, 4, 5, 6]) expect(css).toContain(`--s${n}: calc(var(--u) * ${n})`);
  });

  test('⛔ 씨앗에 «없는» 배수를 안 낸다', () => {
    const css = buildTokensCss(seedWith([8, 16, 24])).css;
    // 단위 8 ⇒ 배수는 1·2·3 뿐. 씨앗에 없는 4·6 은 나오면 안 된다.
    expect(css).toContain('--s1: calc(var(--u) * 1)');
    expect(css).toContain('--s3: calc(var(--u) * 3)');
    expect(css).not.toContain('--s6: calc(var(--u) * 6)');
  });

  test('⛔ 안 떨어지는 값은 «값으로» 말한다 — 조용히 버리지 않는다', () => {
    expect(buildTokensCss(seedWith([8, 12, 16, 34])).css).toContain('안 떨어지는');
  });
});

describe('⛔⭐ 안 움직이는 clamp 를 «비례한다»고 내지 않는다', () => {
  // 🩸 2026-09-10 실측: `clamp(4px, k, 4px)` 을 내면서 주석은 「뿌리 하나를 키운다」고 썼다.
  //    준수 검사가 「씨앗 ×0.909 ↔ 페이지 ×1」이라는 «참인» 어긋남을 냈다.
  const seedWith = (steps: readonly number[], ratio: string) => [
    '# S', '', '## Palette', '', '- --a: #000000', '',
    '## Typography', '', '- --font-body: X', '',
    '### 간격 눈금', '', ...steps.map((px) => `- ${px}px — 10회 (gap)`),
    '', '### 반응형', '', '```', `390px → 1280px   ×${ratio}`, '```', '',
  ].join('\n');

  test('⛔ 비율이 «1 이하»면 clamp 대신 «고정 단위»를 낸다', () => {
    const css = buildTokensCss(seedWith([8, 12, 16, 20, 24], '0.909')).css;
    expect(css).not.toMatch(/--u: clamp\(/);
    expect(css).toMatch(/--u: \d+px;/);
    expect(css).toContain('고정 단위');
  });

  test('⭐ 그리고 «왜» 그랬는지 값과 함께 말한다', () => {
    expect(buildTokensCss(seedWith([8, 12, 16, 20, 24], '0.909')).css).toContain('×0.909');
  });

  test('✅ 비율이 «충분히 크면» 전처럼 clamp 를 낸다 (다 막지 않는다)', () => {
    const css = buildTokensCss(seedWith([9, 18, 27, 36], '1.5')).css;
    expect(css).toMatch(/--u: clamp\(\d+px, [\d.]+vw, \d+px\);/);
  });

  test('⛔ 배수는 그대로 씨앗에서 나온다 — 고정 단위여도', () => {
    const css = buildTokensCss(seedWith([8, 12, 16, 20, 24], '0.909')).css;
    for (const n of [2, 3, 4, 5, 6]) expect(css).toContain(`--s${n}: calc(var(--u) * ${n})`);
  });
});

// ── 🚨 「읽었는데 버렸다」 — 성공처럼 «보이는» 칸의 결손 (2026-09-11 실측) ───────────
//
// 🩸 계기: youtube 씨앗(`--lb-primitive-font-family_brand`)에서 이 자가
//    `## Palette` 91줄 중 **37줄**을 버리고 「팔레트 54색」이라고만 말했고,
//    `## Typography` 34줄을 «전부» 버리고 「비었거나 없다」고 말했다.
//    ⇒ 원인은 이름 문법에 `_` 가 «없었던» 것. 파서는 알았고(`malformed`) 아무도 안 읽었다.
describe('⛔ 이름에 `_` 가 든 토큰 ⊕ 버린 줄을 «센다»', () => {
  const underscored = [
    '# S', '', '## Palette', '',
    '- --lb-primitive-color_almost-black: #212121',
    '- --plain-name: #ffffff', '', '## Typography', '',
    '- --lb-primitive-font-size_body-md: 1.125rem',
    '- --lb-primitive-font-family_brand: YouTube Display,Roboto,sans-serif', '',
  ].join('\n');

  test('`_` 가 든 이름을 «읽는다» — CSS 사양의 custom property 이름이다', () => {
    const r = buildTokensCss(underscored);
    expect(r.css).toContain('--lb-primitive-color_almost-black: #212121;');
    expect(r.css).toContain('--lb-primitive-font-size_body-md: 1.125rem;');
    // ⛔ 값에 콤마·공백이 있어도 첫 콜론에서만 가른다
    expect(r.css).toContain('--lb-primitive-font-family_brand: YouTube Display,Roboto,sans-serif;');
  });

  test('활자 절이 «있으면» 「비었거나 없다」고 말하지 않는다', () => {
    expect(buildTokensCss(underscored).missing.join(' ')).not.toContain('활자');
  });

  test('⛔ 토큰처럼 «생겼는데» 못 읽은 줄을 센다 — 침묵하지 않는다', () => {
    const r = buildTokensCss('# S\n\n## Palette\n\n- --ok: #111111\n- --\\41 escaped: #222222\n');
    expect(r.unread.length).toBe(1);
    expect(r.unread[0]).toContain('`## Palette`');
    expect(r.css).toContain('🚨 절에 «있었는데»');
  });

  test('⛔ 산문 불릿은 «세지 않는다» — 경고가 소음이 되면 전부 무시된다', () => {
    // `## Motion` 은 산문 불릿(「계산된 전환이 걸린 요소: 246개」)만 담는 씨앗이 흔하다
    const prose = '# S\n\n## Motion\n\n- 계산된 전환이 걸린 요소: 246개\n- 길이: 0.2s (164개 요소)\n';
    expect(buildTokensCss(prose).unread).toEqual([]);
  });

  test('⛔ 「못 뽑음 없다」와 「못 읽음」은 «같이» 뜰 수 있다 — 다른 칸이다', () => {
    const r = buildTokensCss('# S\n\n## Palette\n\n- --ok: #111111\n- --\\41 bad: #222222\n');
    expect(r.missing.join(' ')).not.toContain('팔레트');
    expect(r.unread.length).toBe(1);
  });
});

// ── 🚨 「수」만 보고 씨앗을 골랐다 — 씨앗은 «이미 말하고» 있었다 (2026-09-11) ──────────
//
// 🩸 열세 번째 사이트의 씨앗을 고르며 「값 1208 · missing 0」이라는 ***수만 보고*** 「쓸 만하다」고 읽었다.
//    그 씨앗은 문서 «안»에 이렇게 적고 있었다:
//      instagram — "측정하지 못한 역할 후보: h1, h2, h3, header" ⊕ "미러가 자산을 «못 받았다»"
//      youtube   — "측정하지 못한 역할 후보: body, h1, h3, header, footer"  ← body 조차
//    ⇒ 🔑 씨앗은 이미 말하고 있었고, 자가 그것을 «안 옮겼다».
describe('⛔⭐ 씨앗이 «스스로» 「못 쟀다」고 적은 것을 옮긴다', () => {
  test('「측정하지 못한 역할」 줄을 «그대로» 옮긴다', () => {
    const seed = '# S\n\n> ⚠️ 측정하지 못한 역할 후보: h1, h2, h3, header — 판단하지 않는다.\n';
    const r = buildTokensCss(seed);
    expect(r.seedSaysUnmeasured.length).toBe(1);
    expect(r.seedSaysUnmeasured[0]).toContain('h1, h2, h3, header');
    // ⛔ 인용부호(`>`)와 앞 공백은 떼고 «문장»만 남긴다
    expect(r.seedSaysUnmeasured[0]!.startsWith('>')).toBe(false);
  });

  test('⛔ 토큰 수와 «다른 축»이다 — 팔레트가 멀쩡해도 뜬다', () => {
    const seed = '# S\n\n## Palette\n\n- --ink: #111111\n\n> ⚠️ 측정하지 못한 역할 후보: h1\n';
    const r = buildTokensCss(seed);
    expect(r.derived.join(' ')).toContain('팔레트');   // 뽑은 것은 있다
    expect(r.missing.join(' ')).not.toContain('팔레트');
    expect(r.seedSaysUnmeasured.length).toBe(1);      // 그래도 «말한다»
  });

  test('여러 문면을 다 잡되 «중복은 한 번»', () => {
    const seed = ['# S', '',
      '> ⚠️ 측정하지 못한 역할 후보: h1', '', '- ⚠️ 미러가 자산을 «못 받았다**.',
      '> ⚠️ 미러가 자산을 «못 받았다**.', ''].join('\n');
    expect(buildTokensCss(seed).seedSaysUnmeasured.length).toBe(2);
  });

  test('⛔ 깨끗한 씨앗은 «조용하다» — 소음을 안 낸다', () => {
    expect(buildTokensCss('# S\n\n## Palette\n\n- --ink: #111111\n').seedSaysUnmeasured).toEqual([]);
  });

  test('⭐ CSS 주석에도 남는다 — 파일만 보는 사람도 본다', () => {
    const css = buildTokensCss('# S\n\n> ⚠️ 측정하지 못한 역할 후보: h1\n').css;
    expect(css).toContain('씨앗이 «스스로»');
    expect(css).toContain('제목 역할이 없으면');
  });

  test('⛔ 문면 목록이 «값»으로 나간다 — 추출기가 바뀌면 여기도 늙는다', () => {
    expect(SEED_UNMEASURED_MARKERS).toContain('측정하지 못한 역할');
    expect(SEED_UNMEASURED_MARKERS.length).toBeGreaterThan(2);
  });
});

// ── ⭐⭐ 「역할 수」가 씨앗의 «쓸모»를 가른다 — 토큰 수와 «다른 축» (2026-09-11) ──────
//
// 📏 씨앗 15개 전수: 내가 «실제로 지은» 아홉은 전부 역할 ≥ 6, 못 쓴 여섯은 전부 ≤ 4.
//    (coupang 2 · spotify 1 · woowahan 1 · youtube 0 · instagram 4 · toss 4)
// ⛔ 그래도 ***판정선을 박지 않는다*** — 오늘 「자가 낸 수를 판정선에 적으면 순환」임을 배웠다.
describe('⭐ 역할 수를 «수»로 낸다 — 판정하지 않는다', () => {
  const withRoles = (rows: string) => [
    '# S', '', '### 측정된 역할 (computed)', '',
    '| 역할 | 크기 | 굵기 |', '|---|---|---|', rows, '',
  ].join('\n');

  test('역할 표를 읽어 «수»를 낸다', () => {
    const r = buildTokensCss(withRoles(['| body | 16px | 400 |', '| h1 | 60px | 700 |'].join('\n')));
    expect(r.roleCount).toBe(2);
    expect(r.derived.join(' ')).toContain('역할 2개');
  });

  test('⛔ 표가 «없으면» 「못 뽑음」에 들어간다 — 0 을 조용히 내지 않는다', () => {
    const r = buildTokensCss('# S\n\n## Palette\n\n- --ink: #111111\n');
    expect(r.roleCount).toBe(0);
    expect(r.missing.join(' ')).toContain('역할');
    expect(r.derived.join(' ')).not.toContain('역할');
  });

  test('⛔ 토큰 수와 «다른 축»이다 — 팔레트가 많아도 역할이 적을 수 있다', () => {
    // 🩸 instagram 씨앗이 실제로 그랬다: 팔레트 416색 · 키프레임 193개인데 역할 «4개»
    const many = ['# S', '', '## Palette', '',
      ...Array.from({ length: 20 }, (_, i) => `- --c${i}: #11${String(i).padStart(2, '0')}11`),
      '', '### 측정된 역할 (computed)', '', '| 역할 | 크기 | 굵기 |', '|---|---|---|',
      '| body | 16px | 400 |', ''].join('\n');
    const r = buildTokensCss(many);
    expect(r.derived.join(' ')).toContain('팔레트 20색');
    expect(r.roleCount).toBe(1);            // ⛔ 토큰이 많아도 «역할은 하나»다
  });

  test('⛔ 판정하지 «않는다» — 「쓸 만하다/못 쓴다」를 안 낸다', () => {
    const css = buildTokensCss(withRoles('| body | 16px | 400 |')).css;
    for (const word of ['쓸 만', '못 쓴다', '부족', '나쁘']) expect(css).not.toContain(word);
  });

  test('⛔ 머리줄·구분줄을 «역할로 세지» 않는다', () => {
    const r = buildTokensCss(withRoles(['| body | 16px | 400 |', '| h2 | 32px | 700 |', '| h3 | 24px | 700 |'].join('\n')));
    expect(r.roleCount).toBe(3);
  });
});
