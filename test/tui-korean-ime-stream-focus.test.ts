import { describe, expect, test } from 'bun:test';

import { createDashboardTurnStreamRuntime } from '../src/dashboard/turn-stream-runtime.js';
import { createFocusManager } from '../src/primitives/focus-manager/index.js';

function createStreamRuntime(
  draw: () => void,
  withPassiveRenderFocus?: <T>(render: () => T) => T,
) {
  return createDashboardTurnStreamRuntime({
    initialAssistantStart: 0,
    chatLines: [],
    thinking: { update: () => {}, updateMetrics: () => {} },
    draw,
    ...(withPassiveRenderFocus ? { withPassiveRenderFocus } : {}),
    pinChatTail: () => {},
    termCols: () => 80,
    wrapOpts: {},
    formatResponse: (full) => [full],
    text: (line) => line,
    muted: (text) => text,
    ptyCallLine: () => null,
    ptyResultLine: () => null,
    renderToolCallEvent: () => null,
    renderToolResultVariants: () => null,
    toolRendering: {},
    renderedToolRuntime: {
      setArgs: () => {},
      getArgs: () => undefined,
      deleteArgs: () => {},
      replaceBlock: () => 0,
      registerFold: () => {},
    },
    brainIcon: '[brain]',
  });
}

describe('TUI stream render focus ownership', () => {
  test('streaming renders preserve the input focus owner used by input routing', () => {
    const focus = createFocusManager({ passiveRenderFocus: true });
    focus.register({ id: 'pane:input', scope: 'dashboard', focusable: true, priority: 1, owner: 'dashboard' });
    focus.register({ id: 'wd-log', scope: 'dashboard', focusable: true, priority: 2, owner: 'dashboard' });
    focus.setFocus('pane:input', 'chat-entry');

    const runtime = createStreamRuntime(
      () => focus.setFocus('wd-log', 'render-log-projection'),
      (render) => focus.withPassiveRenderFocus(render),
    );

    runtime.onText('assistant chunk', 'assistant chunk');

    expect(focus.active()?.id).toBe('pane:input');
  });

  test('passive streaming renders yield to a modal and preserve an explicit focus change on the next render', () => {
    const focus = createFocusManager({ passiveRenderFocus: true });
    focus.register({ id: 'pane:input', scope: 'dashboard', focusable: true, priority: 1, owner: 'dashboard' });
    focus.register({ id: 'wd-log', scope: 'dashboard', focusable: true, priority: 2, owner: 'dashboard' });
    focus.register({ id: 'confirm', scope: 'modal', focusable: true, priority: 3, owner: 'dashboard' });
    focus.setFocus('pane:input', 'chat-entry');

    let renderTarget = 'confirm';
    const runtime = createStreamRuntime(
      () => focus.setFocus(renderTarget, 'render-focus-write'),
      (render) => focus.withPassiveRenderFocus(render),
    );
    runtime.onText('assistant', 'assistant');
    expect(focus.active()?.id).toBe('confirm');

    focus.setFocus('wd-log', 'user-tab');
    renderTarget = 'pane:input';
    runtime.onText('next assistant chunk', 'next assistant chunk');

    expect(focus.active()?.id).toBe('wd-log');
  });

  test('without injecting passive-render focus, stream renders retain their previous behavior', () => {
    const focus = createFocusManager({ passiveRenderFocus: true });
    focus.register({ id: 'pane:input', scope: 'dashboard', focusable: true, priority: 1, owner: 'dashboard' });
    focus.register({ id: 'wd-log', scope: 'dashboard', focusable: true, priority: 2, owner: 'dashboard' });
    focus.setFocus('pane:input', 'chat-entry');

    const runtime = createStreamRuntime(
      () => focus.setFocus('wd-log', 'render-log-projection'),
    );
    runtime.onText('assistant', 'assistant');

    expect(focus.active()?.id).toBe('wd-log');
  });

  test('passive render safely skips restoration when its prior focus node unregisters', () => {
    const focus = createFocusManager({ passiveRenderFocus: true });
    focus.register({ id: 'pane:input', scope: 'dashboard', focusable: true, priority: 1, owner: 'dashboard' });
    focus.register({ id: 'wd-log', scope: 'dashboard', focusable: true, priority: 2, owner: 'dashboard' });
    focus.setFocus('pane:input', 'chat-entry');

    const runtime = createStreamRuntime(
      () => {
        focus.unregister('pane:input');
        focus.setFocus('wd-log', 'render-log-projection');
      },
      (render) => focus.withPassiveRenderFocus(render),
    );

    expect(() => runtime.onText('assistant', 'assistant')).not.toThrow();
    expect(focus.active()?.id).toBe('wd-log');
  });
});
