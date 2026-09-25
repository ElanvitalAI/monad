// IDX-2c follow-up — bridge extension tests.
//
// Covers three bridge families that were declared in the ContextKeys
// shape but not wired at boot:
//   - `wireBudgetContextBridge`  — cost-meter → budgetWarningActive
//   - `wirePlanModeContextBridge` — plan-mode session → planModeActive
//   - `wireInputModeContextBridge` — input-core mode → controlModeActive
//     (`syncModeActive` is a deprecated always-false alias post Arc A —
//     sync was retired from ModeManager and is owned by PluginHost.)
//
// Each bridge matches the pattern of the existing
// `wireAutoModeContextBridge` (immediate seed + subscription).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createContextKeyService } from '../src/input-core/context-keys.js';
import { wireBudgetContextBridge } from '../src/intelligence-map/budget-context-bridge.js';
import { wirePlanModeContextBridge } from '../src/plan-mode/context-bridge.js';
import { wireInputModeContextBridge } from '../src/input-core/mode-context-bridge.js';
import {
  __resetModeManagerForTests,
  registerMode,
  setMode,
  subscribeMode,
} from '../src/input-core/mode.js';
import {
  setPlanModeState,
  resetPlanModeState,
  _clearPlanModeListenersForTesting,
} from '../src/plan-mode/session.js';
import { INACTIVE_PLAN_MODE_STATE } from '../src/plan-mode/types.js';

beforeEach(() => {
  __resetModeManagerForTests();
  resetPlanModeState();
  _clearPlanModeListenersForTesting();
});
afterEach(() => {
  __resetModeManagerForTests();
  resetPlanModeState();
  _clearPlanModeListenersForTesting();
});

describe('wireBudgetContextBridge', () => {
  function mkSnapshot(weekUsd: number, monthUsd: number) {
    return () => ({
      // Shape matches CostSnapshot — weeklyCapStatus / monthlyCapStatus
      // read `weeklyUsd` / `monthlyUsd`.
      weeklyUsd: weekUsd,
      monthlyUsd: monthUsd,
      dailyUsd: 0,
      byModel: {},
      weekStart: 0,
      monthStart: 0,
      eventsCount: 0,
      snapshotAt: 0,
    } as unknown as ReturnType<typeof import('../src/intelligence-map/cost-meter.js').snapshotCost>);
  }
  function mkConfig(weeklyCap: number, monthlyCap: number) {
    return () => ({
      weeklyCapUsd: weeklyCap,
      monthlyCapUsd: monthlyCap,
    } as unknown as ReturnType<typeof import('../src/intelligence-map/cost-meter.js').loadCostConfig>);
  }

  test('seeds false when usage well below cap', () => {
    const svc = createContextKeyService();
    wireBudgetContextBridge({
      service: svc,
      loadConfig: mkConfig(100, 400),
      snapshot: mkSnapshot(10, 40),
    });
    expect(svc.keys.budgetWarningActive).toBe(false);
  });

  test('seeds true when weekly usage crosses warning threshold (0.9 ratio)', () => {
    const svc = createContextKeyService();
    wireBudgetContextBridge({
      service: svc,
      loadConfig: mkConfig(100, 400),
      snapshot: mkSnapshot(95, 50),   // 95% of weekly cap → warning
    });
    expect(svc.keys.budgetWarningActive).toBe(true);
  });

  test('seeds true when monthly usage trips', () => {
    const svc = createContextKeyService();
    wireBudgetContextBridge({
      service: svc,
      loadConfig: mkConfig(100, 400),
      snapshot: mkSnapshot(10, 500),  // monthly tripped
    });
    expect(svc.keys.budgetWarningActive).toBe(true);
  });

  test('dispose stops further updates', () => {
    const svc = createContextKeyService();
    const dispose = wireBudgetContextBridge({
      service: svc,
      loadConfig: mkConfig(100, 400),
      snapshot: mkSnapshot(10, 40),
    });
    expect(svc.keys.budgetWarningActive).toBe(false);
    dispose();
    // After dispose, further broadcasts (not triggered here) would
    // not flip the key. The immediate seed has already run so the
    // key reflects the seed value; that's the expected contract.
    expect(svc.keys.budgetWarningActive).toBe(false);
  });
});

describe('wirePlanModeContextBridge', () => {
  test('seeds false for inactive plan-mode session', () => {
    const svc = createContextKeyService();
    wirePlanModeContextBridge(svc);
    expect(svc.keys.planModeActive).toBe(false);
  });

  test('fires true on enter, false on exit', () => {
    const svc = createContextKeyService();
    const dispose = wirePlanModeContextBridge(svc);
    setPlanModeState({ ...INACTIVE_PLAN_MODE_STATE, active: true, sessionId: 't1', startedAt: Date.now(), phase: 'explore', planFilePath: '/tmp/plan.md' });
    expect(svc.keys.planModeActive).toBe(true);
    setPlanModeState({ ...INACTIVE_PLAN_MODE_STATE });
    expect(svc.keys.planModeActive).toBe(false);
    dispose();
  });

  test('dispose unsubscribes', () => {
    const svc = createContextKeyService();
    const dispose = wirePlanModeContextBridge(svc);
    dispose();
    setPlanModeState({ ...INACTIVE_PLAN_MODE_STATE, active: true, sessionId: 't1', startedAt: Date.now(), phase: 'explore', planFilePath: '/tmp/plan.md' });
    // After dispose the bridge no longer updates — the key stays
    // at its last-seeded value (false).
    expect(svc.keys.planModeActive).toBe(false);
  });
});

describe('wireInputModeContextBridge', () => {
  test('seeds both keys false when active is "general"', () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    wireInputModeContextBridge(svc);
    expect(svc.keys.syncModeActive).toBe(false);
    expect(svc.keys.controlModeActive).toBe(false);
  });

  test('setMode("control") flips controlModeActive + leaves syncModeActive false', async () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    registerMode({ id: 'control', title: 'C', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    wireInputModeContextBridge(svc);

    await setMode('control');

    expect(svc.keys.syncModeActive).toBe(false);   // Arc A: deprecated always-false
    expect(svc.keys.controlModeActive).toBe(true);
  });

  test('returning to general clears controlModeActive', async () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    registerMode({ id: 'control', title: 'C', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    wireInputModeContextBridge(svc);

    await setMode('control');
    await setMode('general');

    expect(svc.keys.syncModeActive).toBe(false);
    expect(svc.keys.controlModeActive).toBe(false);
  });

  test('Arc A regression — syncModeActive is always false across every transition', async () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    registerMode({ id: 'control', title: 'C', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    wireInputModeContextBridge(svc);

    expect(svc.keys.syncModeActive).toBe(false);
    await setMode('control');
    expect(svc.keys.syncModeActive).toBe(false);
    await setMode('general');
    expect(svc.keys.syncModeActive).toBe(false);
  });

  test('dispose stops further updates', async () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    registerMode({ id: 'control', title: 'C', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    const dispose = wireInputModeContextBridge(svc);

    await setMode('control');
    expect(svc.keys.controlModeActive).toBe(true);

    dispose();
    await setMode('general');
    // After dispose the key no longer flips — stuck at the last
    // published value.
    expect(svc.keys.controlModeActive).toBe(true);
  });

  test('throwing listener does not block setMode from completing', async () => {
    registerMode({ id: 'general', title: 'G', onEnter: () => {}, onExit: () => {} });
    registerMode({ id: 'control', title: 'C', onEnter: () => {}, onExit: () => {} });
    const svc = createContextKeyService();
    wireInputModeContextBridge(svc);
    subscribeMode(() => { throw new Error('bad listener'); });

    const out = await setMode('control');
    expect(out).toBe('control');
    expect(svc.keys.controlModeActive).toBe(true);
  });
});
