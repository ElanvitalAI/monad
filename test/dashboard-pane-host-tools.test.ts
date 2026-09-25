import { describe, expect, test } from 'bun:test';

import { registerDashboardPaneHostTools, type DashboardPaneHostToolOps } from '../src/dashboard/panes/host-tools.js';
import { PluginHost, type HostHooks } from '../src/plugins/core/host.js';
import type { DashboardPaneState } from '../src/plugins/core/types.js';

function makeHooks(): HostHooks {
  return {
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
  };
}

function state(overrides: Partial<DashboardPaneState> = {}): DashboardPaneState {
  return {
    activeViewId: 'agents',
    viewLabel: 'Agents',
    baseView: 4,
    focused: 'agent-roster',
    compactLevel: 'desktop',
    primary: 'agent-roster',
    panes: [
      { pane: 'agent-roster', visible: true, closed: false, closeable: false, omittedReason: null },
      { pane: 'agent-detail', visible: true, closed: false, closeable: true, omittedReason: null },
      { pane: 'agent-log', visible: false, closed: false, closeable: true, omittedReason: 'compact' },
    ],
    ...overrides,
  };
}

function makeOps(overrides: Partial<DashboardPaneHostToolOps> = {}): DashboardPaneHostToolOps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    state: () => state(),
    activePaneIds: () => ['agent-roster', 'agent-detail', 'agent-log'],
    close: (pane) => { calls.push(`close:${pane}`); return pane === 'agent-detail'; },
    open: (pane) => { calls.push(`open:${pane}`); return pane === 'agent-detail'; },
    openModal: (pane) => { calls.push(`modal:${pane}`); },
    modals: () => [{ id: 'dashboard-pane-modal' }],
    setOmitOrder: (panes) => {
      calls.push(`omit:${panes.join(',')}`);
      return state({ compactLevel: 'tabletMini' });
    },
    ...overrides,
  };
}

function makeHost(ops = makeOps()): PluginHost {
  const host = new PluginHost(makeHooks());
  registerDashboardPaneHostTools(host, ops);
  return host;
}

describe('dashboard pane host tools', () => {
  test('registers all pane tools as host-level LLM tools', () => {
    const names = makeHost().contributedLLMTools().map(t => t.name);

    expect(names).toContain('pane_getState');
    expect(names).toContain('pane_close');
    expect(names).toContain('pane_open');
    expect(names).toContain('pane_openModal');
    expect(names).toContain('pane_setOmitOrder');
  });

  test('pane_getState dispatch returns the current snapshot', async () => {
    const host = makeHost(makeOps({ state: () => state({ focused: 'agent-detail' }) }));

    const res = await host.dispatchTool('pane_getState', {});

    expect(res).toEqual({ ok: true, result: state({ focused: 'agent-detail' }) });
  });

  test('pane_close and pane_open dispatch through pane ops and return refreshed state', async () => {
    const ops = makeOps();
    const host = makeHost(ops);

    expect(await host.dispatchTool('pane_close', { pane: 'agent-detail' })).toEqual({
      ok: true,
      result: state(),
    });
    expect(await host.dispatchTool('pane_open', { pane: 'agent-detail' })).toEqual({
      ok: true,
      result: state(),
    });
    expect(ops.calls).toEqual(['close:agent-detail', 'open:agent-detail']);
  });

  test('pane_openModal validates active panes before opening modal fallback', async () => {
    const ops = makeOps();
    const host = makeHost(ops);

    expect(await host.dispatchTool('pane_openModal', { pane: 'agent-log' })).toEqual({
      ok: true,
      result: {
        opened: true,
        pane: 'agent-log',
        modals: [{ id: 'dashboard-pane-modal' }],
      },
    });
    expect(ops.calls).toEqual(['modal:agent-log']);

    const missing = await host.dispatchTool('pane_openModal', { pane: 'missing' });
    expect(missing).toEqual({ ok: false, error: 'pane "missing" is not part of the active view' });

    const input = await host.dispatchTool('pane_openModal', { pane: 'input' });
    expect(input).toEqual({ ok: false, error: 'pane "input" is not part of the active view' });
  });

  test('pane_setOmitOrder dispatch validates array args and delegates normalized strings', async () => {
    const ops = makeOps();
    const host = makeHost(ops);

    expect(await host.dispatchTool('pane_setOmitOrder', { panes: ['agent-log', 42] })).toEqual({
      ok: true,
      result: state({ compactLevel: 'tabletMini' }),
    });
    expect(ops.calls).toEqual(['omit:agent-log,42']);

    const bad = await host.dispatchTool('pane_setOmitOrder', { panes: 'agent-log' });
    expect(bad).toEqual({ ok: false, error: 'panes must be an array of pane ids' });
  });

  test('pane_close and pane_open surface operation failures as dispatch errors', async () => {
    const host = makeHost(makeOps({
      close: () => false,
      open: () => false,
    }));

    expect(await host.dispatchTool('pane_close', { pane: 'agent-roster' })).toEqual({
      ok: false,
      error: 'pane "agent-roster" is not closeable in the active view',
    });
    expect(await host.dispatchTool('pane_open', { pane: 'missing' })).toEqual({
      ok: false,
      error: 'pane "missing" is not part of the active view',
    });
  });
});
