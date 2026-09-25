// ── VW-term-infra W1 — PaneFactory + PaneContentAdapter tests ──
//
// Verify the factory's 5 resolve paths + cache behavior + legacy
// PaneContent adapter. Real dashboard integration is deferred per
// LESSONS L5 (high-risk); this file exercises the factory in
// isolation with fakes so the substrate consumers (capture engine
// etc.) have a proven API.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §6 (W1 · C7+C8)

import { describe, expect, test } from 'bun:test';

import {
  PaneFactory,
  PaneContentAdapter,
  PlaceholderPane,
  TerminalPane,
  ExternalTerminalPane,
  WidgetPane,
  type Pane,
  type PaneRef,
} from '../../src/panes/index.js';
import type { PaneContent, PaneEventKind, PaneUnsubscribe } from '../../src/virtual-windows/pane-content.js';
import type { PreviewTerminal } from '../../src/preview/terminal.js';
import type { ShellHandle } from '../../src/shell-runner/types.js';
import type { TerminalInstance } from '../../src/terminal-matrix/types.js';
import type { Widget, WidgetInstance } from '../../src/widgets/types.js';

// ── Fakes ──────────────────────────────────────────────────────

function makeFakeContent(kind: 'terminal' | 'markdown' | 'scratch' = 'markdown'): PaneContent {
  const subs: Record<string, Set<(p?: unknown) => void>> = {};
  const content: any = {
    id: `pc-${kind}` as string,
    kind,
    title: `content-${kind}`,
    start: () => {},
    stop: () => {},
    render: () => 'rendered',
    onKey: () => ({ type: 'none' as const }),
    write: () => {},
    capture: () => `text from ${kind}`,
    get isAlive() { return true; },
    on(ev: PaneEventKind, cb: (p?: unknown) => void): PaneUnsubscribe {
      (subs[ev] ??= new Set()).add(cb);
      return () => { subs[ev]?.delete(cb); };
    },
    dispose: () => {},
    __emit(ev: PaneEventKind, payload?: unknown) {
      for (const cb of subs[ev] ?? []) try { cb(payload); } catch {}
    },
  };
  return content as PaneContent;
}

function makeFakePreview(): PreviewTerminal {
  return {
    start: () => {}, stop: () => {}, write: () => {}, resize: () => {},
    render: () => 'x', cursorPosition: () => ({ row: 0, col: 0 }),
    addRawOutputTap: () => () => {},
    get isAlive() { return true; },
    get cols() { return 80; }, get rows() { return 24; }, get pid() { return 1; },
  } as unknown as PreviewTerminal;
}

function makeFakeTerminal(id: string): TerminalInstance {
  return {
    id,
    title: `t-${id}`,
    character: { kind: 'shell' },
    transport: { kind: 'local' },
    pty: makeFakePreview(),
    placement: { kind: 'modal', modalId: 'x' },
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

function makeFakeHandle(id: string): ShellHandle {
  return {
    id,
    terminalId: 'x',
    mode: 'vw',
    get status() { return 'running' as const; },
    bookmark: { row: 0, col: 0, ts: 0, bytes: 0 },
    kill: () => {}, background: () => false, promote: () => false,
    write: () => {}, resize: () => {},
    onChunk: () => () => {}, onBoundary: () => () => {}, onStatus: () => () => {},
    result: new Promise(() => {}),
  } as unknown as ShellHandle;
}

function makeFakeWidget(): { instance: WidgetInstance; def: Widget } {
  return {
    instance: { id: 'w1', type: 'x', character: 'F', state: {} },
    def: {
      type: 'x',
      description: 'x',
      initialState: () => ({}),
      render: () => [''],
    } as unknown as Widget,
  };
}

function makeRef(id: string): PaneRef {
  return { windowId: 'w', paneId: id };
}

// ── PaneFactory ────────────────────────────────────────────────

describe('W1 · PaneFactory resolve paths', () => {
  test('resolveFromContent returns PaneContentAdapter', () => {
    const f = new PaneFactory();
    const pane = f.resolveFromContent(makeRef('c1'), makeFakeContent('markdown'));
    expect(pane).toBeInstanceOf(PaneContentAdapter);
    expect(pane.kind.kind).toBe('widget');
  });

  test('resolveFromContent maps terminal kinds to substrate terminal', () => {
    const f = new PaneFactory();
    const pane = f.resolveFromContent(makeRef('c2'), makeFakeContent('terminal'));
    expect(pane.kind.kind).toBe('terminal');
  });

  test('resolveFromTerminal returns TerminalPane', () => {
    const f = new PaneFactory();
    const pane = f.resolveFromTerminal(makeRef('t1'), makeFakeTerminal('term:1'));
    expect(pane).toBeInstanceOf(TerminalPane);
  });

  test('resolveFromHandle returns ExternalTerminalPane', () => {
    const f = new PaneFactory();
    const pane = f.resolveFromHandle(makeRef('e1'), makeFakeHandle('sh:1'));
    expect(pane).toBeInstanceOf(ExternalTerminalPane);
  });

  test('resolveFromWidget returns WidgetPane', () => {
    const f = new PaneFactory();
    const fw = makeFakeWidget();
    const pane = f.resolveFromWidget(makeRef('w1'), fw.instance, fw.def);
    expect(pane).toBeInstanceOf(WidgetPane);
  });

  test('resolvePlaceholder returns PlaceholderPane', () => {
    const f = new PaneFactory();
    const pane = f.resolvePlaceholder(makeRef('p1'), 'loading');
    expect(pane).toBeInstanceOf(PlaceholderPane);
  });
});

describe('W1 · PaneFactory cache', () => {
  test('same ref + same content returns cached instance', () => {
    const f = new PaneFactory();
    const ref = makeRef('cached');
    const content = makeFakeContent();
    const a = f.resolveFromContent(ref, content);
    const b = f.resolveFromContent(ref, content);
    expect(a).toBe(b);
  });

  test('cache size tracks unique refs', () => {
    const f = new PaneFactory();
    f.resolveFromContent(makeRef('a'), makeFakeContent());
    f.resolveFromContent(makeRef('b'), makeFakeContent());
    expect(f.cacheSize).toBe(2);
  });

  test('peek returns cached pane without creating', () => {
    const f = new PaneFactory();
    const ref = makeRef('peeky');
    expect(f.peek(ref)).toBeUndefined();
    const pane = f.resolveFromContent(ref, makeFakeContent());
    expect(f.peek(ref)).toBe(pane);
  });

  test('invalidate drops the cached pane', () => {
    const f = new PaneFactory();
    const ref = makeRef('gone');
    f.resolveFromContent(ref, makeFakeContent());
    expect(f.peek(ref)).toBeDefined();
    f.invalidate(ref);
    expect(f.peek(ref)).toBeUndefined();
  });

  test('reset clears the whole cache', () => {
    const f = new PaneFactory();
    f.resolveFromContent(makeRef('a'), makeFakeContent());
    f.resolveFromContent(makeRef('b'), makeFakeContent());
    f.reset();
    expect(f.cacheSize).toBe(0);
  });

  test('resolveFromContent skips cache when prior pane was placeholder', () => {
    const f = new PaneFactory();
    const ref = makeRef('upgrade');
    const pl = f.resolvePlaceholder(ref, 'loading');
    expect(pl.kind.kind).toBe('placeholder');
    const real = f.resolveFromContent(ref, makeFakeContent());
    expect(real).not.toBe(pl);
    expect(real.kind.kind).not.toBe('placeholder');
  });
});

// ── PaneContentAdapter ────────────────────────────────────────

describe('W1 · PaneContentAdapter snapshot + tap', () => {
  test('snapshot returns text from PaneContent.capture()', async () => {
    const adapter = new PaneContentAdapter(makeRef('s1'), makeFakeContent('markdown'));
    const snap = await adapter.snapshot();
    expect(snap.text).toBe('text from markdown');
    expect(snap.meta.title).toBe('content-markdown');
  });

  test("event tap forwards PaneContent 'update' events", async () => {
    const content = makeFakeContent('scratch') as any;
    const adapter = new PaneContentAdapter(makeRef('s2'), content as PaneContent);
    adapter.mount({ bounds: { row: 0, col: 0, width: 40, height: 5 }, onUnmount: () => {} });
    const events: any[] = [];
    const off = adapter.addTap('event', (e) => events.push(e));
    content.__emit('update');
    await new Promise((r) => setTimeout(r, 5));
    off();
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('widget-state');
  });

  test("event tap forwards PaneContent 'exit' events with code", async () => {
    const content = makeFakeContent('terminal') as any;
    const adapter = new PaneContentAdapter(makeRef('s3'), content as PaneContent);
    adapter.mount({ bounds: { row: 0, col: 0, width: 40, height: 5 }, onUnmount: () => {} });
    const events: any[] = [];
    const off = adapter.addTap('event', (e) => events.push(e));
    content.__emit('exit', 42);
    await new Promise((r) => setTimeout(r, 5));
    off();
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('exit');
    expect(events[0].code).toBe(42);
  });

  test('supportedTaps advertises event only', () => {
    const adapter = new PaneContentAdapter(makeRef('s4'), makeFakeContent());
    expect(adapter.describe().supportedTaps).toEqual(['event']);
  });

  test('raw/frame taps throw PaneTapNotSupportedError', () => {
    const adapter = new PaneContentAdapter(makeRef('s5'), makeFakeContent());
    expect(() => adapter.addTap('raw', () => {})).toThrow();
    expect(() => adapter.addTap('frame', () => {})).toThrow();
  });
});
