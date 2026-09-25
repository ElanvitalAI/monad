/**
 * seed-motion.test.ts — ⛔ 이 자의 가장 위험한 수는 ***없는 움직임을 지어내는 것***이다.
 * ⭐ 그래서 무게가 「절이 없다」·「빈 단계」·「안 쓰이는 목록에 안 걸린다」에 실려 있다.
 */
import { describe, expect, test } from 'bun:test';

import { readSeedKeyframes, renderEasingTokens, renderKeyframesCss } from './seed-motion.js';

const seed = (body: string) => `# X\n\n### 키프레임 — ⭐ 「무엇이」 움직이나\n\n${body}\n\n### 다음 절\n\n- 딴것\n`;

describe('씨앗 되읽기', () => {
  test('쓰이는 것의 이름·단계·선언을 «그대로» 읽는다', () => {
    const r = readSeedKeyframes(seed([
      '- `spin` — 규칙 1개가 쓴다 (`.s::after`)',
      '  - ⭐ 움직이는 것: transform',
      '  - 0%: transform: rotate(0deg)',
      '  - 100%: transform: rotate(360deg)',
    ].join('\n')))!;
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('spin');
    expect(r[0].usedIn).toEqual(['.s::after']);
    expect(r[0].steps).toEqual([
      { offset: '0%', declarations: ['transform: rotate(0deg)'] },
      { offset: '100%', declarations: ['transform: rotate(360deg)'] },
    ]);
  });

  test('⭐ 한 단계의 선언이 여럿이면 «전부» 읽는다 — 줄이면 다시 못 짓는다', () => {
    const r = readSeedKeyframes(seed([
      '- `show` — 규칙 1개가 쓴다 (`.n`)',
      '  - 0%: opacity: 0; transform: perspective(450px) translateY(-30px) rotateX(90deg)',
    ].join('\n')))!;
    expect(r[0].steps[0].declarations).toEqual([
      'opacity: 0', 'transform: perspective(450px) translateY(-30px) rotateX(90deg)',
    ]);
  });

  test('⛔ 「정의만 되고 안 쓰이는」 목록 줄을 «단계로» 읽지 않는다', () => {
    const r = readSeedKeyframes(seed([
      '- `spin` — 규칙 1개가 쓴다 (`.s`)',
      '  - 0%: opacity: 0',
      '',
      '- ⚪ **정의만 되고 «안 쓰이는»** 이름 2개: ghost · other',
    ].join('\n')))!;
    expect(r.map((f) => f.name)).toEqual(['spin']);
  });

  test('⛔ `(선언 없음)` 단계는 «안 낸다» — 빈 규칙은 아무 뜻도 없다', () => {
    const r = readSeedKeyframes(seed([
      '- `spin` — 규칙 1개가 쓴다 (`.s`)',
      '  - 0%: (선언 없음)',
      '  - 100%: opacity: 1',
    ].join('\n')))!;
    expect(r[0].steps).toEqual([{ offset: '100%', declarations: ['opacity: 1'] }]);
  });

  test('⛔ 단계가 «하나도 없는» 것은 담지 않는다', () => {
    expect(readSeedKeyframes(seed('- `spin` — 규칙 1개가 쓴다 (`.s`)'))).toEqual([]);
  });

  test('⛔ 절이 «없으면» null — 「움직임이 없다」와 다른 값이다', () => {
    expect(readSeedKeyframes('# X\n\n## Palette\n\n- a: #fff\n')).toBeNull();
  });

  test('절은 있는데 쓰이는 것이 없으면 «빈 배열» — null 과 다르다', () => {
    expect(readSeedKeyframes(seed('- `@keyframes` 가 **없다** (읽은 시트 전부에서)'))).toEqual([]);
  });
});

describe('CSS 로 내기', () => {
  const frames = [{
    name: 'spin', usedIn: ['.s::after'],
    steps: [{ offset: '0%', declarations: ['transform: rotate(0deg)'] }],
  }];

  test('블록을 그대로 낸다 — ⛔ 이름을 «바꾸지» 않는다(대조가 끊긴다)', () => {
    expect(renderKeyframesCss(frames).join('\n')).toContain('@keyframes spin {\n  0% { transform: rotate(0deg); }\n}');
  });

  test('⛔⭐ 원본 선택자는 «규칙»이 아니라 «주석»으로 낸다 — 구현을 베끼지 않는다', () => {
    const css = renderKeyframesCss(frames).join('\n');
    expect(css).toContain('/* 원본에서 `.s::after` 가 썼다');
    // ⛔ 선택자가 «규칙»으로 새어 나가면 안 된다
    expect(css).not.toMatch(/^\.s::after\s*\{/m);
  });

  test('⛔⭐ 곡선 이름을 «지어내지» 않는다 — 번호를 준다', () => {
    expect(renderEasingTokens(['cubic-bezier(0.25, 1, 0.5, 1)', 'ease-out'])).toEqual([
      '  --ease-1: cubic-bezier(0.25, 1, 0.5, 1);',
      '  --ease-2: ease-out;',
    ]);
  });

  test('빈 목록은 «아무것도» 안 낸다 (소음 금지)', () => {
    expect(renderKeyframesCss([])).toEqual([]);
    expect(renderEasingTokens([])).toEqual([]);
  });
});
