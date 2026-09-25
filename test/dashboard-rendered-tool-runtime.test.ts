import { describe, expect, test } from 'bun:test';

import { FoldStack } from '../src/fold-stack.js';
import { createDashboardRenderedToolRuntime } from '../src/dashboard/rendered-tool-runtime.js';

describe('createDashboardRenderedToolRuntime', () => {
  test('stores args and appends new rendered blocks', () => {
    const chatLines: string[] = [];
    const foldStack = new FoldStack({ chatLines });
    const events: string[] = [];
    const runtime = createDashboardRenderedToolRuntime({
      chatLines,
      foldStack,
      pinChatTail: () => { events.push('pin'); },
      draw: () => { events.push('draw'); },
    });

    runtime.setArgs('call-1', { q: 1 });
    const next = runtime.replaceBlock('call-1', ['line-1'], 0);

    expect(runtime.getArgs('call-1')).toEqual({ q: 1 });
    expect(chatLines).toEqual(['line-1']);
    expect(next).toBe(1);
    expect(events).toEqual(['pin', 'draw']);
  });

  test('shifts later fold ranges when an earlier block grows', () => {
    const chatLines: string[] = [];
    const foldStack = new FoldStack({ chatLines });
    const runtime = createDashboardRenderedToolRuntime({
      chatLines,
      foldStack,
      pinChatTail: () => {},
      draw: () => {},
    });

    let assistantStart = runtime.replaceBlock('call-1', ['a'], 0);
    assistantStart = runtime.replaceBlock('call-2', ['b'], assistantStart);
    runtime.registerFold('call-2', ['b'], ['b', 'b2']);

    assistantStart = runtime.replaceBlock('call-1', ['a', 'a2'], assistantStart);
    expect(assistantStart).toBe(2);
    expect(chatLines).toEqual(['a', 'a2', 'b']);

    expect(foldStack.toggleTop()).toBe(true);
    expect(chatLines).toEqual(['a', 'a2', 'b', 'b2']);
  });

  test('clears args after result consumption', () => {
    const runtime = createDashboardRenderedToolRuntime({
      chatLines: [],
      foldStack: new FoldStack({ chatLines: [] }),
      pinChatTail: () => {},
      draw: () => {},
    });

    runtime.setArgs('call-1', { q: 1 });
    runtime.deleteArgs('call-1');

    expect(runtime.getArgs('call-1')).toBeUndefined();
  });
});
