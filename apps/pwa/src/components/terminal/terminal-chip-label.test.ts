import { describe, expect, test } from 'bun:test';

import { TUI_PREVIEW_TERMINAL_ID, terminalChipLabel, terminalKindOf } from './terminal-chip-label';

// 대표 2026-08-17 — "preview-1 같은 아이디가 이제는 의미 없지 않나요?"
// 📏 전수: 'preview-1' 은 src/dashboard/index.ts 단 한 곳에서 TUI 프리뷰 페인에 못 박혀 있다.
//    ⇒ 이름을 바꾸면 접점이 끊긴다. 「무엇인지」를 말하게 하는 것이 옳은 처방이다.
describe('terminalKindOf — id 가 «무엇인지» 가른다', () => {
  test('preview-1 은 TUI 프리뷰 페인이다 — 나머지 preview-N 과 «다르다»', () => {
    expect(terminalKindOf(TUI_PREVIEW_TERMINAL_ID)).toBe('tui-preview');
    expect(terminalKindOf('preview-2')).toBe('web-scratch');
    expect(terminalKindOf('preview-17')).toBe('web-scratch');
  });

  test('데몬 pty 체계 셋을 가른다', () => {
    expect(terminalKindOf('self_5837456a')).toBe('harness-run');
    expect(terminalKindOf('agent:5498d08a')).toBe('agent');
    expect(terminalKindOf('pty_2696c00d')).toBe('pty');
  });

  test('살아 있는 TUI, 사람이 만든 터미널, 레거시 데몬 웹 터미널을 가른다', () => {
    expect(terminalKindOf('tui:85858')).toBe('tui-surface');
    expect(terminalKindOf('term-msxqf1nf')).toBe('human-terminal');
    expect(terminalKindOf('webterm-msxqf1nf')).toBe('web-terminal');
  });

  test('정확한 term- 접두가 아니면 «모른다»고 한다 — 지어내지 않는다', () => {
    expect(terminalKindOf('weird-thing')).toBe('unknown');
    expect(terminalKindOf('term')).toBe('unknown');
    expect(terminalKindOf('xterm-msxqf1nf')).toBe('unknown');
    expect(terminalKindOf('preview-')).toBe('unknown');
    expect(terminalKindOf('previewX-1')).toBe('unknown');
  });
});

describe('terminalChipLabel — 칩이 「이게 무엇인지」 말한다', () => {
  test('TUI 프리뷰는 사람 말로 보이고 원래 id 는 툴팁에 남는다', () => {
    const got = terminalChipLabel('preview-1');
    expect(got.text).toBe('TUI 프리뷰');
    expect(got.hint).toContain('preview-1');
    expect(got.kind).toBe('tui-preview');
  });

  test('데몬이 아는 이름이 있으면 그것을 쓴다', () => {
    expect(terminalChipLabel('agent:5498d08a', 'general-purpose: Fix restored CLI tests').text)
      .toBe('general-purpose: Fix restored CLI tests');
  });

  test('살아 있는 TUI, 사람이 만든 터미널, 레거시 데몬 웹 터미널은 id와 출처를 함께 말한다', () => {
    const tui = terminalChipLabel('tui:85858');
    expect(tui).toEqual({
      text: 'tui:85858',
      hint: '대화형 대시보드 TUI 표면 · tui:85858',
      kind: 'tui-surface',
    });

    const humanTerminal = terminalChipLabel('term-msxqf1nf');
    expect(humanTerminal).toEqual({
      text: 'term-msxqf1nf',
      hint: '사람이 만든 웹 터미널 · term-msxqf1nf',
      kind: 'human-terminal',
    });

    const webTerminal = terminalChipLabel('webterm-msxqf1nf');
    expect(webTerminal).toEqual({
      text: 'webterm-msxqf1nf',
      hint: '데몬이 발급한 웹 터미널 · webterm-msxqf1nf',
      kind: 'web-terminal',
    });
  });

  test('이름이 없으면 «id 를 그대로» 둔다 — 가짜 이름을 만들지 않는다', () => {
    expect(terminalChipLabel('self_5837456a').text).toBe('self_5837456a');
    expect(terminalChipLabel('self_5837456a', '   ').text).toBe('self_5837456a');
    expect(terminalChipLabel('self_5837456a', null).text).toBe('self_5837456a');
  });

  test('스크래치 탭은 id 를 그대로 보이되 «무엇인지»는 툴팁이 말한다', () => {
    const got = terminalChipLabel('preview-3');
    expect(got.text).toBe('preview-3');
    expect(got.hint).toContain('스크래치');
  });
});
