import { describe, expect, test } from 'bun:test';

import { createTurnTypeaheadState, applyTurnTypeaheadKey } from '../src/chat/turn-typeahead.js';
import {
  buildTurnTypeaheadPromptRows,
  paintTurnTypeaheadEchoRow,
  type TurnTypeaheadPromptPaint,
} from '../src/dashboard/input/turn-typeahead-prompt.js';
import {
  buildDashboardTurnTypeaheadPromptZone,
  drawDashboardTurnTypeaheadPromptRows,
  observeDashboardTurnTypeaheadPromptZone,
} from '../src/dashboard/index.js';
import { createTurnStreamPresentationApplier } from '../src/dashboard/turn-stream-presentation-applier.js';

const frame = {
  inputHeight: 2,
  promptTopRow: 10,
  promptBottomRow: 11,
  topDividerRow: 9,
  bottomDividerRow: 12,
};

function runtime() {
  return {
    setArgs: () => {}, getArgs: () => undefined, deleteArgs: () => {},
    replaceBlock: (_id: string, lines: string[]) => lines.length,
    registerFold: () => {},
  };
}

describe('dashboard typeahead prompt production draw path', () => {
  test('wiring: the input-prompt zone render delegates to the prompt-row adapter', () => {
    const state = applyTurnTypeaheadKey(createTurnTypeaheadState(), { name: '한' }).state;
    const input = {
      frame,
      height: frame.inputHeight,
      placeholder: '❯ ',
      prompt: '❯ ',
      state,
      width: 80,
    };

    const zone = buildDashboardTurnTypeaheadPromptZone({ ...input, suppressPromptArea: false });

    expect(zone).toMatchObject({ id: 'input-prompt', height: frame.inputHeight });
    expect(zone.render(frame.inputHeight, 80)).toEqual(buildTurnTypeaheadPromptRows(input));
  });

  test('measure: imperative echo and streaming dashboard draw target the same absolute prompt row, including an empty buffer', () => {
    const paints: TurnTypeaheadPromptPaint[] = [];
    const typed = applyTurnTypeaheadKey(createTurnTypeaheadState(), { name: '한' }).state;
    const echo = paintTurnTypeaheadEchoRow({
      frame, state: typed, width: 80, prompt: '❯ ',
    }, paint => paints.push(paint));
    const rows = drawDashboardTurnTypeaheadPromptRows({
      frame, height: frame.inputHeight, placeholder: '❯ ', prompt: '❯ ', state: typed, width: 80,
    }, paint => paints.push(paint));
    const emptyRows = drawDashboardTurnTypeaheadPromptRows({
      frame, height: frame.inputHeight, placeholder: '❯ ', prompt: '❯ ', state: createTurnTypeaheadState(), width: 80,
    }, paint => paints.push(paint));

    expect(echo).toStartWith('\x1b[11;1H\x1b[2K❯ 한');
    expect(rows).toEqual(['', '❯ 한']);
    expect(emptyRows).toEqual(['', '❯ ']);
    expect(paints).toEqual([
      { source: 'typeahead-echo', row: 11, text: '❯ 한', caret: { row: 11, col: 5, visible: true } },
      { source: 'dashboard-draw-prompt', row: 11, text: '❯ 한', caret: { row: 11, col: 5, visible: true } },
      { source: 'dashboard-draw-prompt', row: 11, text: '❯ ', caret: { row: 11, col: 3, visible: true } },
    ]);
  });

  test('fix: an empty hinted streaming row keeps the caret after the placeholder and suppresses the hint after input', () => {
    const paints: TurnTypeaheadPromptPaint[] = [];
    const hint = '입력하면 이어서 보냅니다';
    const hintedRows = drawDashboardTurnTypeaheadPromptRows({
      frame, height: frame.inputHeight, placeholder: '❯ ', hint, prompt: '❯ ', state: createTurnTypeaheadState(), width: 80,
    }, paint => paints.push(paint));
    const typed = applyTurnTypeaheadKey(createTurnTypeaheadState(), { name: '한' }).state;
    const typedRows = drawDashboardTurnTypeaheadPromptRows({
      frame, height: frame.inputHeight, placeholder: '❯ ', hint, prompt: '❯ ', state: typed, width: 80,
    }, paint => paints.push(paint));

    expect(hintedRows).toEqual(['', `❯ ${hint}`]);
    expect(paints[0]).toEqual({
      source: 'dashboard-draw-prompt', row: 11, text: `❯ ${hint}`, caret: { row: 11, col: 3, visible: true },
    });
    expect(typedRows).toEqual(['', '❯ 한']);
    expect(paints[1]).toEqual({
      source: 'dashboard-draw-prompt', row: 11, text: '❯ 한', caret: { row: 11, col: 5, visible: true },
    });
  });

  test('fix: imperative echo leaves the physical cursor at the current multi-character input end', () => {
    const typed = ['a', 'b', '한'].reduce(
      (state, name) => applyTurnTypeaheadKey(state, { name }).state,
      createTurnTypeaheadState(),
    );

    const echo = paintTurnTypeaheadEchoRow({ frame, state: typed, width: 80, prompt: '❯ ' });

    expect(echo).toStartWith('\x1b[11;1H\x1b[2K❯ ab한');
    expect(echo).toEndWith('\x1b[11;7H\x1b[?25h');
  });

  test('fix: streaming presentation invokes the production dashboard draw adapter and retains the typeahead buffer on the overwritten row', () => {
    const typed = applyTurnTypeaheadKey(createTurnTypeaheadState(), { name: '한' }).state;
    const paints: TurnTypeaheadPromptPaint[] = [];
    paintTurnTypeaheadEchoRow({ frame, state: typed, width: 80, prompt: '❯ ' }, paint => paints.push(paint));
    const applier = createTurnStreamPresentationApplier({
      chatLines: [],
      initialAssistantStart: 0,
      renderedToolRuntime: runtime(),
      pinChatTail: () => {},
      draw: () => {
        drawDashboardTurnTypeaheadPromptRows({
          frame, height: frame.inputHeight, placeholder: '❯ ', prompt: '❯ ', state: typed, width: 80,
        }, paint => paints.push(paint));
      },
    });

    applier.apply({ type: 'assistant.replaceBlock', lines: ['streaming chunk'] });

    expect(paints).toEqual([
      { source: 'typeahead-echo', row: 11, text: '❯ 한', caret: { row: 11, col: 5, visible: true } },
      { source: 'dashboard-draw-prompt', row: 11, text: '❯ 한', caret: { row: 11, col: 5, visible: true } },
    ]);
    expect(paints[1]).toMatchObject({ row: frame.promptBottomRow, text: '❯ 한' });
  });
});

describe('observeDashboardTurnTypeaheadPromptZone — 관측 래퍼가 inner 를 실제로 부른다', () => {
  // ⛔⭐ 리뷰 must-fix(2026-08-01): 종전 테스트는 inner(build…Zone)만 불러서,
  //    zones.push 안의 래퍼가 inner.render 를 끊어도 통과했다. 이 describe 가 그 결선을 고정한다.
  //    ⚠️ 남은 한 겹(반환이 실제로 zones 배열에 push 되는지)은 지역 조립부라 단위 검사 밖이다 —
  //       무한 후퇴이므로 경계를 긋고 라이브 검증에 맡긴다(함수 주석 참조).
  const innerRows = ['❯ 한글', 'tail'];
  const inner = { id: 'input-prompt', height: 2, render: () => innerRows };

  test('래퍼의 render 산출이 inner 산출과 같다', () => {
    const zone = observeDashboardTurnTypeaheadPromptZone(inner, {
      promptBottomRow: 11,
      state: { buffer: '한글', queuedSubmissions: [] },
      isDebugEnabled: () => false,
    });
    expect(zone.render(2, 40)).toEqual(innerRows);
    expect(zone.id).toBe('input-prompt');
  });

  test('inner.render 를 끊으면 산출이 달라진다 (배선 검출)', () => {
    const severed = { id: 'input-prompt', height: 2, render: () => ['', ''] };
    const zone = observeDashboardTurnTypeaheadPromptZone(severed, {
      promptBottomRow: 11,
      state: { buffer: '한글', queuedSubmissions: [] },
      isDebugEnabled: () => false,
    });
    expect(zone.render(2, 40)).not.toEqual(innerRows);
  });

  test('버퍼가 있고 debug 가 켜져 있으면 관측을 남긴다', () => {
    const logged: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
    const zone = observeDashboardTurnTypeaheadPromptZone(inner, {
      promptBottomRow: 11,
      state: { buffer: '한글', queuedSubmissions: ['queued'] },
      isDebugEnabled: () => true,
      log: (category, event, data) => logged.push({ category, event, data }),
    });
    zone.render(2, 40);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      category: 'dashboard.turn-typeahead-prompt',
      event: 'dashboard-draw-prompt',
      data: { row: 11, text: 'tail', bufferLength: 2, queuedSubmissionCount: 1 },
    });
  });

  test('빈 버퍼면 관측을 안 남긴다 (빈 경로)', () => {
    const logged: unknown[] = [];
    const zone = observeDashboardTurnTypeaheadPromptZone(inner, {
      promptBottomRow: 11,
      state: { buffer: '', queuedSubmissions: [] },
      isDebugEnabled: () => true,
      log: () => logged.push(1),
    });
    zone.render(2, 40);
    expect(logged).toHaveLength(0);
  });
});
