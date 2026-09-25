// WT-S-3 — WebTerminalPane contract + factory integration.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  WebTerminalPane,
  webTerminalPaneRef,
  type WebTerminalPaneOpts,
} from '../../src/panes/web-terminal-pane';
import {
  PaneFactory,
  __setDefaultPaneFactory,
  getDefaultPaneFactory,
} from '../../src/panes/factory';
import type { PreviewTerminal, TerminalEvent } from '../../src/preview/terminal';
import type { PaneRef } from '../../src/panes/types';

interface FakePT {
  cols: number;
  rows: number;
  addRawOutputTap: (cb: (chunk: string) => void) => () => void;
  addEventTap: (cb: (ev: TerminalEvent) => void) => () => void;
  render: (alt: boolean) => string;
  cursorPosition: () => { row: number; col: number } | null;
  emit: (chunk: string) => void;
  emitEvent: (ev: TerminalEvent) => void;
}

function fakePty(opts: Partial<{ cols: number; rows: number; rendered: string; cursor: { row: number; col: number } | null }> = {}): FakePT {
  const rawCbs = new Set<(c: string) => void>();
  const evtCbs = new Set<(e: TerminalEvent) => void>();
  return {
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    addRawOutputTap(cb) {
      rawCbs.add(cb);
      return () => { rawCbs.delete(cb); };
    },
    addEventTap(cb) {
      evtCbs.add(cb);
      return () => { evtCbs.delete(cb); };
    },
    render(_alt) { return opts.rendered ?? 'rendered ansi text'; },
    cursorPosition() { return opts.cursor === undefined ? { row: 0, col: 0 } : opts.cursor; },
    emit(chunk) { for (const cb of rawCbs) cb(chunk); },
    emitEvent(ev) { for (const cb of evtCbs) cb(ev); },
  };
}

function buildOpts(pty: FakePT, overrides: Partial<WebTerminalPaneOpts> = {}): WebTerminalPaneOpts {
  return {
    sessionId: 's1',
    terminalId: 'preview-1',
    pty: pty as unknown as PreviewTerminal,
    ...overrides,
  };
}

const ref: PaneRef = { windowId: 'web', paneId: 'webterm-preview-1' };

afterEach(() => {
  // Reset the default factory between tests so cache state is fresh.
  __setDefaultPaneFactory(null as unknown as PaneFactory);
});

describe('WebTerminalPane · basic shape', () => {
  test('kind discriminator carries sessionId + terminalId', () => {
    const pane = new WebTerminalPane(ref, buildOpts(fakePty()));
    expect(pane.kind).toEqual({
      kind: 'web-terminal', sessionId: 's1', terminalId: 'preview-1',
    });
  });

  test('describe() returns title + summary + supportedTaps', () => {
    const pane = new WebTerminalPane(ref, buildOpts(fakePty(), { title: 'My Term' }));
    const d = pane.describe();
    expect(d.title).toBe('My Term');
    expect(d.summary).toContain('preview-1');
    expect(d.summary).toContain('s1');
    expect(d.supportedTaps).toEqual(['raw', 'frame', 'event']);
  });

  test('default title is webterm-<terminalId> when none provided', () => {
    const pane = new WebTerminalPane(ref, buildOpts(fakePty()));
    expect(pane.describe().title).toBe('webterm-preview-1');
  });

  test('render returns ClickRegion with terminal kind', () => {
    const pane = new WebTerminalPane(ref, buildOpts(fakePty()));
    const regions = pane.render({ row: 0, col: 0, width: 80, height: 24 });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe('terminal');
    expect(regions[0]?.id).toContain('preview-1');
  });
});

describe('WebTerminalPane · snapshot', () => {
  test('ansi format returns rendered ANSI + cursor + title meta', async () => {
    const pty = fakePty({ rendered: 'ls -la\nfoo  bar', cursor: { row: 5, col: 12 } });
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    const snap = await pane.snapshot({ format: 'ansi' });
    expect(snap.ansi).toBe('ls -la\nfoo  bar');
    expect(snap.text).toBeUndefined();
    expect(snap.meta?.cursor).toEqual({ row: 5, col: 12 });
    expect(snap.meta?.title).toBe('webterm-preview-1');
    expect(snap.kind).toMatchObject({ kind: 'web-terminal' });
  });

  test('text format strips ANSI escapes', async () => {
    const pty = fakePty({ rendered: '\x1b[31mhello\x1b[0m world' });
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    const snap = await pane.snapshot({ format: 'text' });
    expect(snap.text).toBe('hello world');
    expect(snap.ansi).toBeUndefined();
  });

  test('cells format returns emptySnapshot (Phase 2b — not yet)', async () => {
    const pty = fakePty();
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    const snap = await pane.snapshot({ format: 'cells' });
    // emptySnapshot has no ansi/text — meta still populated by base
    expect(snap.ansi).toBeUndefined();
    expect(snap.text).toBeUndefined();
  });

  test('default format defaults to cells (empty)', async () => {
    const pty = fakePty();
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    const snap = await pane.snapshot();
    expect(snap.kind).toMatchObject({ kind: 'web-terminal' });
  });
});

describe('WebTerminalPane · taps', () => {
  test('raw tap forwards chunks with bytes + ts', () => {
    const pty = fakePty();
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    const seen: { bytes: string; ts: number }[] = [];
    const off = pane.addTap('raw', (c) => seen.push(c as { bytes: string; ts: number }));
    pty.emit('hello');
    pty.emit('world');
    expect(seen).toHaveLength(2);
    expect(seen[0]?.bytes).toBe('hello');
    expect(seen[1]?.bytes).toBe('world');
    expect(typeof seen[0]?.ts).toBe('number');
    off();
    pty.emit('after-off');
    expect(seen).toHaveLength(2);
  });

  test('event tap fans cursor / resize / title', () => {
    const pty = fakePty();
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    pane.mount({
      bounds: { row: 0, col: 0, width: 80, height: 24 },
      onUnmount: () => {},
    });
    const events: unknown[] = [];
    const off = pane.addTap('event', (e) => events.push(e));
    pty.emitEvent({ kind: 'cursor', row: 3, col: 7 });
    pty.emitEvent({ kind: 'resize', cols: 100, rows: 30 });
    pty.emitEvent({ kind: 'title', title: 'shell' });
    expect(events).toHaveLength(3);
    expect((events[0] as { kind: string }).kind).toBe('cursor');
    expect((events[1] as { kind: string }).kind).toBe('resize');
    expect((events[2] as { kind: string }).kind).toBe('title');
    off();
  });

  test('frame tap emits ANSI snapshots on interval (and stops on off)', async () => {
    const pty = fakePty({ rendered: 'frame-data' });
    const pane = new WebTerminalPane(ref, buildOpts(pty));
    pane.mount({
      bounds: { row: 0, col: 0, width: 80, height: 24 },
      onUnmount: () => {},
    });
    pane.render({ row: 0, col: 0, width: 80, height: 24 });
    const frames: { mime: string; bytes: string }[] = [];
    const off = pane.addTap('frame', (f) => frames.push(f as { mime: string; bytes: string }), {
      throttleMs: 20,
    });
    await new Promise((r) => setTimeout(r, 60));
    off();
    const collected = frames.length;
    expect(collected).toBeGreaterThan(0);
    expect(frames[0]?.mime).toBe('text/ansi');
    expect(frames[0]?.bytes).toBe('frame-data');
    // No new frames after off()
    await new Promise((r) => setTimeout(r, 40));
    expect(frames.length).toBe(collected);
  });
});

describe('PaneFactory · resolveFromWebTerminal', () => {
  test('caches the pane by ref + returns same instance on re-resolve', () => {
    const factory = new PaneFactory();
    const pty = fakePty();
    const opts = buildOpts(pty);
    const a = factory.resolveFromWebTerminal(ref, opts);
    const b = factory.resolveFromWebTerminal(ref, opts);
    expect(a).toBe(b);
    expect(factory.cacheSize).toBe(1);
  });

  test('peek() returns the resolved pane', () => {
    const factory = new PaneFactory();
    const pane = factory.resolveFromWebTerminal(ref, buildOpts(fakePty()));
    expect(factory.peek(ref)).toBe(pane);
  });

  test('peek() returns undefined for unknown ref', () => {
    const factory = new PaneFactory();
    expect(factory.peek({ windowId: 'web', paneId: 'webterm-other' })).toBeUndefined();
  });

  test('invalidate() drops the cached pane', () => {
    const factory = new PaneFactory();
    factory.resolveFromWebTerminal(ref, buildOpts(fakePty()));
    expect(factory.cacheSize).toBe(1);
    factory.invalidate(ref);
    expect(factory.cacheSize).toBe(0);
    expect(factory.peek(ref)).toBeUndefined();
  });

  test('changing terminalId for same ref creates a new pane (cache miss)', () => {
    const factory = new PaneFactory();
    const a = factory.resolveFromWebTerminal(ref, buildOpts(fakePty()));
    const b = factory.resolveFromWebTerminal(ref, buildOpts(fakePty(), { terminalId: 'preview-2' }));
    expect(a).not.toBe(b);
  });
});

describe('webTerminalPaneRef helper', () => {
  test('builds canonical ref shape', () => {
    expect(webTerminalPaneRef('preview-1')).toEqual({
      windowId: 'web', paneId: 'webterm-preview-1',
    });
  });
});

describe('preview-tap-registry · resolves through default factory', () => {
  test('registering a webterm makes peek() find a Pane', async () => {
    const factory = new PaneFactory();
    __setDefaultPaneFactory(factory);
    const { registerPreviewTerminalForWebTap, __resetPreviewTapRegistry } =
      await import('../../src/web-terminal/preview-tap-registry.js');
    const pty = fakePty();
    const handle = {
      notify: async () => {}, block: async () => {},
      showModal: async () => true, showToast: async () => true,
      updateStatusPill: async () => true,
      terminalOutput: async () => true, terminalExit: async () => true,
      terminalInputActivity: async () => true,
      uiCapabilities: () => ({ showModal: false, showToast: false, updateStatusPill: false, usage: false }),
      termCapabilities: () => ({ terminalOutput: true, terminalExit: true }),
      sessionIds: () => [],
    };
    registerPreviewTerminalForWebTap(pty as any, 's1', 'preview-1', handle as any);
    const looked = factory.peek(webTerminalPaneRef('preview-1'));
    expect(looked).toBeDefined();
    expect(looked?.kind).toMatchObject({ kind: 'web-terminal', terminalId: 'preview-1' });
    __resetPreviewTapRegistry();
  });

  test('unregistering invalidates the pane', async () => {
    const factory = new PaneFactory();
    __setDefaultPaneFactory(factory);
    const { registerPreviewTerminalForWebTap, unregisterPreviewTerminalForWebTap } =
      await import('../../src/web-terminal/preview-tap-registry.js');
    const pty = fakePty();
    const handle = {
      notify: async () => {}, block: async () => {},
      showModal: async () => true, showToast: async () => true,
      updateStatusPill: async () => true,
      terminalOutput: async () => true, terminalExit: async () => true,
      terminalInputActivity: async () => true,
      uiCapabilities: () => ({ showModal: false, showToast: false, updateStatusPill: false, usage: false }),
      termCapabilities: () => ({ terminalOutput: true, terminalExit: true }),
      sessionIds: () => [],
    };
    registerPreviewTerminalForWebTap(pty as any, 's1', 'preview-1', handle as any);
    expect(factory.peek(webTerminalPaneRef('preview-1'))).toBeDefined();
    unregisterPreviewTerminalForWebTap(pty as any);
    expect(factory.peek(webTerminalPaneRef('preview-1'))).toBeUndefined();
  });
});
