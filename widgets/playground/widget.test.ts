import { describe, expect, test } from 'bun:test';
import playground, { type PlaygroundState } from './widget.js';
import type { WidgetContext } from '../../src/widgets/types.js';

function handlerCtx(state: PlaygroundState): WidgetContext<PlaygroundState> {
  return {
    widgetId: 'pg-1',
    widgetType: 'playground',
    character: 'Playground',
    get state() { return state; },
    setState(patch) { Object.assign(state, patch); },
    requestRender() {},
    dismiss() {},
    log() {},
  };
}

describe('playground WidgetContext size fallback', () => {
  test('onKey keeps ctx.height ?? 8 when the host omits height', () => {
    const state = playground.initialState!();
    const action = playground.onKey!(
      { name: 'down', sequence: 'down', ctrl: false, alt: false, shift: false, meta: false } as never,
      state,
      handlerCtx(state),
    );
    expect(action.type).not.toBe('none');
    expect(state.editorScrollTop).toBeGreaterThanOrEqual(0);
  });
});
