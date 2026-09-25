import { describe, expect, test } from 'bun:test';
import { measureScreenContrast, parseScreenRuns, type Rgb } from './screen-contrast.js';

const ESC = '\x1b';
const fg = (r: number, g: number, b: number): string => `${ESC}[38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number): string => `${ESC}[48;2;${r};${g};${b}m`;
const RESET = `${ESC}[0m`;

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

describe('parseScreenRuns — SGR 을 «순서대로» 소화한다', () => {
  test('전경 truecolor 를 묶음에 싣는다', () => {
    const runs = parseScreenRuns(`${fg(255, 0, 0)}hello${RESET}`);
    expect(runs).toEqual([{ text: 'hello', foreground: { r: 255, g: 0, b: 0 }, background: null }]);
  });

  test('⭐ 한 이스케이프의 «여러 파라미터»를 인덱스로 읽는다 — 정규식 뽑기로는 틀린다', () => {
    // `0;48;2;10;20;30;38;2;40;50;60` — 배경과 전경이 «한 열»에 있다.
    const runs = parseScreenRuns(`${ESC}[0;48;2;10;20;30;38;2;40;50;60mx${RESET}`);
    expect(runs[0]?.background).toEqual({ r: 10, g: 20, b: 30 });
    expect(runs[0]?.foreground).toEqual({ r: 40, g: 50, b: 60 });
  });

  test('⭐ `ESC[m`(빈 파라미터)은 리셋이다 — 안 그러면 색이 «샌다»', () => {
    const runs = parseScreenRuns(`${fg(1, 2, 3)}a${ESC}[mb`);
    expect(runs[0]?.foreground).toEqual({ r: 1, g: 2, b: 3 });
    expect(runs[1]?.foreground).toBeNull();
  });

  test('39/49 는 «그 축만» 되돌린다', () => {
    const runs = parseScreenRuns(`${fg(1, 2, 3)}${bg(4, 5, 6)}a${ESC}[39mb`);
    expect(runs[1]).toEqual({ text: 'b', foreground: null, background: { r: 4, g: 5, b: 6 } });
  });

  test('⛔ 팔레트 색(38;5;n · 30-37)은 RGB 를 «모르므로» null 로 둔다', () => {
    expect(parseScreenRuns(`${ESC}[38;5;196mx`)[0]?.foreground).toBeNull();
    expect(parseScreenRuns(`${ESC}[31mx`)[0]?.foreground).toBeNull();
  });
});

describe('measureScreenContrast — 「못 잰 것」을 「통과」와 «섞지 않는다»', () => {
  test('문턱 미만이면 finding 을 낸다', () => {
    const runs = parseScreenRuns(`${fg(200, 200, 200)}${bg(255, 255, 255)}faint${RESET}`);
    const report = measureScreenContrast(runs, BLACK);

    expect(report.measured).toBe(1);
    expect(report.unresolved).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.text).toBe('faint');
    expect(report.findings[0]?.ratio).toBeLessThan(4.5);
  });

  test('문턱을 넘으면 finding 이 없다', () => {
    const runs = parseScreenRuns(`${fg(0, 0, 0)}${bg(255, 255, 255)}clear${RESET}`);
    expect(measureScreenContrast(runs, WHITE).findings).toEqual([]);
  });

  test('⭐ 명시 배경이 «없으면» 기본 배경에 기댄다 — 실측상 대부분이 이 경로다', () => {
    const runs = parseScreenRuns(`${fg(0, 0, 0)}dark-on-dark${RESET}`);
    const report = measureScreenContrast(runs, BLACK);

    expect(report.measured).toBe(1);
    expect(report.findings).toHaveLength(1); // 검정 위 검정 ⇒ 1:1
  });

  test('🚨⭐ 기본 배경을 «모르면» 통과가 아니라 unresolved 다', () => {
    const runs = parseScreenRuns(`${fg(0, 0, 0)}unknown-ground${RESET}`);
    const report = measureScreenContrast(runs, null);

    expect(report.measured).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.unresolved).toBe(1); // ⛔ 이 값이 0 이 아니면 findings:[] 를 「깨끗」으로 읽으면 안 된다
  });

  test('🚨⭐ 팔레트 전경도 unresolved 다 — 「봤는데 통과」가 «아니다»', () => {
    const report = measureScreenContrast(parseScreenRuns(`${ESC}[31mred-ish`), WHITE);
    expect(report.measured).toBe(0);
    expect(report.unresolved).toBe(1);
  });

  test('공백만인 묶음은 «분모에서 뺀다» — 글자가 없으면 대비가 뜻이 없다', () => {
    const report = measureScreenContrast(parseScreenRuns(`${fg(1, 1, 1)}   ${RESET}`), WHITE);
    expect(report.measured).toBe(0);
    expect(report.unresolved).toBe(0);
  });

  test('문턱은 «주입»된다 — WCAG 큰 글자(3:1) 같은 다른 자를 댈 수 있다', () => {
    const runs = parseScreenRuns(`${fg(120, 120, 120)}${bg(255, 255, 255)}mid${RESET}`);
    expect(measureScreenContrast(runs, WHITE, 4.5).findings).toHaveLength(1);
    expect(measureScreenContrast(runs, WHITE, 3).findings).toEqual([]);
  });

  test('박스 드로잉·블록 요소만인 묶음은 장식으로 세고 문턱 판정에서는 뺀다', () => {
    const runs = parseScreenRuns(`${fg(30, 30, 30)}━━━━█${RESET}${fg(30, 30, 30)}text${RESET}`);
    const report = measureScreenContrast(runs, BLACK);

    expect(report.decorative).toBe(1);
    expect(report.measured).toBe(1);
    expect(report.findings.map((finding) => finding.text)).toEqual(['text']);
  });

  test('공백으로 감싼 장식은 세고, 글자 혼합과 공백 전용 묶음은 기존대로 분류한다', () => {
    const runs = parseScreenRuns(
      `${fg(30, 30, 30)} │ ${RESET}${fg(30, 30, 30)}━━━━${RESET}`
      + `${fg(30, 30, 30)}┤ ChatLog ├${RESET}${fg(30, 30, 30)}   ${RESET}`,
    );
    const report = measureScreenContrast(runs, BLACK);

    expect(report.decorative).toBe(2);
    expect(report.measured).toBe(1);
    expect(report.unresolved).toBe(0);
    expect(report.findings.map((finding) => finding.text)).toEqual(['┤ ChatLog ├']);
  });

  test('기본 전경을 주면 명시 전경 없는 묶음을 재고, 생략하면 unresolved 로 센다', () => {
    const runs = parseScreenRuns('implicit-foreground');

    const withoutDefault = measureScreenContrast(runs, BLACK);
    expect(withoutDefault.measured).toBe(0);
    expect(withoutDefault.unresolved).toBe(1);

    const withDefault = measureScreenContrast(runs, BLACK, 4.5, BLACK);
    expect(withDefault.measured).toBe(1);
    expect(withDefault.unresolved).toBe(0);
    expect(withDefault.findings).toHaveLength(1);
  });
});
