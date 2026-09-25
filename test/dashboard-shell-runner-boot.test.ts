import { afterEach, describe, expect, test } from 'bun:test';

import { bootDashboardShellRunner } from '../src/dashboard/shell-runner-boot.js';
import { setUserConfigOverlay } from '../src/user-config.js';

type Rollup = { running: number; backgrounded: number };
type Handle = { id: string };
type RunnerRequest = { label: string };
type Host = { host: string };
type CloseEvent = { type: string; spawnTitle?: string | null };

type BootHarness = {
  rollups: Rollup[];
  tracked: Handle[];
  forgotten: string[];
  wiredRegistries: unknown[];
  registeredKinds: string[];
  externalTerminalSpec?: Record<string, unknown>;
  fileEngines: unknown[];
  spawned: Array<{ label: string; host: Host }>;
  runnerFactoryDeps?: {
    getSessionCwd: () => string;
    initialSize: () => { cols: number; rows: number };
    onSpawnError: (label: string, err: unknown) => void;
    onSpawn: (label: string, host: Host) => void;
  };
  shellRunnerDeps?: {
    registry: unknown;
    fileEngine?: unknown;
    ptyHostFactory?: (req: RunnerRequest) => Host | null;
  };
  runnerFactoryReqs: RunnerRequest[];
  evicted: string[];
  onUpdate?: (rollup: Rollup) => void;
  onRegister?: (handle: Handle) => void;
  onUnregister?: (id: string) => void;
  externalTerminalFactory?: (spec: Record<string, unknown>) => unknown;
  subscribed?: (ev: CloseEvent) => void;
};

function bootHarness(): BootHarness {
  setUserConfigOverlay((cfg) => ({
    ...cfg,
    dashboard: { ...cfg.dashboard, uiMode: 'rich' },
  }));

  const harness: BootHarness = {
    rollups: [],
    tracked: [],
    forgotten: [],
    wiredRegistries: [],
    registeredKinds: [],
    fileEngines: [],
    spawned: [],
    runnerFactoryReqs: [],
    evicted: [],
  };
  const registry = { kind: 'registry' };
  const fileEngine = { kind: 'file-engine' };

  bootDashboardShellRunner<RunnerRequest, Handle, Host>({
    createBackgroundSurface: (deps) => {
      harness.onUpdate = deps.onUpdate;
      return {
        track(handle) { harness.tracked.push(handle); },
        forget(id) { harness.forgotten.push(id); },
      };
    },
    initShellRegistry: (deps) => {
      harness.onRegister = deps.onRegister;
      harness.onUnregister = deps.onUnregister;
      return registry;
    },
    wireShellRunnerSurface: ({ shellRegistry }) => { harness.wiredRegistries.push(shellRegistry); },
    registerPaneContentKind: (kind, factory) => {
      harness.registeredKinds.push(kind);
      if (kind === 'external-terminal') {
        harness.externalTerminalFactory = (spec) => factory(spec) as unknown;
      }
    },
    createExternalTerminalPaneContent: (spec) => {
      harness.externalTerminalSpec = spec as Record<string, unknown>;
      return spec as never;
    },
    createRunnerHostFactory: (deps) => {
      harness.runnerFactoryDeps = deps;
      return {
        factory(req) {
          harness.runnerFactoryReqs.push(req);
          const host = { host: `pty:${req.label}` };
          deps.onSpawn(req.label, host);
          return host;
        },
        evict(label) {
          harness.evicted.push(label);
          return true;
        },
      };
    },
    createFileCaptureEngine: () => {
      harness.fileEngines.push(fileEngine);
      return fileEngine;
    },
    setShellRunnerDeps: (deps) => { harness.shellRunnerDeps = deps; },
    getSessionCwd: () => '/tmp/dashboard-cwd',
    termSize: () => ({ cols: 120, rows: 40 }),
    setLatestShellRollup: (rollup) => { harness.rollups.push(rollup); },
    onSpawnError: () => {},
    spawnVirtualWindowTerminal: (label, host) => { harness.spawned.push({ label, host }); },
    subscribeVirtualWindowClose: (cb) => { harness.subscribed = cb; },
  });

  return harness;
}

describe('bootDashboardShellRunner', () => {
  afterEach(() => {
    setUserConfigOverlay(null);
  });

  test('wires rollup updates into latest shell rollup storage', () => {
    const harness = bootHarness();

    harness.onUpdate?.({ running: 2, backgrounded: 1 });

    expect(harness.rollups).toEqual([{ running: 2, backgrounded: 1 }]);
  });

  test('wires shell registry lifecycle into background tracking', () => {
    const harness = bootHarness();

    harness.onRegister?.({ id: 'h1' });
    harness.onUnregister?.('h1');

    expect(harness.tracked).toEqual([{ id: 'h1' }]);
    expect(harness.forgotten).toEqual(['h1']);
    expect(harness.wiredRegistries).toEqual([{ kind: 'registry' }]);
  });

  test('registers the external-terminal pane kind with the delegated pane factory', () => {
    const harness = bootHarness();
    const onTerminalMouseIntent = () => {};

    harness.externalTerminalFactory?.({
      preview: { host: 'preview' },
      title: 'job-1',
      label: 'job-1',
      focusPolicy: 'output-only',
      onTerminalMouseIntent,
    });

    expect(harness.registeredKinds).toEqual(['external-terminal']);
    expect(harness.externalTerminalSpec).toMatchObject({
      preview: { host: 'preview' },
      title: 'job-1',
      label: 'job-1',
      focusPolicy: 'output-only',
      onTerminalMouseIntent,
    });
  });

  test('installs shell-runner dependencies with registry, file engine, and PTY host factory', () => {
    const harness = bootHarness();

    const host = harness.shellRunnerDeps?.ptyHostFactory?.({ label: 'job-1' });

    expect(harness.fileEngines).toEqual([{ kind: 'file-engine' }]);
    expect(harness.shellRunnerDeps?.registry).toEqual({ kind: 'registry' });
    expect(harness.shellRunnerDeps?.fileEngine).toEqual({ kind: 'file-engine' });
    expect(harness.runnerFactoryDeps?.getSessionCwd()).toBe('/tmp/dashboard-cwd');
    expect(harness.runnerFactoryDeps?.initialSize()).toEqual({ cols: 120, rows: 40 });
    expect(harness.runnerFactoryReqs).toEqual([{ label: 'job-1' }]);
    expect(host).toEqual({ host: 'pty:job-1' });
    expect(harness.spawned).toEqual([{ label: 'job-1', host: { host: 'pty:job-1' } }]);
  });

  test('evicts runner hosts when their virtual window closes', () => {
    const harness = bootHarness();

    harness.subscribed?.({ type: 'window:close', spawnTitle: 'job-1' });
    harness.subscribed?.({ type: 'window:close' });
    harness.subscribed?.({ type: 'pane:close', spawnTitle: 'job-2' });

    expect(harness.evicted).toEqual(['job-1']);
  });
});
