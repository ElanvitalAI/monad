import { describe, expect, test } from 'bun:test';

import { createChatMainInputHost } from '../src/dashboard/input/chat-main-host.js';

describe('createChatMainInputHost', () => {
  test('repaints expanded input after the dashboard redraw microtask', async () => {
    const calls: string[] = [];
    const host = createChatMainInputHost({
      promptCtl: {
        repaint: () => { calls.push('prompt:repaint'); },
      },
      setInputLines: (n) => {
        calls.push(`lines:${n}`);
        return true;
      },
      redraw: () => {
        calls.push('redraw:request');
        queueMicrotask(() => { calls.push('redraw:paint'); });
      },
      dispatchGlobalAction: () => {},
    });

    host.onLinesChange?.(2);
    expect(calls).toEqual(['lines:2', 'redraw:request']);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(calls).toEqual([
      'lines:2',
      'redraw:request',
      'redraw:paint',
      'prompt:repaint',
    ]);
  });

  test('dispatchGlobalAction routes through the unified host seam and repaints', async () => {
    const calls: string[] = [];
    const host = createChatMainInputHost({
      promptCtl: {
        repaint: () => { calls.push('prompt:repaint'); },
      },
      setInputLines: () => false,
      redraw: () => { calls.push('redraw'); },
      dispatchGlobalAction: (action) => {
        switch (action.kind) {
          case 'resize-log': calls.push(`resize:${action.delta}:${action.reset ? 'reset' : 'keep'}`); break;
          case 'toggle-log-zoom': calls.push('zoom'); break;
          case 'goto-log': calls.push('goto'); break;
          case 'copy-last-block': calls.push('copy-last'); break;
          case 'spawn-terminal-modal': calls.push('spawn-terminal'); break;
          case 'copy-log-pane': calls.push('copy-log'); break;
        }
      },
    });

    await host.dispatchGlobalAction?.({ kind: 'resize-log', delta: 5 });
    await host.dispatchGlobalAction?.({ kind: 'toggle-log-zoom' });
    await host.dispatchGlobalAction?.({ kind: 'goto-log' });
    await host.dispatchGlobalAction?.({ kind: 'copy-last-block' });
    await host.dispatchGlobalAction?.({ kind: 'spawn-terminal-modal' });
    await host.dispatchGlobalAction?.({ kind: 'copy-log-pane' });

    expect(calls).toEqual([
      'resize:5:keep',
      'redraw',
      'prompt:repaint',
      'zoom',
      'redraw',
      'prompt:repaint',
      'goto',
      'redraw',
      'prompt:repaint',
      'copy-last',
      'redraw',
      'prompt:repaint',
      'spawn-terminal',
      'redraw',
      'prompt:repaint',
      'copy-log',
      'redraw',
      'prompt:repaint',
    ]);
  });
});
