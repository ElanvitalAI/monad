// ── DESIGN.md 렌더러 시험 — ⛔ 「썼다」와 「파서가 읽는다」는 다른 값이다 ─────────
//
// 🩸 계기: 첫 판이 대비 쌍을 «값»(`rgb(23,45,36)`)으로 적었고, `readContrastPairs` 는
//    «토큰 이름»(`--ink on --ground`)을 기대해 ***0건***을 읽었다.
//    ⇒ 렌더러는 「썼다」고 믿고 파서는 「없다」고 말했다. 아래 시험이 그 자리를 문다.

import { describe, expect, test } from 'bun:test';

import {
  contrastPairsFrom, designTokens, nameForColor, normaliseColor, pageBarelyRendered, renderDesignMd, splitTokens,
} from './design-md.js';
import { readContrastPairs, reportDesignTokens } from '../design/design-tokens.js';

const TOKENS = {
  url: 'https://example.invalid/',
  viewport: { w: 1280, h: 813 },
  customProperties: {
    '--ink': '#172d24',
    '--ground': '#ffffff',
    '--brand': 'rgb(7, 81, 59)',
    '--font-sans': 'Pretendard, sans-serif',
    '--ease-out': 'cubic-bezier(.2,0,0,1)',
    '--tw-shadow': '0 0 #0000',          // ⛔ Tailwind 내부 배관 — 씨앗에 안 들어간다
    '--spacing': '0.25rem',
  },
  roles: {
    body: { color: 'rgb(23, 45, 36)', 'background-color': 'rgb(255, 255, 255)', 'font-size': '16px' },
    h1: { color: 'rgb(255, 255, 255)', 'background-color': 'rgba(0, 0, 0, 0)', 'font-size': '57.6px' },
    button: { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(7, 81, 59)', 'font-size': '14px' },
  },
  diagnostics: {},
  typographyWarnings: [],
  paintedColors: {
    backgrounds: [{ value: 'rgb(255, 255, 255)', count: 3 }, { value: 'rgb(7, 81, 59)', count: 1 }],
    text: [{ value: 'rgb(23, 45, 36)', count: 3 }, { value: 'rgb(255, 255, 255)', count: 1 }],
  },
  assets: ['origin/assets/hero.jpg'],
  transitions: {
    status: 'measured' as const, elementCount: 3,
    durations: [{ value: '0.5s', count: 3 }, { value: '0.25s', count: 1 }],
    easings: [{ value: 'ease', count: 3 }],
    properties: [{ value: 'color', count: 2 }, { value: 'opacity', count: 1 }],
    limitation: '기본 상태만 측정; 가리킴·누름 상태 전환과 키프레임 내용은 측정하지 않음',
  },
  missing: [],
  honoursReducedMotion: true,
  browserForcedReducedMotion: false,
};

const BASE = { tokens: TOKENS, title: '예시', assets: ['origin/assets/hero.jpg'] };

describe('designTokens — ⛔ 배관을 씨앗에 넣지 않는다', () => {
  test('--tw-* 를 뺀다', () => {
    expect(designTokens(TOKENS.customProperties).map((t) => t.name)).not.toContain('--tw-shadow');
  });
  test('나머지는 이름순으로 남는다', () => {
    const names = designTokens(TOKENS.customProperties).map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('--ink');
  });
});

describe('splitTokens', () => {
  test('색·타이포·모션을 가른다', () => {
    const s = splitTokens(designTokens(TOKENS.customProperties));
    expect(s.palette.map((t) => t.name)).toEqual(['--brand', '--ground', '--ink']);
    expect(s.typography.map((t) => t.name)).toContain('--font-sans');
    expect(s.motion.map((t) => t.name)).toContain('--ease-out');
    expect(s.other.map((t) => t.name)).toContain('--spacing');
  });
});

describe('normaliseColor — rgb 와 hex 를 «같은 값»으로', () => {
  test('rgb() 를 hex 로 편다', () => {
    expect(normaliseColor('rgb(23, 45, 36)')).toBe('#172d24');
  });
  test('3자리 hex 를 6자리로 편다', () => {
    expect(normaliseColor('#abc')).toBe('#aabbcc');
  });
  test('⛔ 못 풀면 null — 0 이나 검정으로 «몰지» 않는다', () => {
    expect(normaliseColor('currentColor')).toBeNull();
    expect(normaliseColor('var(--x)')).toBeNull();
  });
});

describe('nameForColor — 🩸 값 → 토큰 «이름» 역참조', () => {
  const palette = [{ name: '--ink', value: '#172d24' }, { name: '--brand', value: 'rgb(7, 81, 59)' }];
  test('rgb 로 들어와도 hex 토큰을 찾는다', () => {
    expect(nameForColor('rgb(23, 45, 36)', palette)).toBe('--ink');
  });
  test('hex 로 들어와도 rgb 토큰을 찾는다', () => {
    expect(nameForColor('#07513b', palette)).toBe('--brand');
  });
  test('⛔ 없으면 null — 아무 이름이나 붙이지 않는다', () => {
    expect(nameForColor('#ff0000', palette)).toBeNull();
  });
});

describe('contrastPairsFrom — ⛔ 투명 바탕은 쌍이 아니다', () => {
  test('불투명 바탕만 담는다', () => {
    const p = contrastPairsFrom(TOKENS.roles);
    expect(p.map((x) => x.role)).toEqual(['body', 'button']);   // h1 은 rgba(...,0)
  });
});

describe('renderDesignMd — ⭐ 산출이 «파서에 닿는가»', () => {
  const md = renderDesignMd(BASE);

  test('elanous design-check 문법을 낸다', () => {
    expect(md).toContain('## Craft rulebooks');
    expect(md).toContain('## Palette');
    expect(md).toContain('## Contrast pairs');
  });

  test('painted 색을 배경과 글자 순위로 분리해 백분율을 낸다', () => {
    expect(md).toContain('## Painted colors');
    expect(md).toContain('배경: rgb(255, 255, 255) (75.0% · 3/4개 요소)');
    expect(md).toContain('글자: rgb(23, 45, 36) (75.0% · 3/4개 요소)');
    expect(md.indexOf('배경: rgb(255, 255, 255)')).toBeLessThan(md.indexOf('배경: rgb(7, 81, 59)'));
    expect(md).toContain('## Palette');
    expect(md).toContain('## Typography');
  });

  test('painted 색을 못 재면 명시적으로 말한다', () => {
    const unmeasured = renderDesignMd({ ...BASE, paintedColors: null });
    expect(unmeasured).toContain('painted 색을 **못 쟀다**');
  });

  test('🩸 대비 쌍을 «토큰 이름»으로 적어 파서가 읽는다 — 첫 판은 0건이었다', () => {
    const pairs = readContrastPairs(md).pairs;
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs).toContainEqual({ fg: '--ground', bg: '--brand' });
  });

  test('⭐ design-tokens 리더가 팔레트를 실제로 읽는다', () => {
    const r = reportDesignTokens(md);
    expect(r.palette.tokens.map((t) => t.name)).toContain('--ink');
    expect(r.empty).toBe(false);
  });

  test('⛔ 배관 토큰은 씨앗에 «없다»', () => {
    expect(md).not.toContain('--tw-shadow');
  });

  test('⛔ 원문 저작물 경계를 문서가 «말한다»', () => {
    expect(md).toContain('공개 재배포하지 않는다');
  });

  test('계산된 전환을 값과 빈도로 내고 기존 변수·reduced-motion도 보존한다', () => {
    expect(md).toContain('--ease-out: cubic-bezier(.2,0,0,1)');
    expect(md).toContain('계산된 전환이 걸린 요소: 3개');
    expect(md).toContain('길이: 0.5s (3개 요소)');
    expect(md.indexOf('길이: 0.5s')).toBeLessThan(md.indexOf('길이: 0.25s'));
    expect(md).toContain('가속 곡선: ease (3개 요소)');
    expect(md).toContain('대상 프로퍼티: color (2개 요소)');
    expect(md).toContain('prefers-reduced-motion` 존중: ✅ 있다');
    expect(md).toContain('기본 상태만 측정');
  });

  test('전환 없음과 측정 실패를 서로 다른 문면으로 낸다', () => {
    const none = renderDesignMd({ ...BASE, tokens: { ...TOKENS, transitions: { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: '기본 상태만 측정' } } });
    const unreadable = renderDesignMd({ ...BASE, tokens: { ...TOKENS, transitions: { status: 'unreadable', limitation: '기본 상태만 측정' } } });
    expect(none).toContain('움직임이 없다');
    expect(none).not.toContain('요소를 훑지 못했다');
    expect(unreadable).toContain('못 쟀다');
    expect(unreadable).toContain('요소를 훑지 못했다');
    expect(unreadable).toContain('「움직임이 없다」가 아니다');
  });

  test('⛔ reduced-motion 은 «3상태»다 — 「없다」와 「못 읽었다」를 다른 말로 낸다', () => {
    expect(renderDesignMd({ ...BASE, tokens: { ...TOKENS, honoursReducedMotion: true } })).toContain('✅ 있다');
    expect(renderDesignMd({ ...BASE, tokens: { ...TOKENS, honoursReducedMotion: false } })).toContain('없다');
    // 🩸 이 칸이 없던 동안 null 이 «빨강»으로 찍혔다 — 교차 출처 시트를 「접근성 없음」으로 고발했다.
    const unread = renderDesignMd({ ...BASE, tokens: { ...TOKENS, honoursReducedMotion: null } });
    expect(unread).toContain('못 읽었다');
    expect(unread).not.toContain('접근성 바닥');
  });

  test('computed 진단 입력에서 계층·누락 후보·측정 조건을 사람이 읽을 경고로 낸다', () => {
    const md = renderDesignMd({
      ...BASE,
      tokens: {
        ...TOKENS,
        roles: {
          ...TOKENS.roles,
          h2: { 'font-size': '64px' },
          h3: { 'font-size': '64px' },
        },
        missing: ['link', 'footer'],
        browserForcedReducedMotion: true,
      },
    });
    expect(md).toContain('측정 조건: 브라우저 reduced-motion 강제 ON');
    expect(md).toContain('측정된 제목 후보: h1 57.6px → h2 64px → h3 64px');
    expect(md).toContain('후보 불일치: h2 (64px)가 h1 (57.6px)보다 작지 않다');
    expect(md).toContain('후보 불일치: h3 (64px)가 h2 (64px)보다 작지 않다');
    expect(md).toContain('측정하지 못한 역할 후보: link, footer');
  });

  test('h1·body가 누락돼도 production computed-token 입력의 h2·h3 후보 불일치와 크기 역전을 경고한다', () => {
    const md = renderDesignMd({
      ...BASE,
      tokens: {
        ...TOKENS,
        roles: {
          h2: { 'font-size': '32px' },
          h3: { 'font-size': '40px' },
        },
        missing: ['body', 'h1'],
      },
    });
    expect(md).toContain('측정된 제목 후보: h2 32px → h3 40px');
    expect(md).toContain('후보 불일치: h3 (40px)가 h2 (32px)보다 작지 않다');
    expect(md).toContain('측정하지 못한 역할 후보: body, h1');
  });

  test('⛔ 빈 절은 «지우지 않고» 못 읽었다고 적는다', () => {
    const empty = renderDesignMd({ ...BASE, tokens: { ...TOKENS, customProperties: {} } });
    expect(empty).toContain('못 읽었다');
  });
});

describe('⛔⭐ 「축이 전부 ⚪」와 「페이지가 안 열렸다」를 «가른다»', () => {
  // 📏 계기(2026-09-10 · coupang): 역할 2개만 잡히고 링크·버튼·머리·바닥이 전부 없었는데
  //    교차표에서 그것이 「팔레트가 2개인 사이트」로 «보였다».
  test('넷이 «전부» 없으면 「안 열렸다」고 말한다', () => {
    const v = pageBarelyRendered({ missing: ['h2', 'h3', 'link', 'button', 'header', 'footer'] });
    expect(v).not.toBeNull();
    expect(v).toContain('하나도');
  });

  test('⛔ 하나라도 잡혔으면 «말하지 않는다» — 「단순한 페이지」를 「안 열렸다」로 몰지 않는다', () => {
    expect(pageBarelyRendered({ missing: ['h3', 'header', 'footer', 'link'] })).toBeNull();
    expect(pageBarelyRendered({ missing: [] })).toBeNull();
  });
});
