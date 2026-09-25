// ── VW-term-infra Bundle B-1 · B1-1 — pane-runtimes tests ──

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildDescribePaneTool,
  buildSetFocusPolicyTool,
  createDescribePaneRuntime,
  createSetFocusPolicyRuntime,
  dispatchDescribePane,
  dispatchSetFocusPolicy,
  registerPaneRuntimes,
  __resetPaneRuntimesForTest,
} from '../src/tool-runtime/pane-runtimes.js';
import {
  _resetToolRuntimeRegistryForTest,
  getToolRuntime,
} from '../src/tool-runtime/registry.js';
import { getChordHint } from '../src/tool-runtime/mirror-hints.js';
import {
  createVisualStateStore,
  PANE_FOCUS_POLICY,
  type PaneVisualStateStore,
} from '../src/panes/visual-state.js';
import type { PaneRef } from '../src/panes/types.js';

const ref: PaneRef = { windowId: 'w1', paneId: 'p1' };

function freshStore(): PaneVisualStateStore {
  return createVisualStateStore();
}

afterEach(() => {
  __resetPaneRuntimesForTest();
  _resetToolRuntimeRegistryForTest();
});

// ── Tool spec shape ─────────────────────────────────────────────

describe('tool specs · shape + chord hint', () => {
  test('SetFocusPolicy spec · requires ref + next · chord hint "^B p"', () => {
    const spec = buildSetFocusPolicyTool();
    expect(spec.name).toBe('SetFocusPolicy');
    const params = spec.parameters as { required: string[] };
    expect(params.required).toEqual(['ref', 'next']);
    expect(getChordHint(spec)).toBe('^B p');
  });

  test('DescribePane spec · requires ref · chord hint "^B d"', () => {
    const spec = buildDescribePaneTool();
    expect(spec.name).toBe('DescribePane');
    expect(getChordHint(spec)).toBe('^B d');
  });
});

// ── dispatchSetFocusPolicy ──────────────────────────────────────

describe('dispatchSetFocusPolicy', () => {
  test('normal → skip transition · applied true', () => {
    const store = freshStore();
    const out = dispatchSetFocusPolicy({ ref, next: 'skip' }, { store });
    expect(out.applied).toBe(true);
    expect(out.prev).toBe(PANE_FOCUS_POLICY.normal);
    expect(out.next).toBe(PANE_FOCUS_POLICY.skip);
    expect(store.snapshot(ref).focusPolicy).toBe(PANE_FOCUS_POLICY.skip);
  });

  test('invalid next value → applied false · note explains', () => {
    const store = freshStore();
    const out = dispatchSetFocusPolicy({ ref, next: 'garbage' }, { store });
    expect(out.applied).toBe(false);
    expect(out.note).toMatch(/invalid focusPolicy/);
    expect(store.snapshot(ref).focusPolicy).toBe(PANE_FOCUS_POLICY.normal);
  });

  test('missing ref → applied false · structured note (no throw)', () => {
    const store = freshStore();
    const out = dispatchSetFocusPolicy({ next: 'skip' }, { store });
    expect(out.applied).toBe(false);
    expect(out.note).toMatch(/ref missing/);
  });

  test('identical transition · applied false (no emission)', () => {
    const store = freshStore();
    dispatchSetFocusPolicy({ ref, next: 'skip' }, { store });
    const out = dispatchSetFocusPolicy({ ref, next: 'skip' }, { store });
    expect(out.applied).toBe(false);
    expect(out.note).toMatch(/identical or illegal/);
  });
});

// ── dispatchDescribePane ────────────────────────────────────────

describe('dispatchDescribePane', () => {
  test('unknown pane → found:false · visualState default present', () => {
    const store = freshStore();
    const out = dispatchDescribePane({ ref }, { store });
    expect(out.found).toBe(false);
    expect(out.visualState).toBeDefined();
    expect(out.visualState!.focusPolicy).toBe(PANE_FOCUS_POLICY.normal);
  });

  test('setFocusPolicy then DescribePane → visualState reflects', () => {
    const store = freshStore();
    dispatchSetFocusPolicy({ ref, next: 'no-focus' }, { store });
    const out = dispatchDescribePane({ ref }, { store });
    expect(out.visualState!.focusPolicy).toBe(PANE_FOCUS_POLICY['no-focus']);
  });

  test('missing ref → found:false · note', () => {
    const store = freshStore();
    const out = dispatchDescribePane({}, { store });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/ref missing/);
  });
});

// ── Registration ────────────────────────────────────────────────

describe('registerPaneRuntimes', () => {
  test('registers both runtimes · lookup by id', () => {
    const store = freshStore();
    registerPaneRuntimes({ store });
    expect(getToolRuntime('pane_set_focus_policy')).toBeDefined();
    expect(getToolRuntime('pane_describe')).toBeDefined();
  });

  test('idempotent re-register · no throw', () => {
    const store = freshStore();
    registerPaneRuntimes({ store });
    expect(() => registerPaneRuntimes({ store })).not.toThrow();
  });

  test('createSetFocusPolicyRuntime.run wires through store', async () => {
    const store = freshStore();
    registerPaneRuntimes({ store });
    const rt = createSetFocusPolicyRuntime();
    // run() consults module-level _depsRef which registerPaneRuntimes
    // updates · so it should see the store.
    const result = await rt.run({ ref, next: 'skip' } as never, { surface: 'dashboard' } as never);
    const parsed = JSON.parse((result as { output: string }).output);
    expect(parsed.applied).toBe(true);
    expect(store.snapshot(ref).focusPolicy).toBe(PANE_FOCUS_POLICY.skip);
  });
});
