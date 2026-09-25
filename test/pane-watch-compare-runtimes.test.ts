// ── VW-term Bundle P7-E-α · runtime registrar tests ──

import { afterEach, describe, expect, test } from 'bun:test';

import {
  createComparePanesRuntime,
  createWatchPaneRuntime,
  registerPaneWatchCompareRuntimes,
  _resetPaneWatchCompareRegistration,
} from '../src/tool-runtime/pane-watch-compare-runtimes.js';
import {
  getToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/registry.js';

afterEach(() => {
  _resetToolRuntimeRegistryForTest();
  _resetPaneWatchCompareRegistration();
});

describe('pane-watch-compare-runtimes · registration', () => {
  test('registerPaneWatchCompareRuntimes puts both runtimes in the registry', () => {
    expect(getToolRuntime('pane_compare')).toBeUndefined();
    expect(getToolRuntime('pane_watch')).toBeUndefined();
    registerPaneWatchCompareRuntimes({});
    const cmp = getToolRuntime('pane_compare');
    const wp = getToolRuntime('pane_watch');
    expect(cmp).toBeDefined();
    expect(wp).toBeDefined();
    expect(cmp!.spec.name).toBe('ComparePanes');
    expect(wp!.spec.name).toBe('WatchPane');
  });

  test('idempotent — second register does not throw on collision', () => {
    registerPaneWatchCompareRuntimes({});
    expect(() => registerPaneWatchCompareRuntimes({})).not.toThrow();
    expect(getToolRuntime('pane_compare')).toBeDefined();
  });

  test('runtime factories return an instance with run() + spec', () => {
    const cmp = createComparePanesRuntime();
    expect(cmp.id).toBe('pane_compare');
    expect(cmp.spec.name).toBe('ComparePanes');
    expect(typeof cmp.run).toBe('function');
    const wp = createWatchPaneRuntime();
    expect(wp.id).toBe('pane_watch');
    expect(wp.spec.name).toBe('WatchPane');
    expect(typeof wp.run).toBe('function');
  });

  test('ComparePanes runtime run() returns stringified output', async () => {
    registerPaneWatchCompareRuntimes({});
    const rt = getToolRuntime('pane_compare')!;
    // Same ref → short-circuit path (no PaneFactory needed).
    const ref = { windowId: 'w', paneId: 'p' };
    const result = await rt.run({ refA: ref, refB: ref }, {} as never);
    expect(result).toHaveProperty('output');
    const parsed = JSON.parse((result as { output: string }).output);
    expect(parsed.samePane).toBe(true);
    expect(parsed.equal).toBe(true);
  });
});
