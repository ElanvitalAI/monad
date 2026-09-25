import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildContextTools,
  dispatchContextWorkspace,
  dispatchContextWindowsList,
  dispatchContextWindowDetail,
  dispatchContextPaneDetail,
  dispatchContextPtysList,
  dispatchContextSessionsList,
  dispatchContextToolsList,
  dispatchContextEventsTail,
  dispatchContextBootstrap,
} from '../src/skills/tools/context.js';
import {
  getGlobalElementEventBus,
  _resetGlobalElementEventBusForTesting,
  _resetGlobalElementStateStoreForTesting,
  initElementObservability,
  publishElementEvent,
} from '../src/element-registry/index.js';
import { _teardownElementObservabilityForTesting } from '../src/element-registry/observability.js';

beforeEach(() => {
  _teardownElementObservabilityForTesting();
  _resetGlobalElementEventBusForTesting();
  _resetGlobalElementStateStoreForTesting();
  initElementObservability();
});

describe('skill-tool-context / buildContextTools', () => {
  test('returns expected number of specs', () => {
    const specs = buildContextTools();
    expect(specs).toHaveLength(12);
    expect(new Set(specs.map(s => s.name)).size).toBe(12);
    expect(specs.some(s => s.name === 'ContextWorkspace')).toBe(true);
    expect(specs.some(s => s.name === 'ContextBootstrap')).toBe(true);
  });
});

describe('skill-tool-context / dispatchers', () => {
  test('workspace returns cwd + platform', async () => {
    const r = await dispatchContextWorkspace({}, { cwd: '/tmp/x' });
    expect(r.workspace.cwd).toBe('/tmp/x');
    expect(r.workspace.platform).toBe(process.platform);
    expect(r.output).toContain('cwd=/tmp/x');
  });

  test('windows.list returns empty when no registry wired', async () => {
    const r = await dispatchContextWindowsList({});
    expect(r.windows).toEqual([]);
    expect(r.output).toContain('no virtual windows');
  });

  test('windows.list + window.detail + pane.detail with a stub registry', async () => {
    const deps = {
      getWindowRegistry: () => ({
        list: () => [{
          id: 3,
          title: 'main',
          focused: 'aa1234',
          listPanes: () => [
            { id: 'aa1234', content: { kind: 'terminal', title: 'shell' } },
            { id: 'bb5678', content: { kind: 'markdown', title: 'notes' } },
          ],
        }],
        current: () => ({ id: 3 }),
      }),
    };
    const list = await dispatchContextWindowsList({}, deps);
    expect(list.windows).toHaveLength(1);
    expect(list.windows[0]!.foreground).toBe(true);
    expect(list.windows[0]!.paneCount).toBe(2);

    const detail = await dispatchContextWindowDetail({ addr: 'win:3' }, deps);
    expect(detail.output).toContain('win:3');
    expect(detail.output).toContain('pane:aa1234(terminal,focus)');

    const pane = await dispatchContextPaneDetail({ addr: 'pane:bb5678' }, deps);
    expect(pane.output).toContain('pane:bb5678');
    expect(pane.output).toContain('markdown');
  });

  test('ptys.list reads from PTY registry (empty in test env)', async () => {
    const r = await dispatchContextPtysList();
    expect(Array.isArray(r.ptys)).toBe(true);
  });

  test('sessions.list passes through getter', async () => {
    const r = await dispatchContextSessionsList({}, {
      getTerminalSessions: () => [
        { id: 'abc', title: 'codex', state: 'foreground' },
      ],
    });
    expect(r.sessions[0]!.addr).toBe('sess:abc');
    expect(r.output).toContain('sess:abc');
  });

  test('tools.list returns catalog entries (default all)', async () => {
    const r = await dispatchContextToolsList({});
    expect(r.tools.length).toBeGreaterThan(0);
    expect(r.tools.some(t => t.id === 'context_workspace')).toBe(true);
  });

  test('tools.list filters by host and returns host membership', async () => {
    const r = await dispatchContextToolsList({ host: 'mcp' });
    expect(r.tools.every(t => t.host.includes('mcp') || t.host.includes('all'))).toBe(true);
    expect(r.tools.every(t => !('surface' in t))).toBe(true);
  });

  test('events.tail returns entries from the live bus', async () => {
    publishElementEvent('pty', 'x', 'create');
    publishElementEvent('pty', 'x', 'output', { bytes: 3 });
    const r = await dispatchContextEventsTail({ kinds: ['pty'], limit: 10 });
    expect(r.events.length).toBeGreaterThanOrEqual(2);
    expect(r.events[0]!.addr).toBe('pty:x');
  });

  test('bootstrap aggregates the core listings', async () => {
    const r = await dispatchContextBootstrap({}, {
      cwd: '/tmp/y',
      getTerminalSessions: () => [],
    });
    expect(r.output).toContain('cwd=/tmp/y');
    expect(r.workspace).toBeDefined();
    expect(Array.isArray(r.windows)).toBe(true);
    expect(Array.isArray(r.tools)).toBe(true);
  });
});
