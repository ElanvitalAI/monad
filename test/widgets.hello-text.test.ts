import { describe, expect, test } from 'bun:test';
import helloTextWidget, { type HelloTextState } from '../widgets/hello-text/widget.js';

function ctxOf(): any {
  return {
    widgetId: 'wd-hello',
    widgetType: 'hello-text',
    character: 'Hello',
    width: 24,
    height: 4,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
  };
}

describe('hello-text onMouse', () => {
  test('click increments presses', () => {
    const state: HelloTextState = helloTextWidget.initialState({ message: 'hi' });
    const patches: Array<Partial<HelloTextState>> = [];
    const ctx = { ...ctxOf(), setState: (patch: Partial<HelloTextState>) => patches.push(patch) };

    const action = helloTextWidget.onMouse!({ type: 'click', row: 1, col: 2 } as never, state, ctx);

    expect(action).toEqual({ type: 'refresh' });
    expect(patches).toEqual([{ presses: 1 }]);
  });

  test('scroll is ignored', () => {
    const state = helloTextWidget.initialState();
    expect(helloTextWidget.onMouse!({ type: 'scroll-down', row: 1, col: 0 } as never, state, ctxOf()))
      .toEqual({ type: 'none' });
  });
});
