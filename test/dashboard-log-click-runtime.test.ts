import { describe, expect, spyOn, test } from 'bun:test';

import { addAttachment, createContextRegistry, type Attachment } from '../src/context.js';
import { debug } from '../src/debug/log.js';
import { FoldStack } from '../src/fold-stack.js';
import { createAttachmentRowMap } from '../src/log-pane/attachment-row-map.js';
import { createDashboardLogClickDeps } from '../src/dashboard/log-click-runtime.js';
import { tryAttachmentHitAtBodyRow } from '../src/log-pane/click-dispatch.js';

type FoldLog = {
  event: string;
  lineIndex?: unknown;
  reason?: unknown;
  lineStart?: unknown;
  lineEnd?: unknown;
  candidates?: unknown;
  truncated?: unknown;
};

function collectFoldLogs(): { logs: FoldLog[]; restore: () => void } {
  const logs: FoldLog[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'log.fold') {
      logs.push({
        event,
        lineIndex: data?.lineIndex,
        reason: data?.reason,
        lineStart: data?.lineStart,
        lineEnd: data?.lineEnd,
        candidates: data?.candidates,
        truncated: data?.truncated,
      });
    }
  }) as typeof debug.log);
  return { logs, restore: () => spy.mockRestore() };
}

describe('createDashboardLogClickDeps', () => {
  test('chains popup handle disposal into the typed modal handle', () => {
    let modalDisposed = 0;
    let viewDisposed = 0;
    const events: string[] = [];
    const deps = createDashboardLogClickDeps({
      termSize: () => ({ rows: 20, cols: 80 }),
      computePaneH: () => 5,
      computeLogH: () => 10,
      chatLinesLength: () => 0,
      chatScrollOffset: () => -1,
      logFrozenTailIndex: () => null,
      chatFooterLine: () => null,
      attachmentRowMap: createAttachmentRowMap(),
      contextRegistry: createContextRegistry(),
      setWorkingFocus: () => {},
      pushTypedModal: (_typeName, _opts, surface) => {
        events.push(`push:${surface.id}`);
        return {
          generation: 3,
          isDisposed: () => modalDisposed > 0,
          dispose: () => { modalDisposed += 1; },
        };
      },
      onPushRejected: () => { events.push('rejected'); },
      onPushAccepted: (surfaceId, generation) => { events.push(`accepted:${surfaceId}:${generation}`); },
      onAttachmentAction: () => {},
      draw: () => {},
      debug: { enabled: false, log: () => {} },
    });

    const handle = {
      surface: { id: 'popup-1' },
      dispose: () => { viewDisposed += 1; },
    } as any;
    deps.pushModal(handle);
    handle.dispose();

    expect(events).toEqual(['push:popup-1', 'accepted:popup-1:3']);
    expect(viewDisposed).toBe(1);
    expect(modalDisposed).toBe(1);
  });

  test('forwards attachment actions unchanged', () => {
    const events: string[] = [];
    const attachment = {
      id: 4,
      token: '[PDF #4]',
      kind: 'pdf',
      sourcePath: '/tmp/a.pdf',
      filename: 'a.pdf',
      sizeBytes: 10,
      mtime: 1,
    } as Attachment;
    const deps = createDashboardLogClickDeps({
      termSize: () => ({ rows: 20, cols: 80 }),
      computePaneH: () => 5,
      computeLogH: () => 10,
      chatLinesLength: () => 0,
      chatScrollOffset: () => -1,
      logFrozenTailIndex: () => null,
      chatFooterLine: () => null,
      attachmentRowMap: createAttachmentRowMap(),
      contextRegistry: createContextRegistry(),
      setWorkingFocus: () => {},
      pushTypedModal: () => null,
      onAttachmentAction: (action, nextAttachment) => {
        events.push(`${action}:${nextAttachment.token}`);
      },
      draw: () => {},
      debug: { enabled: false, log: () => {} },
    });

    deps.onAttachmentAction('copy-token', attachment);
    expect(events).toEqual(['copy-token:[PDF #4]']);
  });

  function makeRuntimeBase(overrides: {
    foldStack?: FoldStack;
    draw?: () => void;
    chatLinesLength?: () => number;
  } = {}) {
    return createDashboardLogClickDeps({
      termSize: () => ({ rows: 40, cols: 120 }),
      computePaneH: () => 20,
      computeLogH: () => 18,
      chatLinesLength: overrides.chatLinesLength ?? (() => 100),
      chatScrollOffset: () => 0,
      logFrozenTailIndex: () => null,
      chatFooterLine: () => null,
      attachmentRowMap: createAttachmentRowMap(),
      contextRegistry: createContextRegistry(),
      setWorkingFocus: () => {},
      pushTypedModal: () => null,
      onAttachmentAction: () => {},
      draw: overrides.draw ?? (() => {}),
      debug: { enabled: false, log: () => {} },
      ...(overrides.foldStack ? { foldStack: overrides.foldStack } : {}),
    });
  }

  test('omitted FoldStack leaves tryFoldToggle unset (legacy)', () => {
    const deps = makeRuntimeBase();
    expect(deps.tryFoldToggle).toBeUndefined();
    const result = tryAttachmentHitAtBodyRow(1, { row: 23, col: 4 }, deps);
    expect(result).toBe('no-attachment');
  });

  test('click inside a collapsed range expands it and draws', () => {
    const chatLines = ['a', 'b', 'c'];
    const foldStack = new FoldStack({ chatLines });
    foldStack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2', 'c'] : ['b', 'c'],
    });
    let draws = 0;
    const deps = makeRuntimeBase({
      foldStack,
      draw: () => { draws++; },
      chatLinesLength: () => chatLines.length,
    });
    const { logs, restore } = collectFoldLogs();
    try {
      const result = tryAttachmentHitAtBodyRow(1, { row: 23, col: 4 }, deps);
      expect(result).toBe('popup-opened');
      expect(chatLines).toEqual(['a', 'b', 'b2', 'c']);
      expect(foldStack.snapshot()[0]?.expanded).toBe(true);
      expect(draws).toBe(1);
      expect(logs.filter((entry) => entry.event === 'expanded-body-reject')).toEqual([]);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test('click on the first line of an expanded range collapses it and draws', () => {
    const chatLines = ['a', 'b', 'c'];
    const foldStack = new FoldStack({ chatLines });
    foldStack.push({
      kind: 'static',
      expanded: true,
      lineStart: 0,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['a', 'b', 'c'] : ['a'],
    });
    let draws = 0;
    const deps = makeRuntimeBase({
      foldStack,
      draw: () => { draws++; },
      chatLinesLength: () => chatLines.length,
    });
    const { logs, restore } = collectFoldLogs();
    try {
      const result = tryAttachmentHitAtBodyRow(0, { row: 22, col: 4 }, deps);
      expect(result).toBe('popup-opened');
      expect(chatLines).toEqual(['a']);
      expect(foldStack.snapshot()[0]?.expanded).toBe(false);
      expect(draws).toBe(1);
      expect(logs.filter((entry) => entry.event === 'expanded-body-reject')).toEqual([]);
      expect(logs.filter((entry) => entry.event === 'fold-recollapsed')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test('click on a non-first line of an expanded range preserves it and does not draw', () => {
    const chatLines = ['a', 'b', 'c'];
    const foldStack = new FoldStack({ chatLines });
    foldStack.push({
      kind: 'static',
      expanded: true,
      lineStart: 0,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['a', 'b', 'c'] : ['a'],
    });
    let draws = 0;
    const deps = makeRuntimeBase({
      foldStack,
      draw: () => { draws++; },
      chatLinesLength: () => chatLines.length,
    });
    const { logs, restore } = collectFoldLogs();
    try {
      const before = chatLines.slice();
      const result = tryAttachmentHitAtBodyRow(1, { row: 23, col: 4 }, deps);
      expect(result).toBe('no-attachment');
      expect(chatLines).toEqual(before);
      expect(foldStack.snapshot()[0]?.expanded).toBe(true);
      expect(draws).toBe(0);
      const rejects = logs.filter((entry) => entry.event === 'expanded-body-reject');
      expect(rejects).toEqual([
        {
          event: 'expanded-body-reject',
          lineIndex: 1,
          reason: 'expanded-body',
          lineStart: 0,
          lineEnd: 3,
          candidates: undefined,
          truncated: undefined,
        },
      ]);
      expect(rejects[0]?.reason).not.toBe('no-containing-fold');
      expect(logs.filter((entry) => entry.event === 'toggle-at-line-miss')).toEqual([]);
    } finally {
      restore();
    }
  });

  test('attachment on a folded line wins; fold does not toggle', () => {
    const chatLines = ['a', 'b', 'c', 'd'];
    const foldStack = new FoldStack({ chatLines });
    foldStack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 4,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2', 'c', 'd'] : ['b', 'c', 'd'],
    });
    const attachmentRowMap = createAttachmentRowMap();
    const contextRegistry = createContextRegistry();
    const attachment = addAttachment(contextRegistry, {
      kind: 'md',
      sourcePath: '/tmp/test.md',
      filename: 'test.md',
      sizeBytes: 1024,
      mtime: Date.now(),
    });
    attachmentRowMap.track(1, attachment.id);
    let draws = 0;
    const deps = createDashboardLogClickDeps({
      termSize: () => ({ rows: 40, cols: 120 }),
      computePaneH: () => 20,
      computeLogH: () => 18,
      chatLinesLength: () => chatLines.length,
      chatScrollOffset: () => 0,
      logFrozenTailIndex: () => null,
      chatFooterLine: () => null,
      attachmentRowMap,
      contextRegistry,
      setWorkingFocus: () => {},
      pushTypedModal: () => ({
        generation: 1,
        isDisposed: () => false,
        dispose: () => {},
      }),
      onAttachmentAction: () => {},
      draw: () => { draws++; },
      debug: { enabled: false, log: () => {} },
      foldStack,
    });
    const before = chatLines.slice();
    const result = tryAttachmentHitAtBodyRow(1, { row: 23, col: 4 }, deps);
    expect(result).toBe('popup-opened');
    expect(chatLines).toEqual(before);
    expect(foldStack.snapshot()[0]?.expanded).toBe(false);
    expect(draws).toBe(0);
  });

  test('click outside every range is a no-op false and does not draw', () => {
    const chatLines = ['a', 'b', 'c'];
    const foldStack = new FoldStack({ chatLines });
    foldStack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
    });
    let draws = 0;
    const deps = makeRuntimeBase({
      foldStack,
      draw: () => { draws++; },
      chatLinesLength: () => chatLines.length,
    });
    const { logs, restore } = collectFoldLogs();
    try {
      const before = chatLines.slice();
      const result = tryAttachmentHitAtBodyRow(2, { row: 24, col: 4 }, deps);
      expect(result).toBe('no-attachment');
      expect(chatLines).toEqual(before);
      expect(draws).toBe(0);
      expect(logs.filter((entry) => entry.event === 'expanded-body-reject')).toEqual([]);
      const misses = logs.filter((entry) => entry.event === 'toggle-at-line-miss');
      expect(misses).toHaveLength(1);
      expect(misses[0]?.lineIndex).toBe(2);
    } finally {
      restore();
    }
  });
});
