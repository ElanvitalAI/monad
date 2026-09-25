// ── VW-term-infra Bundle A · A1 — apply-planner unit tests ──
//
// Exercises `computeApplyActions` + `applyLayoutPlan` with fake
// executors so no VW internals are needed. Covers diff semantics
// (close/spawn), reshape emission, focus opt-in, and executor-missing
// warnings.

import { describe, expect, test } from 'bun:test';

import {
  applyLayoutPlan,
  computeApplyActions,
  type LayoutApplyExecutor,
} from '../src/virtual-windows/layout/apply-planner.js';
import { leaf, split, type LayoutNode } from '../src/virtual-windows/layout-tree.js';
import type { RestorePlan } from '../src/virtual-windows/layout/restore-planner.js';

function mkPlan(binaryRoot: LayoutNode | null, extra: Partial<RestorePlan> = {}): RestorePlan {
  return {
    binaryRoot,
    missing: [],
    tabs: [],
    floats: [],
    notes: [],
    ...extra,
  };
}

function mkExecutor(overrides: LayoutApplyExecutor = {}): LayoutApplyExecutor & {
  calls: { kind: string; arg: unknown }[];
} {
  const calls: { kind: string; arg: unknown }[] = [];
  const rec = (kind: string) => (arg: unknown) => {
    calls.push({ kind, arg });
    return true;
  };
  return {
    closePane: overrides.closePane ?? rec('close'),
    spawnPane: overrides.spawnPane ?? rec('spawn'),
    setFocus: overrides.setFocus ?? rec('focus'),
    setLayoutTree: overrides.setLayoutTree ?? rec('reshape'),
    calls,
  };
}

// ── computeApplyActions ────────────────────────────────────────

describe('computeApplyActions · diff semantics', () => {
  test('close: pane in current not in plan → close action', () => {
    const plan = mkPlan(leaf('a'));
    const actions = computeApplyActions(plan, new Set(['a', 'orphan']));
    const close = actions.filter(a => a.kind === 'close');
    expect(close).toHaveLength(1);
    expect(close[0]).toEqual({ kind: 'close', paneId: 'orphan' });
  });

  test('spawn: leaf in plan not in current → spawn action w/ windowId', () => {
    const plan = mkPlan(split('h', leaf('a'), leaf('b')));
    const actions = computeApplyActions(plan, new Set(['a']), { windowId: 'w1' });
    const spawn = actions.filter(a => a.kind === 'spawn');
    expect(spawn).toHaveLength(1);
    expect(spawn[0]).toEqual({ kind: 'spawn', paneRef: { windowId: 'w1', paneId: 'b' } });
  });

  test('reshape emitted when plan has binaryRoot', () => {
    const root = leaf('a');
    const plan = mkPlan(root);
    const actions = computeApplyActions(plan, new Set(['a']));
    const reshape = actions.filter(a => a.kind === 'reshape');
    expect(reshape).toHaveLength(1);
    expect((reshape[0] as { binaryRoot: LayoutNode }).binaryRoot).toBe(root);
  });

  test('null binaryRoot → no spawn/reshape · close still fires', () => {
    const plan = mkPlan(null);
    const actions = computeApplyActions(plan, new Set(['gone']));
    expect(actions).toEqual([{ kind: 'close', paneId: 'gone' }]);
  });

  test('focusPaneId opt-in emits focus action', () => {
    const plan = mkPlan(leaf('a'));
    const actions = computeApplyActions(plan, new Set(['a']), { focusPaneId: 'a' });
    expect(actions.some(a => a.kind === 'focus' && a.paneId === 'a')).toBe(true);
  });
});

// ── applyLayoutPlan ────────────────────────────────────────────

describe('applyLayoutPlan · executor wiring', () => {
  test('full executor applies every action · applied = count', () => {
    const plan = mkPlan(split('v', leaf('a'), leaf('b')));
    const ex = mkExecutor();
    const result = applyLayoutPlan(plan, ex, {
      currentPaneIds: new Set(['a', 'orphan']),
      focusPaneId: 'a',
      windowId: 'w1',
    });
    expect(result.applied).toBe(4); // close orphan · spawn b · reshape · focus a
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(ex.calls.map(c => c.kind).sort()).toEqual(['close', 'focus', 'reshape', 'spawn']);
  });

  test('missing closePane executor → action skipped + warning', () => {
    const plan = mkPlan(leaf('a'));
    // Intentionally no closePane — only setLayoutTree so reshape fires.
    const ex: LayoutApplyExecutor = { setLayoutTree: () => true };
    const result = applyLayoutPlan(plan, ex, {
      currentPaneIds: new Set(['a', 'orphan']),
    });
    expect(result.skipped.some(a => a.kind === 'close')).toBe(true);
    expect(result.warnings.some(w => w.includes('no closePane'))).toBe(true);
    // Non-close actions still executed (reshape fires).
    expect(result.applied).toBe(1);
  });

  test('executor returning false → skipped + warning (not thrown)', () => {
    const plan = mkPlan(leaf('a'));
    const ex: LayoutApplyExecutor = {
      closePane: () => false,
      setLayoutTree: () => true,
    };
    const result = applyLayoutPlan(plan, ex, {
      currentPaneIds: new Set(['a', 'orphan']),
    });
    expect(result.skipped.some(a => a.kind === 'close' && a.paneId === 'orphan')).toBe(true);
    expect(result.warnings.some(w => w.includes('returned false'))).toBe(true);
    expect(result.applied).toBe(1); // reshape still ok
  });
});
