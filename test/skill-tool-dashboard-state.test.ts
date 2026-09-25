// ── GetDashboardState LLM tool tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  buildGetDashboardStateTool,
  dispatchGetDashboardState,
} from '../src/skills/tools/dashboard-state';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import { getToolRuntime, dispatchToolByName, _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import {
  dashboardStateRuntime,
  setTerminalMouseIntentsGetter,
  setTerminalSessionsGetter,
  _resetDashboardStateDedupForTest,
} from '../src/tool-runtime/dashboard-state-runtime';
import {
  setPtyAdapterForTesting, resetForTesting,
} from '../src/pty-shell/registry';
import { resolveTerminalInteractionPolicy } from '../src/dashboard/terminal-exposure';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  initDashboardVirtualWindows,
  _resetDashboardVirtualWindowsForTesting,
} from '../src/dashboard/windowing/virtual-windows.js';

function spawnProbeWindow(): void {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const vw = initDashboardVirtualWindows({
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  vw.registry.spawn({
    title: 'probe',
    initialContent: { kind: 'markdown', text: 'hello' },
  });
}

describe('buildGetDashboardStateTool', () => {
  test('shape', () => {
    const spec = buildGetDashboardStateTool();
    expect(spec.name).toBe('GetDashboardState');
    expect(spec.parameters.required ?? []).toEqual([]);
    expect(spec.parameters.additionalProperties).toBe(false);
  });
});

describe('dispatchGetDashboardState', () => {
  beforeEach(() => {
    resetForTesting();
    setPtyAdapterForTesting(() => ({
      pid: 1, write: () => {}, kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
    }));
  });
  afterEach(() => {
    resetForTesting();
    setPtyAdapterForTesting(null);
  });

  test('returns snapshot + summary output', async () => {
    const res = await dispatchGetDashboardState({}, { cwd: '/tmp/test' });
    expect(res.snapshot.workspace.cwd).toBe('/tmp/test');
    expect(res.output).toContain('monad-agent state');
    expect(res.output).toContain('cwd=/tmp/test');
  });

  test('terminalSessions from opts flow into snapshot', async () => {
    const res = await dispatchGetDashboardState({}, {
      cwd: '/tmp',
      terminalSessions: [
        {
          id: 's1',
          title: 'claude',
          state: 'foreground',
          exposure: { userExposure: 'user-interactive', agentInteractive: true },
        },
      ],
    });
    expect(res.snapshot.terminalSessions).toHaveLength(1);
    expect(res.output).toContain('terminal sessions: 1');
  });
});

describe('dashboardStateRuntime registry', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    setTerminalMouseIntentsGetter(null);
    setTerminalSessionsGetter(null);
    _resetDashboardStateDedupForTest();
    _resetDashboardVirtualWindowsForTesting();
  });
  afterEach(() => {
    _resetToolRuntimeRegistryForTest();
    setTerminalMouseIntentsGetter(null);
    setTerminalSessionsGetter(null);
    _resetDashboardStateDedupForTest();
    _resetDashboardVirtualWindowsForTesting();
  });

  test('registers + aliases resolve', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('dashboard_state')).toBe(dashboardStateRuntime);
    expect(getToolRuntime('GetDashboardState')).toBe(dashboardStateRuntime);
  });

  test('runtime consults setTerminalSessionsGetter', async () => {
    registerAllDefaultToolRuntimes();
    setTerminalSessionsGetter(() => [
      {
        id: 't1',
        title: 'codex',
        state: 'foreground',
        exposure: { userExposure: 'user-interactive', agentInteractive: true },
      },
    ]);
    const res = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as {
      snapshot: {
        terminalSessions: Array<{ id: string; exposure?: { userExposure: string; agentInteractive: boolean } }>;
      };
    };
    expect(res.snapshot.terminalSessions.map(t => t.id)).toEqual(['t1']);
    expect(res.snapshot.terminalSessions[0]?.exposure).toEqual({
      userExposure: 'user-interactive',
      agentInteractive: true,
    });
  });

  test('runtime consults setTerminalMouseIntentsGetter', async () => {
    registerAllDefaultToolRuntimes();
    setTerminalMouseIntentsGetter(() => [
      {
        surfaceId: 'wd-preview',
        paneKind: 'preview-terminal',
        mouseType: 'double-click',
        hostInterpretation: 'word-select',
        row: 3,
        col: 9,
        transport: 'host-only',
        exposure: { userExposure: 'user-interactive', agentInteractive: true },
        interactionPolicy: resolveTerminalInteractionPolicy({
          userExposure: 'user-interactive',
          agentInteractive: true,
        }),
      },
    ]);
    const res = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as {
      snapshot: {
        recentTerminalMouseIntents: Array<{
          surfaceId: string;
          mouseType: string;
          hostInterpretation: string;
          exposure: { userExposure: string; agentInteractive: boolean };
        }>;
      };
    };
    expect(res.snapshot.recentTerminalMouseIntents).toEqual([
      {
        surfaceId: 'wd-preview',
        mouseType: 'double-click',
        hostInterpretation: 'word-select',
        paneKind: 'preview-terminal',
        row: 3,
        col: 9,
        transport: 'host-only',
        exposure: { userExposure: 'user-interactive', agentInteractive: true },
        interactionPolicy: resolveTerminalInteractionPolicy({
          userExposure: 'user-interactive',
          agentInteractive: true,
        }),
      },
    ]);
  });

  test('getter throw is swallowed — snapshot still works', async () => {
    registerAllDefaultToolRuntimes();
    setTerminalSessionsGetter(() => { throw new Error('boom'); });
    const res = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as { snapshot: { terminalSessions: unknown[] } };
    expect(res.snapshot.terminalSessions).toEqual([]);
  });

  test('repeated unchanged calls return duplicate marker', async () => {
    registerAllDefaultToolRuntimes();
    const first = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as { output: string };
    const second = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as { output: string };
    expect(first.output).toContain('monad-agent state');
    expect(second.output).toContain('[DUPLICATE CALL');
    expect(second.output).toContain('state unchanged');
  });

  test('runtime includes virtual windows by default', async () => {
    registerAllDefaultToolRuntimes();
    spawnProbeWindow();
    const res = await dispatchToolByName(
      'GetDashboardState', {}, { surface: 'dashboard' },
    ) as { snapshot: { windows: Array<{ title: string }>; workspace: { cwd: string } } };
    expect(res.snapshot.windows.map(w => w.title)).toEqual(['probe']);
    expect(res.snapshot.workspace.cwd).toBeTruthy();
  });

  test('runtime emits windows: [] when includeVirtualWindows is false', async () => {
    registerAllDefaultToolRuntimes();
    spawnProbeWindow();
    const res = await dispatchToolByName(
      'GetDashboardState',
      { includeVirtualWindows: false },
      { surface: 'dashboard' },
    ) as { snapshot: { windows: unknown[]; workspace: { cwd: string; platform: string } } };
    expect(res.snapshot.windows).toEqual([]);
    expect(res.snapshot.workspace.cwd).toBeTruthy();
    expect(res.snapshot.workspace.platform).toBe(process.platform);
  });

  test('runtime includes virtual windows when includeVirtualWindows is true', async () => {
    registerAllDefaultToolRuntimes();
    spawnProbeWindow();
    const res = await dispatchToolByName(
      'GetDashboardState',
      { includeVirtualWindows: true },
      { surface: 'dashboard' },
    ) as { snapshot: { windows: Array<{ title: string }> } };
    expect(res.snapshot.windows.map(w => w.title)).toEqual(['probe']);
  });
});
