import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import type { KeyEvent } from '../src/display/types.js';
import { createMessageBlockStream } from '../src/conv-substrate/message-block.js';
import { createAcpResidentShellPaneContent } from '../src/acp/resident-shell.js';
import type { PersistedAcpSession } from '../src/acp/session-persistence.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function makeDeps() {
  let stubs = [
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
  const backgrounds = new Map<string, any>();
  const drmListeners = new Set<() => void>();
  const bgStateListeners = new Set<() => void>();
  const bgCreateListeners = new Set<() => void>();
  const persistenceListeners = new Set<() => void>();
  const streams = new Map<string, ReturnType<typeof createMessageBlockStream>>();
  const persisted = new Map<string, PersistedAcpSession>();

  return {
    deps: {
      dualRoleManager: {
        listAsSidebarStubs: () => stubs,
        onChange: (cb: () => void) => {
          drmListeners.add(cb);
          return () => { drmListeners.delete(cb); };
        },
      },
      backgroundManager: {
        list: () => Array.from(backgrounds.values()) as any[],
        status: (id: string) => backgrounds.get(id) ?? null,
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
  };
}

describe('ACP resident shell', () => {
  test('defaults to Browser tab with live/background browser content', () => {
    const h = makeDeps();
    h.addPersistedHistory();
    const pane = createAcpResidentShellPaneContent({ kind: 'acp-shell', title: 'ACP' }, h.deps as any);
    const out = stripAnsi(pane.render({ cols: 92, rows: 24, focused: true }));
    expect(out).toContain('Browser');
    expect(out).toContain('History');
    expect(out).toContain('ACP · claude-code · monad-agent');
    expect(out).not.toContain('History · claude-code');
  });

  test('tab switches to History and shows persisted sessions', () => {
    const h = makeDeps();
    h.addPersistedHistory();
    const pane = createAcpResidentShellPaneContent({ kind: 'acp-shell', title: 'ACP' }, h.deps as any);
    pane.render({ cols: 92, rows: 40, focused: true });
    expect(pane.onKey(key('tab')).type).toBe('refresh');
    const out = pane.capture();
    expect(out).toContain('History · claude-code');
    expect(out).toContain('saved> persisted assistant answer');
  });

  test('mouse click on top tabs can switch to History', () => {
    const h = makeDeps();
    h.addPersistedHistory();
    const pane = createAcpResidentShellPaneContent({ kind: 'acp-shell', title: 'ACP' }, h.deps as any);
    pane.render({ cols: 92, rows: 24, focused: true });
    const result = pane.onMouse({ type: 'click', row: 1, col: 14 });
    expect(result.type).toBe('refresh');
    const out = pane.capture();
    expect(out).toContain('History · claude-code');
  });
});
