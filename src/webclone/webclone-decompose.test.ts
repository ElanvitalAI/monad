// ── webclone 분해기 시험 — ⛔ 「돌더라」가 아니라 「무는가」 ────────────────────
//
// 🩸 이 파일의 계기: `extractBreakpoints` 첫 판이 실물에서 «0» 을 냈다.
//    코드는 «돌았고» 시험도 통과했을 것이다 — 옛 문법만 넣어 봤을 테니.
//    ⇒ 그래서 아래 시험은 ***실물에서 나온 문면***(Tailwind v4 범위 문법)을 «먼저» 문다.

import { describe, expect, test } from 'bun:test';

import {
  cloneSlug, decompose, extractAssetRefs, extractBreakpoints, extractRootTokens,
  honoursReducedMotion, readRule,
} from './webclone-decompose.js';

describe('cloneSlug — 결정론', () => {
  test('같은 URL 은 같은 슬러그', () => {
    expect(cloneSlug('https://a.example.com/x/')).toBe(cloneSlug('https://a.example.com/x'));
  });
  test('URL 이 아니어도 던지지 않는다', () => {
    expect(cloneSlug('not a url')).toBe('not-a-url');
  });
  test('빈 값이어도 빈 슬러그를 내지 않는다', () => {
    expect(cloneSlug('')).toBe('clone');
  });
});

describe('extractBreakpoints — 🩸 문법이 «둘»이다', () => {
  test('옛 문법 max-width 를 문다', () => {
    expect(extractBreakpoints('@media (max-width: 900px){a{b:c}}')).toEqual(['900px']);
  });

  // ⛔ 이 시험이 첫 판을 «죽인다» — 실물(Tailwind v4)이 내는 문면이다.
  test('Level 4 범위 문법 (width<=N) 을 문다', () => {
    const css = '@media (width<=800px){a{b:c}}@media (width<=380px){d{e:f}}';
    expect(extractBreakpoints(css)).toEqual(['800px', '380px']);
  });

  test('Level 4 (width>=N) 도 문다 ⊕ rem 을 px 로 환산해 정렬한다', () => {
    const css = '@media (width>=48rem){a{b:c}}@media (width>=40rem){d{e:f}}';
    expect(extractBreakpoints(css)).toEqual(['48rem', '40rem']); // 768px > 640px
  });

  test('구간 문법의 «양끝»을 다 담는다', () => {
    expect(extractBreakpoints('@media (400px <= width <= 800px){a{b:c}}')).toEqual(['800px', '400px']);
  });

  test('섞여 있어도 중복 없이 큰 것부터', () => {
    const css = '@media (max-width:900px){}@media (width<=900px){}@media (width>=48rem){}';
    expect(extractBreakpoints(css)).toEqual(['900px', '48rem']);
  });

  test('⛔ 없으면 빈 배열 — 「못 읽음」과 구별은 호출자 몫', () => {
    expect(extractBreakpoints('a{b:c}')).toEqual([]);
  });
});

describe('extractRootTokens', () => {
  test(':root 의 커스텀 프로퍼티만 담는다', () => {
    const css = ':root{--a:#fff;--b:2px;color:red}.x{--c:1}';
    expect(extractRootTokens(css)).toEqual([
      { name: '--a', value: '#fff', source: ':root' },
      { name: '--b', value: '2px', source: ':root' },
    ]);
  });
  test(':root 가 없으면 빈 배열', () => {
    expect(extractRootTokens('.x{--c:1}')).toEqual([]);
  });
});

describe('readRule', () => {
  test('선언을 사전으로 낸다', () => {
    expect(readRule('.hero{color:#fff;height:10px}', '.hero')).toEqual({ color: '#fff', height: '10px' });
  });
  test('없으면 null — ⛔ 빈 객체가 아니다(「없다」와 「비었다」를 가른다)', () => {
    expect(readRule('.a{b:c}', '.zz')).toBeNull();
  });
});

describe('honoursReducedMotion', () => {
  test('있으면 true', () => {
    expect(honoursReducedMotion('@media (prefers-reduced-motion:reduce){*{animation:none}}')).toBe(true);
  });
  test('공백이 있어도 문다', () => {
    expect(honoursReducedMotion('@media screen and (prefers-reduced-motion : reduce){}')).toBe(true);
  });
  test('없으면 false', () => {
    expect(honoursReducedMotion('a{b:c}')).toBe(false);
  });
});

describe('extractAssetRefs', () => {
  test('img·audio·og:image 를 담고 data: 는 뺀다', () => {
    const html = `<img src="/a.png"><audio src="/b.mp3"></audio>
      <img src="data:image/png;base64,zz"><meta property="og:image" content="/c.png">`;
    // ⛔ 순서는 «종류별»이다(img → audio → … → og:image) — 문서 등장 순이 아니다.
    expect(extractAssetRefs(html)).toEqual(['/a.png', '/b.mp3', '/c.png']);
  });
  test('중복을 지운다', () => {
    expect(extractAssetRefs('<img src="/a.png"><img src="/a.png">')).toEqual(['/a.png']);
  });
});

describe('decompose — 계약', () => {
  const html = `<html lang="ko"><head><title>T</title>
    <meta name="description" content="D"></head><body><img src="/x.png"></body></html>`;
  const css = ':root{--primary:#07513b}h1{font-size:42px;font-weight:650}.hero{display:flex}@media (width<=900px){}';

  test('측정값을 담는다', () => {
    const s = decompose({ url: 'https://e.example/', html, css });
    expect(s.title).toBe('T');
    expect(s.description).toBe('D');
    expect(s.lang).toBe('ko');
    expect(s.colors).toHaveLength(1);
    expect(s.breakpoints).toEqual(['900px']);
    expect(s.typeScale.find((t) => t.role === 'h1')?.fontSize).toBe('42px');
  });

  test('⛔ cascade-order 는 «언제나» unresolved 다 — 구조적 한계라 숨기지 않는다', () => {
    expect(decompose({ url: 'https://e.example/', html, css }).unresolved).toContain('cascade-order');
  });

  test('⛔ 못 읽은 축은 «이름»으로 남는다 — 빈 값으로 지어내지 않는다', () => {
    const s = decompose({ url: 'https://e.example/', html: '<html></html>', css: 'a{b:c}' });
    expect(s.unresolved).toContain('root-tokens');
    expect(s.unresolved).toContain('type-scale');
    expect(s.colors).toEqual([]);
    expect(s.title).toBeNull();          // ⛔ 빈 문자열이 아니다
  });

  test('같은 입력은 같은 산출 — 결정론', () => {
    const a = decompose({ url: 'https://e.example/', html, css });
    const b = decompose({ url: 'https://e.example/', html, css });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('extractRootTokens — 🩸 선택자가 «하나»가 아니다', () => {
  // ⛔ 이 시험이 첫 판을 «죽인다» — Tailwind v4 가 실제로 내는 문면이다.
  test('`:root,:host {` 를 문다 — 쉼표 하나로 40개를 놓쳤었다', () => {
    const css = ':root,:host{--text-base:1rem;--tracking-tight:-.025em}';
    const t = extractRootTokens(css);
    expect(t.map((x) => x.name)).toEqual(['--text-base', '--tracking-tight']);
    expect(t[0].source).toBe(':root,:host');
  });

  test('`:root` 와 `:root,:host` 가 «둘 다» 있으면 합친다', () => {
    const css = ':root{--primary:#07513b}:root,:host{--text-base:1rem}';
    expect(extractRootTokens(css).map((x) => x.name)).toEqual(['--primary', '--text-base']);
  });

  test('⛔ 같은 이름은 «먼저 것»을 남긴다 — cascade 를 흉내내지 않는다', () => {
    const css = ':root{--a:#111}:root,:host{--a:#222}';
    const t = extractRootTokens(css);
    expect(t).toHaveLength(1);
    expect(t[0].value).toBe('#111');
  });

  test('`html:root` 처럼 앞이 붙어도 문다', () => {
    expect(extractRootTokens('html:root{--a:1}').map((x) => x.name)).toEqual(['--a']);
  });
});
