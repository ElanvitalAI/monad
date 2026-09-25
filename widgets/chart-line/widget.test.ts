import { describe, expect, test } from 'bun:test';
import chartLine from './widget.js';
import type { WidgetContext } from '../../src/widgets/types.js';
import type { ChartLineState } from './widget.js';

function handlerCtx(state: ChartLineState): WidgetContext<ChartLineState> {
  return {
    widgetId: 'chart-1',
    widgetType: 'chart-line',
    character: 'Chart',
    state,
    setState() {},
    requestRender() {},
    dismiss() {},
    log() {},
  };
}

describe('chart-line WidgetContext size fallback', () => {
  test('onMouse keeps ctx.width ?? 0 when the host omits width', () => {
    const state = chartLine.initialState({ series: [10, 20, 30, 40, 50] });
    const action = chartLine.onMouse!(
      { type: 'click', row: 2, col: 9 } as never,
      state,
      handlerCtx(state),
    );
    expect(action).toEqual({ type: 'refresh' });
    // width omitted → chartW floors to 4, so click col 9 maps into the last visible slice.
    expect(state.selectedIndex).toBe(3);
  });
});
