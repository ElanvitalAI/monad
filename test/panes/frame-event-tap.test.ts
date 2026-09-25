// ── VW-term-infra W3 — frame + event tap tests ──
//
// Exercise the addTap('frame') / addTap('event') implementations on
// TerminalPane / ExternalTerminalPane / WidgetPane + verify
// PaneTapNotSupportedError for unsupported (pane, kind) pairs.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §4
//      내부 문서 `CAPABILITIES-pane-substrate` §5

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  ExternalTerminalPane,
  PaneTapNotSupportedError,
  PlaceholderPane,
  TerminalPane,
  WidgetPane,
  type FrameChunk,
  type PaneContext,
  type PaneEvent,
  type PaneRef,
} from '../../src/panes/index.js';
import type { PreviewTerminal } from '../../src/preview/terminal.js';
import type { ShellHandle } from '../../src/shell-runner/types.js';
import type { TerminalInstance } from '../../src/terminal-matrix/types.js';
import type { Widget, WidgetInstance } from '../../src/widgets/types.js';

// ── Fakes ──────────────────────────────────────────────────────

function makeFakePreview(
  renderOutput: { value: string },
  eventEmitter?: { emit: ((ev: import('../../src/preview/terminal.js').TerminalEvent) => void) | null },
): PreviewTerminal {
  const taps = new Set<(ev: import('../../src/preview/terminal.js').TerminalEvent) => void>();
  if (eventEmitter) {
    eventEmitter.emit = (ev) => { for (const t of taps) t(ev); };
  }
  return {
    start: () => {},
    stop: () => {},
    write: () => {},
    resize: () => {},
    render: () => renderOutput.value,
    cursorPosition: () => ({ row: 0, col: 0 }),
    addRawOutputTap: (_cb: (c: string) => void) => () => {},
    addEventTap: (cb: (ev: import('../../src/preview/terminal.js').TerminalEvent) => void) => {
      taps.add(cb);
      return () => { taps.delete(cb); };
    },
    get isAlive() { return true; },
    get cols() { return 80; },
    get rows() { return 24; },
    get pid() { return 1; },
  } as unknown as PreviewTerminal;
}

function makeFakeTerminalInstance(pty: PreviewTerminal): TerminalInstance {
  return {
    id: 'term:fake',
    title: 'fake-term',
    character: { kind: 'shell' },
    transport: { kind: 'local' },
    pty,
    placement: { kind: 'modal', modalId: 'fake' },
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

function makeFakeShellHandle(emit: {
  chunkEmitter: ((b: { bytes: string; ts: number; stream: 'stdout' | 'stderr' }) => void) | null;
  boundaryEmitter?: ((b: { kind: 'prompt-start' | 'cmd-end'; exitCode?: number; source: 'exit' | 'osc-133' | 'quiet' | 'timeout'; at: number }) => void) | null;
  statusEmitter?: ((s: 'running' | 'backgrounded' | 'completed' | 'killed') => void) | null;
}): ShellHandle {
  return {
    id: 'sh:fake',
    terminalId: 'term:fake',
    mode: 'vw',
    get status() { return 'running' as const; },
    bookmark: { row: 0, col: 0, ts: 0, bytes: 0 },
    kill: () => {},
    background: () => false,
    promote: () => false,
    write: () => {},
    resize: () => {},
    onChunk: (cb: (c: { bytes: string; ts: number; stream: 'stdout' | 'stderr' }) => void) => {
      emit.chunkEmitter = cb;
      return () => { emit.chunkEmitter = null; };
    },
    onBoundary: (cb: (b: any) => void) => {
      emit.boundaryEmitter = cb;
      return () => { emit.boundaryEmitter = null; };
    },
    onStatus: (cb: (s: any) => void) => {
      emit.statusEmitter = cb;
      return () => { emit.statusEmitter = null; };
    },
    result: new Promise(() => {}),
  } as unknown as ShellHandle;
}

function makeFakeWidget(): Widget {
  return {
    type: 'fake-widget',
    description: 'fake',
    initialState: () => ({ counter: 0 }),
    render: () => [''],
  } as unknown as Widget;
}

function makeRef(id: string): PaneRef {
  return { windowId: 'w', paneId: id };
}

function makeCtx(): PaneContext {
  return {
    bounds: { row: 0, col: 0, width: 80, height: 24 },
    onUnmount: () => {},
  };
}

// ── TerminalPane frame tap ─────────────────────────────────────

describe('W3 · TerminalPane frame tap', () => {
  test('emits FrameChunk at throttleMs intervals', async () => {
    const renderOutput = { value: 'frame-0' };
    const pty = makeFakePreview(renderOutput);
    const inst = makeFakeTerminalInstance(pty);
    const pane = new TerminalPane(makeRef('t1'), inst);
    pane.mount(makeCtx());

    const frames: FrameChunk[] = [];
    const off = pane.addTap('frame', (f) => {
      frames.push(f as FrameChunk);
    }, { throttleMs: 30 });

    renderOutput.value = 'frame-1';
    await new Promise((r) => setTimeout(r, 80));
    off();
    pane.unmount();

    // At 30ms throttle we expect ~2 frames in 80ms.
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]!.mime).toBe('text/ansi');
    expect(frames[0]!.dims.width).toBe(80);
    expect(typeof frames[0]!.ts).toBe('number');
  });

  test('Unsubscribe stops frame emission', async () => {
    const pty = makeFakePreview({ value: 'x' });
    const pane = new TerminalPane(makeRef('t2'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    let count = 0;
    const off = pane.addTap('frame', () => { count++; }, { throttleMs: 20 });
    await new Promise((r) => setTimeout(r, 50));
    off();
    const countAtUnsub = count;
    await new Promise((r) => setTimeout(r, 80));
    // No new callbacks after unsubscribe.
    expect(count).toBe(countAtUnsub);
    pane.unmount();
  });

  test('supportedTaps advertises raw + frame + event (W3-ext)', () => {
    const pane = new TerminalPane(makeRef('t3'), makeFakeTerminalInstance(makeFakePreview({ value: '' })));
    expect(pane.describe().supportedTaps).toContain('raw');
    expect(pane.describe().supportedTaps).toContain('frame');
    expect(pane.describe().supportedTaps).toContain('event');
  });
});

// ── TerminalPane event tap (W3-ext) ────────────────────────────

describe('W3-ext · TerminalPane event tap', () => {
  test('cursor event forwards row/col from PreviewTerminal', () => {
    const emitter = { emit: null as any };
    const pty = makeFakePreview({ value: '' }, emitter);
    const pane = new TerminalPane(makeRef('te1'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emitter.emit!({ kind: 'cursor', row: 5, col: 12 });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ kind: 'cursor', row: 5, col: 12 });

    off();
    pane.unmount();
  });

  test('resize event carries bounds-relative dims', () => {
    const emitter = { emit: null as any };
    const pty = makeFakePreview({ value: '' }, emitter);
    const pane = new TerminalPane(makeRef('te2'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emitter.emit!({ kind: 'resize', cols: 120, rows: 40 });
    expect(events.length).toBe(1);
    const ev = events[0] as Extract<PaneEvent, { kind: 'resize' }>;
    expect(ev.kind).toBe('resize');
    expect(ev.dims.width).toBe(120);
    expect(ev.dims.height).toBe(40);

    off();
    pane.unmount();
  });

  test('title event forwards strings', () => {
    const emitter = { emit: null as any };
    const pty = makeFakePreview({ value: '' }, emitter);
    const pane = new TerminalPane(makeRef('te3'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emitter.emit!({ kind: 'title', title: 'my-session' });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ kind: 'title', title: 'my-session' });

    off();
    pane.unmount();
  });

  test('Unsubscribe stops event delivery', () => {
    const emitter = { emit: null as any };
    const pty = makeFakePreview({ value: '' }, emitter);
    const pane = new TerminalPane(makeRef('te4'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    let count = 0;
    const off = pane.addTap('event', () => { count++; });

    emitter.emit!({ kind: 'cursor', row: 0, col: 0 });
    expect(count).toBe(1);
    off();
    emitter.emit!({ kind: 'cursor', row: 1, col: 1 });
    expect(count).toBe(1); // no further fires post-unsubscribe

    pane.unmount();
  });

  test('one throwing subscriber does not poison the others', () => {
    const emitter = { emit: null as any };
    const pty = makeFakePreview({ value: '' }, emitter);
    const pane = new TerminalPane(makeRef('te5'), makeFakeTerminalInstance(pty));
    pane.mount(makeCtx());
    let bReceived = 0;
    const offA = pane.addTap('event', () => { throw new Error('A-throws'); });
    const offB = pane.addTap('event', () => { bReceived++; });

    emitter.emit!({ kind: 'title', title: 'x' });
    expect(bReceived).toBe(1);

    offA();
    offB();
    pane.unmount();
  });
});

// ── ExternalTerminalPane frame tap ─────────────────────────────

describe('W3 · ExternalTerminalPane lossy frame tap', () => {
  test('accumulates chunks and emits on throttle', async () => {
    const emit = { chunkEmitter: null as any };
    const handle = makeFakeShellHandle(emit);
    const pane = new ExternalTerminalPane(makeRef('e1'), handle);
    pane.mount(makeCtx());

    const frames: FrameChunk[] = [];
    const off = pane.addTap('frame', (f) => { frames.push(f as FrameChunk); }, { throttleMs: 30 });

    // Inject chunks via the captured emitter.
    emit.chunkEmitter?.({ bytes: 'hello ', ts: Date.now(), stream: 'stdout' });
    emit.chunkEmitter?.({ bytes: 'world\r\n', ts: Date.now(), stream: 'stdout' });

    await new Promise((r) => setTimeout(r, 60));
    off();
    pane.unmount();

    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]!.bytes).toContain('hello');
    expect(frames[0]!.bytes).toContain('world');
  });

  test('idle period produces no frames (accumulator empty)', async () => {
    const emit = { chunkEmitter: null as any };
    const pane = new ExternalTerminalPane(makeRef('e2'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    let count = 0;
    const off = pane.addTap('frame', () => { count++; }, { throttleMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    off();
    pane.unmount();
    // No chunk emitted → no frame fire.
    expect(count).toBe(0);
  });

  test('supportedTaps advertises raw + frame + event (W3-ext-2)', () => {
    const emit = { chunkEmitter: null as any };
    const pane = new ExternalTerminalPane(makeRef('e3'), makeFakeShellHandle(emit));
    expect(pane.describe().supportedTaps).toEqual(['raw', 'frame', 'event']);
  });

  test('maxBufferBytes truncates accumulator', async () => {
    const emit = { chunkEmitter: null as any };
    const pane = new ExternalTerminalPane(makeRef('e4'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const frames: FrameChunk[] = [];
    const off = pane.addTap('frame', (f) => { frames.push(f as FrameChunk); }, {
      throttleMs: 40,
      maxBufferBytes: 1024,
    });
    // Push 5KB of content — should be truncated to ≤ 1024.
    emit.chunkEmitter?.({ bytes: 'a'.repeat(5000), ts: Date.now(), stream: 'stdout' });
    await new Promise((r) => setTimeout(r, 80));
    off();
    pane.unmount();
    if (frames.length > 0) {
      expect(frames[0]!.bytes.length).toBeLessThanOrEqual(1024);
    }
  });
});

// ── ExternalTerminalPane event tap (W3-ext-2) ─────────────────

describe('W3-ext-2 · ExternalTerminalPane event tap', () => {
  test('boundary cmd-end forwards exit event with exitCode', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee1'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emit.boundaryEmitter({ kind: 'cmd-end', exitCode: 0, source: 'exit', at: Date.now() });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ kind: 'exit', code: 0 });

    off();
    pane.unmount();
  });

  test('status completed fires exit with null code when no boundary', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee2'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emit.statusEmitter('completed');
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ kind: 'exit', code: null });

    off();
    pane.unmount();
  });

  test('exit dedup — boundary then status fires only once', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee3'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emit.boundaryEmitter({ kind: 'cmd-end', exitCode: 1, source: 'exit', at: Date.now() });
    emit.statusEmitter('killed');
    expect(events.length).toBe(1);
    expect((events[0] as any).code).toBe(1);

    off();
    pane.unmount();
  });

  test('prompt-start boundary becomes title event', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee4'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emit.boundaryEmitter({ kind: 'prompt-start', source: 'osc-133', at: Date.now() });
    expect(events).toEqual([{ kind: 'title', title: 'prompt-start' }]);

    off();
    pane.unmount();
  });

  test('backgrounded status fires unmount event', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee5'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); });

    emit.statusEmitter('backgrounded');
    expect(events).toEqual([{ kind: 'unmount' }]);

    off();
    pane.unmount();
  });

  test('Unsubscribe cleans both boundary and status subscriptions', () => {
    const emit: any = { chunkEmitter: null };
    const pane = new ExternalTerminalPane(makeRef('ee6'), makeFakeShellHandle(emit));
    pane.mount(makeCtx());
    let count = 0;
    const off = pane.addTap('event', () => { count++; });

    emit.boundaryEmitter({ kind: 'cmd-end', exitCode: 0, source: 'exit', at: Date.now() });
    expect(count).toBe(1);
    off();
    expect(emit.boundaryEmitter).toBeNull();
    expect(emit.statusEmitter).toBeNull();
    // Further attempts should have no subscribers anyway.
    pane.unmount();
  });
});

// ── WidgetPane event tap ───────────────────────────────────────

describe('W3 · WidgetPane event tap (state fingerprint diff)', () => {
  test('fires on state change, not on unchanged polls', async () => {
    const def = makeFakeWidget();
    const instance: WidgetInstance = {
      id: 'w-inst',
      type: 'fake-widget',
      character: 'F',
      state: { counter: 0 },
    };
    const pane = new WidgetPane(makeRef('w1'), instance, def);
    pane.mount(makeCtx());

    const events: PaneEvent[] = [];
    const off = pane.addTap('event', (e) => { events.push(e as PaneEvent); }, { throttleMs: 30 });

    await new Promise((r) => setTimeout(r, 50));
    // First poll captures the initial fingerprint — fires once.
    const initial = events.length;

    // Mutate state.
    (instance.state as any).counter = 1;
    await new Promise((r) => setTimeout(r, 80));
    off();
    pane.unmount();

    expect(initial).toBeGreaterThanOrEqual(1);
    expect(events.length).toBeGreaterThan(initial);
    expect(events.at(-1)!.kind).toBe('widget-state');
  });

  test('stable state → no repeated fires after initial', async () => {
    const instance: WidgetInstance = {
      id: 'w-inst',
      type: 'fake-widget',
      character: 'F',
      state: { counter: 5 },
    };
    const pane = new WidgetPane(makeRef('w2'), instance, makeFakeWidget());
    pane.mount(makeCtx());
    let count = 0;
    const off = pane.addTap('event', () => { count++; }, { throttleMs: 30 });
    await new Promise((r) => setTimeout(r, 120));
    off();
    pane.unmount();
    // Initial fingerprint capture fires once; then no changes = no fires.
    expect(count).toBe(1);
  });

  test('supportedTaps advertises event only', () => {
    const pane = new WidgetPane(
      makeRef('w3'),
      { id: 'w', type: 'f', character: 'F', state: {} },
      makeFakeWidget(),
    );
    expect(pane.describe().supportedTaps).toEqual(['event']);
  });

  test('raw tap throws PaneTapNotSupportedError', () => {
    const pane = new WidgetPane(
      makeRef('w4'),
      { id: 'w', type: 'f', character: 'F', state: {} },
      makeFakeWidget(),
    );
    expect(() => pane.addTap('raw', () => {})).toThrow(PaneTapNotSupportedError);
    expect(() => pane.addTap('frame', () => {})).toThrow(PaneTapNotSupportedError);
  });
});

// ── Placeholder unchanged ──────────────────────────────────────

describe('W3 · PlaceholderPane rejects every tap kind', () => {
  test('all 3 tap kinds throw PaneTapNotSupportedError', () => {
    const pane = new PlaceholderPane(makeRef('ph'), 'empty');
    for (const kind of ['raw', 'frame', 'event'] as const) {
      expect(() => pane.addTap(kind, () => {})).toThrow(PaneTapNotSupportedError);
    }
  });
});
