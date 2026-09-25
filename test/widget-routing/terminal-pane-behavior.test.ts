// ── VW-term-infra W2 — TerminalPaneBehavior Widget mixin tests ──
//
// Exercise the Widget<TerminalPaneState> contract produced by
// createTerminalPaneWidget() and the PaneDispatchResult → Action
// mapping.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §5 (W2 · C6)

import { describe, expect, test } from 'bun:test';

import { TerminalPane } from '../../src/panes/terminal-pane.js';
import type { PaneRef, PaneDispatchResult } from '../../src/panes/types.js';
import type { PreviewTerminal } from '../../src/preview/terminal.js';
import type { TerminalInstance } from '../../src/terminal-matrix/types.js';
import {
  createTerminalPaneWidget,
  paneDispatchToAction,
} from '../../src/widget-routing/terminal-pane-behavior.js';

function fakePreview(): PreviewTerminal {
  return {
    start: () => {},
    stop: () => {},
    write: () => {},
    resize: () => {},
    render: () => 'pretty-frame',
    cursorPosition: () => ({ row: 0, col: 0 }),
    addRawOutputTap: () => () => {},
    get isAlive() { return true; },
    get cols() { return 80; },
    get rows() { return 24; },
    get pid() { return 1 as number; },
  } as unknown as PreviewTerminal;
}

function fakeInstance(): TerminalInstance {
  return {
    id: 'term:w2',
    title: 'w2-term',
    character: { kind: 'shell' },
    transport: { kind: 'local' },
    pty: fakePreview(),
    placement: { kind: 'modal', modalId: 'w2' },
    readOnly: false,
    visibility: 'both',
    broadcastGroups: new Set(),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    exitCode: null,
    attentionLevel: 0,
    metadata: {},
  } as unknown as TerminalInstance;
}

function makeRef(): PaneRef {
  return { windowId: 'w', paneId: 'p-mixin' };
}

describe('W2 · createTerminalPaneWidget', () => {
  test('returns Widget with type pane:terminal + substrate description', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    const widget = createTerminalPaneWidget(pane);
    expect(widget.type).toBe('pane:terminal');
    expect(widget.description).toContain('substrate-backed');
  });

  test('initialState carries paneRef + terminalId', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    const widget = createTerminalPaneWidget(pane);
    const state = widget.initialState();
    expect(state.paneRef.paneId).toBe('p-mixin');
    expect(state.terminalId).toBe('term:w2');
  });

  test('render produces headline + summary within ctx.height', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    const widget = createTerminalPaneWidget(pane);
    const state = widget.initialState();
    const lines = widget.render(state, {
      width: 80, height: 5, focused: false,
    }, 'T');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('w2-term');
    expect(lines[1]).toContain('terminal term:w2');
  });

  test('render collapses to headline only when height=1', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    const widget = createTerminalPaneWidget(pane);
    const lines = widget.render(widget.initialState(), {
      width: 80, height: 1, focused: false,
    }, 'T');
    expect(lines.length).toBe(1);
  });

  test('onKey delegates to pane.onKey and maps to Action', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    // Stub pane.onKey to return 'consumed'.
    (pane as any).onKey = () => 'consumed' as PaneDispatchResult;
    const widget = createTerminalPaneWidget(pane);
    const action = widget.onKey!({ name: 'enter' }, widget.initialState(), {} as any);
    expect(action.type).toBe('refresh');
  });

  test('Widget mixin does NOT double-mount the pane', () => {
    const pane = new TerminalPane(makeRef(), fakeInstance());
    const widget = createTerminalPaneWidget(pane);
    // mount hook is intentionally a no-op — widget-host calls it but
    // VW composer owns the real lifecycle.
    widget.onMount!(widget.initialState(), {} as any);
    widget.onUnmount!(widget.initialState(), {} as any);
    // No throw — pane.mounted stays false (never touched by mixin).
    expect((pane as any).mounted).toBe(false);
  });
});

describe('W2 · paneDispatchToAction mapping', () => {
  test('consumed → refresh', () => {
    expect(paneDispatchToAction('consumed').type).toBe('refresh');
  });
  test('passthrough → none', () => {
    expect(paneDispatchToAction('passthrough').type).toBe('none');
  });
  test('quit → deactivate', () => {
    expect(paneDispatchToAction('quit').type).toBe('deactivate');
  });
  test('async result collapses to none (Phase 1 sync contract)', () => {
    const promise: Promise<PaneDispatchResult> = Promise.resolve('consumed');
    expect(paneDispatchToAction(promise).type).toBe('none');
  });
});
