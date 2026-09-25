// MD5 — PaneContent.onMouse interface tests.
//
// Terminal pane forwards non-double-click events to the PTY via
// `preview.forwardMouse`. Synthetic `double-click` is dropped (the
// PTY protocol has no representation for it). Other content types
// omit the handler entirely — the interface is optional.

import { describe, expect, test } from 'bun:test';
import { createMarkdownPaneContent, createScratchPaneContent, createTerminalPaneContent } from '../src/virtual-windows/pane-content.js';

describe('MD5 — PaneContent.onMouse', () => {
  test('markdown pane has no onMouse (optional)', () => {
    const md = createMarkdownPaneContent(
      { kind: 'markdown', title: 'm', text: 'hello' },
      {},
    );
    expect(md.onMouse).toBeUndefined();
  });

  test('scratch pane has no onMouse', () => {
    const sc = createScratchPaneContent(
      { kind: 'scratch', title: 's', initialText: '' },
      {},
    );
    expect(sc.onMouse).toBeUndefined();
  });

  test('terminal pane has onMouse and drops non-PTY synthetic mouse events', () => {
    const calls: Array<unknown> = [];
    const intents: Array<unknown> = [];
    // Stub preview-terminal factory so we don't spawn a real PTY.
    const stubTerm = {
      alive: true,
      cols: 80,
      rows: 24,
      forwardMouse: (ev: unknown) => { calls.push(ev); },
      resize() {},
      render() { return ''; },
      start() {},
      stop() {},
      write() {},
      get isAlive() { return true; },
    } as any;
    const tpane = createTerminalPaneContent(
      { kind: 'terminal', cmd: undefined, cwd: '/tmp' },
      {
        terminalFactory: () => stubTerm,
        spawn: (() => ({})) as any,
        onTerminalMouseIntent: (ev, meta) => intents.push({ type: ev.type, paneId: meta.paneId, paneKind: meta.paneKind }),
      },
    );
    expect(typeof tpane.onMouse).toBe('function');

    // double-click should be dropped
    const a = tpane.onMouse!({ type: 'double-click', row: 1, col: 2 });
    expect(a.type).toBe('none');
    expect(calls.length).toBe(0);

    // motion should also be dropped
    const motion = tpane.onMouse!({ type: 'motion', row: 1, col: 2 });
    expect(motion.type).toBe('none');
    expect(calls.length).toBe(0);
    expect(intents).toEqual([
      { type: 'double-click', paneId: tpane.id, paneKind: 'terminal' },
      { type: 'motion', paneId: tpane.id, paneKind: 'terminal' },
    ]);

    // single click forwards to PTY
    const b = tpane.onMouse!({ type: 'click', row: 1, col: 2 });
    expect(b.type).toBe('refresh');
    expect(calls.length).toBe(1);

    // scroll forwards
    tpane.onMouse!({ type: 'scroll-up', row: 1, col: 2 });
    expect(calls.length).toBe(2);
  });

  // PR-1 — caller-injected posture replaces the legacy hard-coded
  // `interactiveTerminalExposure()` in mouse intent meta.
  test('terminal pane uses resolveTerminalPanePosture when supplied', () => {
    const intents: Array<{ exposure: { userExposure: string }; interactionPolicy: { mouseTransport: string } }> = [];
    const stubTerm = {
      alive: true,
      cols: 80,
      rows: 24,
      forwardMouse() {},
      resize() {},
      render() { return ''; },
      start() {},
      stop() {},
      write() {},
      get isAlive() { return true; },
    } as any;
    const tpane = createTerminalPaneContent(
      { kind: 'terminal', cmd: undefined, cwd: '/tmp' },
      {
        terminalFactory: () => stubTerm,
        spawn: (() => ({})) as any,
        onTerminalMouseIntent: (_ev, meta) => intents.push({
          exposure: meta.exposure,
          interactionPolicy: meta.interactionPolicy,
        }),
        // Supply observe-only posture — pane should publish that, not
        // the legacy interactive default.
        resolveTerminalPanePosture: () => ({
          userExposure: 'observe-only',
          agentInteractive: true,
        }),
      },
    );
    tpane.onMouse!({ type: 'click', row: 1, col: 2 });
    expect(intents.length).toBe(1);
    expect(intents[0].exposure.userExposure).toBe('observe-only');
    expect(intents[0].interactionPolicy.mouseTransport).toBe('discrete-only');
  });

  test('terminal pane falls back to interactive when resolver returns null', () => {
    const intents: Array<{ exposure: { userExposure: string } }> = [];
    const stubTerm = {
      alive: true,
      cols: 80,
      rows: 24,
      forwardMouse() {},
      resize() {},
      render() { return ''; },
      start() {},
      stop() {},
      write() {},
      get isAlive() { return true; },
    } as any;
    const tpane = createTerminalPaneContent(
      { kind: 'terminal', cmd: undefined, cwd: '/tmp' },
      {
        terminalFactory: () => stubTerm,
        spawn: (() => ({})) as any,
        onTerminalMouseIntent: (_ev, meta) => intents.push({ exposure: meta.exposure }),
        resolveTerminalPanePosture: () => null,
      },
    );
    tpane.onMouse!({ type: 'click', row: 1, col: 2 });
    expect(intents[0].exposure.userExposure).toBe('user-interactive');
  });
});
