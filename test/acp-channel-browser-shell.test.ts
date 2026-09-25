import { describe, expect, test } from 'bun:test';
import {
  createAcpChannelBrowserPaneContent,
  createAcpChannelBrowserView,
} from '../src/acp/channel-browser-shell.js';
import { stripAnsi } from '../src/tui.js';
import { Printer } from '../src/ui/printer.js';
import type { KeyEvent } from '../src/display/types.js';
import type { AcpSessionStub } from '../src/session/card.js';
import { createMessageBlockStream } from '../src/conv-substrate/message-block.js';
import type { PersistedAcpSession } from '../src/acp/session-persistence.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeDeps() {
  let stubs: AcpSessionStub[] = [
    {
      id: 'acp-cli:claude:1',
      title: 'ACP · claude-code · monad-agent',
      agentKind: 'claude-code',
      isAlive: true,
      createdAt: 1,
      lastActivityAt: 2,
      meta: { namespace: 'acp-cli', backendId: 'claude-code', backendSessionId: '1', activeHops: 0 },
    },
  ];
  const backgrounds = new Map<string, {
    id: string;
    clientSessionId: string;
    backendSessionId: string;
    backendId: string;
    cwd: string;
    initialMessage: string;
    state: 'running' | 'waiting_for_confirmation' | 'completed' | 'failed' | 'cancelled';
    startedAt: number;
    lastSeenAt: number;
    outputPreview: string;
    fullOutput: string;
    stopReason?: string;
    error?: string;
    origin?: string;
  }>();
  const drmListeners = new Set<() => void>();
  const bgStateListeners = new Set<() => void>();
  const bgCreateListeners = new Set<() => void>();
  const persistenceListeners = new Set<() => void>();
  const streams = new Map<string, ReturnType<typeof createMessageBlockStream>>();
  const persisted = new Map<string, PersistedAcpSession>();

  const deps = {
    dualRoleManager: {
      listAsSidebarStubs: () => stubs,
      onChange: (cb: () => void) => {
        drmListeners.add(cb);
        return () => { drmListeners.delete(cb); };
      },
    },
    backgroundManager: {
      list: () => Array.from(backgrounds.values()) as any[],
      status: (id: string) => (backgrounds.get(id) as any) ?? null,
      onStateChange: (cb: () => void) => {
        bgStateListeners.add(cb);
        return () => { bgStateListeners.delete(cb); };
      },
      onCreate: (cb: () => void) => {
        bgCreateListeners.add(cb);
        return () => { bgCreateListeners.delete(cb); };
      },
    },
    eventRouter: {
      getStream: (id: string) => {
        let stream = streams.get(id);
        if (!stream) {
          stream = createMessageBlockStream();
          streams.set(id, stream);
        }
        return stream;
      },
    },
    persistence: {
      list: () => Array.from(persisted.values()),
      load: (id: string) => persisted.get(id) ?? null,
      onChange: (cb: () => void) => {
        persistenceListeners.add(cb);
        return () => { persistenceListeners.delete(cb); };
      },
    },
    runPrimaryAction: async () => 'action complete',
  };

  return {
    deps,
    addBackground() {
      backgrounds.set('acp-bg:bg-1', {
        id: 'acp-bg:bg-1',
        clientSessionId: 'bg-1',
        backendSessionId: 'raw-bg-1',
        backendId: 'codex',
        cwd: '/tmp/acp',
        initialMessage: 'hi',
        state: 'running',
        startedAt: 10,
        lastSeenAt: 20,
        outputPreview: 'partial output',
        fullOutput: 'partial output',
        origin: 'sidebar-test',
      });
      for (const cb of bgCreateListeners) cb();
    },
    addPersistedHistory() {
      persisted.set('acp-cli:claude:hist-1', {
        sessionId: 'acp-cli:claude:hist-1',
        backendSessionId: 'hist-1',
        backendId: 'claude-code',
        cwd: '/tmp/monad-agent',
        protocolVersion: 1,
        history: [
          { type: 'text', text: 'persisted user turn' },
          { type: 'text', text: 'persisted assistant answer' },
        ],
        planSnapshot: null,
        toolCalls: [],
        createdAt: 5,
        lastSeenAt: 25,
        origin: 'history-test',
      });
      for (const cb of persistenceListeners) cb();
    },
    triggerDrm() {
      for (const cb of drmListeners) cb();
    },
    replaceStubs(next: AcpSessionStub[]) {
      stubs = next;
    },
    seedClientExcerpt(id: string, text: string) {
      const stream = deps.eventRouter.getStream(id);
      stream.push({
        id: `${id}:assistant:0:1`,
        ts: 1,
        source: 'agent',
        body: { kind: 'assistant', text },
      });
    },
    triggerBgState() {
      for (const cb of bgStateListeners) cb();
    },
  };
}

describe('ACP channel browser shell', () => {
  test('shared view renders ACP title and session rails', () => {
    const h = makeDeps();
    h.seedClientExcerpt('acp-cli:claude:1', 'live excerpt line');
    const view = createAcpChannelBrowserView({}, h.deps as any);
    view.layout({ width: 70, height: 34 });
    const printer = Printer.create({ width: 70, height: 34, focused: true });
    view.draw(printer);
    const out = printer.lines().map(stripAnsi).join('\n');
    expect(out).toContain('ACP Channels');
    expect(out).toContain('Channels');
    expect(out).toContain('ACP · claude-code · monad-agent');
    expect(out).toContain('Right-click menu');
    expect(out).toContain('Lane type');
    expect(out).toContain('Primary action');
    expect(out).toContain('Next actions');
    expect(out).toContain('Output excerpt');
    expect(out).toContain('Active hops');
    expect(out).toContain('0');
    expect(out).toContain('live excerpt line');
  });

  test('pane content swaps detail and refreshes when ACP sources change', () => {
    const h = makeDeps();
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    const first = pane.render({ cols: 70, rows: 16, focused: true });
    expect(stripAnsi(first)).toContain('ACP · claude-code · monad-agent');

    h.addBackground();
    const afterCreate = pane.capture();
    expect(afterCreate).toContain('BG · codex · acp');

    const action = pane.onKey(key('down'));
    expect(action.type).toBe('refresh');

    pane.render({ cols: 70, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Running · codex');
    expect(detail).toContain('Lane type');
    expect(detail).toContain('Background');
    expect(detail).toContain('Primary action');
    expect(detail).toContain('Promote background lane to');
    expect(detail).toContain('Summary');
    expect(detail).toContain('Next actions');
    expect(detail).toContain('Output excerpt');
    expect(detail).toContain('bg> partial output');
  });

  test('pane content lists persisted ACP history lanes with saved excerpt', () => {
    const h = makeDeps();
    h.addPersistedHistory();
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 32, focused: true });
    const first = pane.capture();
    expect(first).toContain('History');
    expect(first).toContain('claude-cod');

    const action = pane.onKey(key('down'));
    expect(action.type).toBe('refresh');

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('History · claude-code');
    expect(detail).toContain('History');
    expect(detail).toContain('Primary action');
    expect(detail).toContain('Resume persisted ACP se');
    expect(detail).toContain('ssion');
    expect(detail).toContain('Output excerpt');
    expect(detail).toContain('saved> persisted user turn');
    expect(detail).toContain('saved> persisted assistant answer');
  });

  test('ctrl-enter runs the active lane primary action and shows status', async () => {
    const h = makeDeps();
    h.addBackground();
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 40, focused: true });
    const moved = pane.onKey(key('down'));
    expect(moved.type).toBe('refresh');

    const action = pane.onKey(key('enter', { ctrl: true }));
    expect(action.type).toBe('refresh');
    await flush();

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Action status');
    expect(detail).toContain('action complete');
  });

  test('ctrl-enter can run a live client primary action through injected runner', async () => {
    const h = makeDeps();
    h.deps.runPrimaryAction = async (action) => `ran:${action.id}`;
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);

    const action = pane.onKey(key('enter', { ctrl: true }));
    expect(action.type).toBe('refresh');
    await flush();

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Action status');
    expect(detail).toContain('ran:open-live-client-room');
  });

  test('double-click on a rail row runs the lane primary action', async () => {
    const h = makeDeps();
    h.addBackground();
    h.deps.runPrimaryAction = async (action) => `dbl:${action.id}`;
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 40, focused: true });

    const action = pane.onMouse({
      type: 'double-click',
      row: 4,
      col: 2,
      x: 2,
      y: 4,
      button: 'left',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    expect(action.type).toBe('refresh');
    await flush();

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Action status');
    expect(detail).toContain('dbl:promote-background-vw');
  });

  test('double-click in the detail pane runs the active lane primary action', async () => {
    const h = makeDeps();
    h.deps.runPrimaryAction = async (action) => `detail:${action.id}`;
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 40, focused: true });

    const action = pane.onMouse({
      type: 'double-click',
      row: 4,
      col: 32,
      x: 32,
      y: 4,
      button: 'left',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    expect(action.type).toBe('refresh');
    await flush();

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Action status');
    expect(detail).toContain('detail:open-live-client-room');
  });

  test('right-click opens an ACP context menu and Enter runs the highlighted action', async () => {
    const h = makeDeps();
    h.deps.runPrimaryAction = async (action) => `menu:${action.id}`;
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 40, focused: true });

    const opened = pane.onMouse({
      type: 'right-click',
      row: 3,
      col: 2,
      x: 2,
      y: 3,
      button: 'right',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    expect(opened.type).toBe('refresh');
    expect(pane.capture()).toContain('Copy session id');
    expect(pane.capture()).toContain('Copy excerpt');

    const picked = pane.onKey(key('enter'));
    expect(picked.type).toBe('refresh');
    await flush();

    pane.render({ cols: 72, rows: 40, focused: true });
    const detail = pane.capture();
    expect(detail).toContain('Action status');
    expect(detail).toContain('menu:open-live-client-room');
  });

  test('dragging a rail row reorders ACP lanes inside the shell', () => {
    const h = makeDeps();
    h.addBackground();
    h.addPersistedHistory();
    const pane = createAcpChannelBrowserPaneContent({ kind: 'acp-shell', title: 'ACP Channels' }, h.deps as any);
    pane.render({ cols: 72, rows: 40, focused: true });
    const before = pane.capture();
    expect(before.indexOf('ACP · claude-code · monad-agent')).toBeLessThan(before.indexOf('BG · codex · acp'));

    const click = pane.onMouse({
      type: 'click',
      row: 4,
      col: 2,
      x: 2,
      y: 4,
      button: 'left',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    const drag = pane.onMouse({
      type: 'drag',
      row: 3,
      col: 2,
      x: 2,
      y: 3,
      button: 'left',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    const release = pane.onMouse({
      type: 'release',
      row: 3,
      col: 2,
      x: 2,
      y: 3,
      button: 'left',
      shift: false,
      ctrl: false,
      alt: false,
    } as any);
    expect(click.type).toBe('refresh');
    expect(drag.type).toBe('refresh');
    expect(release.type).toBe('refresh');

    pane.render({ cols: 72, rows: 40, focused: true });
    const after = pane.capture();
    expect(after).toContain('● BG · codex · acp');
    expect(after).toContain('○ ACP · claude-code…');
    expect(after).toContain('Reordered to rail slot 1');
  });
});
