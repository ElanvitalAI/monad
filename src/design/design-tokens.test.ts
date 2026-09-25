// ── DESIGN.md 토큰 어휘 시험 — ⛔ 「없다」와 「틀렸다」가 갈리는가 ────────────────

import { describe, expect, test } from 'bun:test';

import {
  measureDeclaredContrasts, measureDeclaredPairs, readContrastPairs, readTokenSection,
  reportDesignTokens, PALETTE_HEADING, TYPOGRAPHY_HEADING,
} from './design-tokens.js';

const DOC = `# Design

## Craft rulebooks

- anti-ai-slop

## Palette

- --accent: #9d783f
- --ink: #172d24
- --ground: #ffffff
- 이건 토큰이 아니다
- --brand: #07513b

## Typography

- --font-display: Pretendard, "Noto Sans KR", sans-serif

## Design direction

- monad-pastel-default
`;

describe('readTokenSection — 기존 파서를 «그대로» 쓴다', () => {
  test('토큰을 이름·값으로 가른다', () => {
    const s = readTokenSection(DOC, PALETTE_HEADING);
    expect(s.tokens.map((t) => t.name)).toEqual(['--accent', '--ink', '--ground', '--brand']);
    expect(s.tokens[0].value).toBe('#9d783f');
  });

  test('⛔ 모양이 아닌 줄을 «조용히 버리지» 않는다', () => {
    expect(readTokenSection(DOC, PALETTE_HEADING).malformed).toEqual(['이건 토큰이 아니다']);
  });

  test('값 안의 콜론을 «첫 콜론에서만» 가른다 — 폰트 스택이 안 잘린다', () => {
    const t = readTokenSection(DOC, TYPOGRAPHY_HEADING).tokens[0];
    expect(t.name).toBe('--font-display');
    expect(t.value).toBe('Pretendard, "Noto Sans KR", sans-serif');
  });

  test('⛔ 중복 선언은 «둘 다» 안 쓰고 malformed 로 — 어느 것이 참인지 문서가 안 말한다', () => {
    const s = readTokenSection('## Palette\n\n- --a: #111\n- --a: #222\n', PALETTE_HEADING);
    expect(s.tokens).toHaveLength(1);
    expect(s.tokens[0].value).toBe('#111');
    expect(s.malformed[0]).toContain('중복 선언');
  });

  test('절이 «없으면» 빈 결과 — 던지지 않는다', () => {
    expect(readTokenSection('# Design\n', PALETTE_HEADING)).toEqual({ tokens: [], malformed: [] });
  });

  test('값이 «비면» 토큰이 아니다', () => {
    expect(readTokenSection('## Palette\n\n- --a:\n', PALETTE_HEADING).tokens).toEqual([]);
  });
});

describe('reportDesignTokens', () => {
  test('색 토큰만 «따로» 센다 — 폰트는 팔레트 수에서 빠진다', () => {
    const r = reportDesignTokens(DOC);
    expect(r.palette.tokens).toHaveLength(4);
    expect(r.colorTokenCount).toBe(4);
    expect(r.typography.tokens).toHaveLength(1);
  });

  test('⭐ anti-ai-slop 이 전제하는 --accent 가 «있나»를 값으로 낸다', () => {
    expect(reportDesignTokens(DOC).hasAccent).toBe(true);
    expect(reportDesignTokens('## Palette\n\n- --ink: #111\n').hasAccent).toBe(false);
  });

  test('🩸 선언이 «하나도 없으면» empty — 규칙이 묶일 값이 없다는 뜻', () => {
    const r = reportDesignTokens('# Design\n\n## Craft rulebooks\n\n- anti-ai-slop\n');
    expect(r.empty).toBe(true);
    expect(r.hasAccent).toBe(false);
  });
});

describe('measureDeclaredContrasts — 씨앗 ↔ 대비 계산기를 «잇는다»', () => {
  const palette = [
    { name: '--ink', value: '#172d24' },
    { name: '--ground', value: '#ffffff' },
    { name: '--accent', value: '#9d783f' },
    { name: '--font', value: 'Pretendard' },   // ⛔ 색이 아니다
  ];

  test('색 쌍을 실제로 잰다', () => {
    const [p] = measureDeclaredContrasts(palette, ['--ink'], ['--ground']);
    expect(p.ratio).toBeGreaterThan(14);
    expect(p.meetsNormalText).toBe(true);
  });

  test('🔴 문턱을 못 넘는 쌍을 «통과시키지 않는다»', () => {
    const [p] = measureDeclaredContrasts(palette, ['--accent'], ['--ground']);
    expect(p.ratio).toBeLessThan(4.5);
    expect(p.meetsNormalText).toBe(false);
  });

  test('⛔ 색이 아닌 토큰은 «건너뛴다» — 0 으로 세지 않는다', () => {
    expect(measureDeclaredContrasts(palette, ['--font'], ['--ground'])).toEqual([]);
  });

  test('⛔ 없는 이름은 조용히 건너뛴다(던지지 않는다)', () => {
    expect(measureDeclaredContrasts(palette, ['--nope'], ['--ground'])).toEqual([]);
  });
});

describe('contrast pairs — 🩸 전 조합은 «소음»이다', () => {
  const doc = `## Palette

- --ink: #172d24
- --ground: #ffffff
- --on-brand: #ffffff
- --brand: #07513b

## Contrast pairs

- --ink on --ground
- --on-brand on --brand
- 이건 쌍이 아니다
`;
  test('선언된 쌍만 읽는다', () => {
    const r = readContrastPairs(doc);
    expect(r.pairs).toEqual([
      { fg: '--ink', bg: '--ground' },
      { fg: '--on-brand', bg: '--brand' },
    ]);
    expect(r.malformed).toEqual(['이건 쌍이 아니다']);
  });

  test('⭐ 그 쌍«만» 잰다 — 안 쓰는 조합이 경고로 안 뜬다', () => {
    const r = reportDesignTokens(doc);
    const measured = measureDeclaredPairs(r.palette.tokens, r.contrastPairs.pairs);
    expect(measured).toHaveLength(2);
    expect(measured.every((p) => p.meetsNormalText)).toBe(true);
  });

  test('⛔ 쌍 선언이 «없으면» 빈 결과 — 「통과」가 아니라 「안 쟀다」다', () => {
    const r = reportDesignTokens('## Palette\n\n- --a: #111\n');
    expect(r.contrastPairs.pairs).toEqual([]);
    expect(measureDeclaredPairs(r.palette.tokens, r.contrastPairs.pairs)).toEqual([]);
  });
});
