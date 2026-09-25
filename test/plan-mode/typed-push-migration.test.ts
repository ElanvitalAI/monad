// Phase B-3c pilot #3 — `dispatchExitPlanMode` migrated from
// `coord.pushModal(surface)` onto
// `coord.modalLifecycleAPI().push('plan-exit-modal', {...}, surface)`.
//
// Third caller migrated off the legacy pushModal path. Pattern
// identical to B-3c pilot #2 (ask-user-question · PR #305) — both
// share `approvalModalRouter` + single-active-prompt guard. Pins the
// typed-push contract so regressions that accidentally revert to
// `coord.pushModal` fail loudly.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { DisplayCoordinator } from '../../src/display/index.js';
import {
  dispatchExitPlanMode,
  setExitPlanModeDeps,
} from '../../src/plan-mode/tool-exit.js';
import {
  setPlanModeState,
  resetPlanModeState,
} from '../../src/plan-mode/session.js';
import { approvalModalRouter } from '../../src/approval-modal.js';

function harness() {
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { setTimeout(fn, 0); return 0 as unknown as NodeJS.Timer; },
    termSize: () => ({ rows: 30, cols: 120 }),
  });
  return { coordinator };
}

function activatePlanMode(): void {
  setPlanModeState({
    active: true,
    phase: 'plan',
    title: 'test plan',
    planFilePath: '/tmp/nonexistent-plan.md',
    sessionId: 'test-session',
    previousPolicy: { mode: 'default' },
  });
}

beforeEach(() => {
  setExitPlanModeDeps(null);
  approvalModalRouter._resetForTesting();
  resetPlanModeState();
});

afterEach(() => {
  setExitPlanModeDeps(null);
  approvalModalRouter._resetForTesting();
  resetPlanModeState();
});

describe('B-3c pilot #3 — dispatchExitPlanMode uses typed primitive push', () => {
  test('typed handle appears in modalLifecycleAPI().stackOrder with correct typeName', async () => {
    const { coordinator } = harness();
    setExitPlanModeDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });
    activatePlanMode();

    // Kick off dispatch without awaiting so we can inspect the
    // primitive stack mid-flight. `loadPlanArtifactFromPath` runs
    // first (async file read) then the push happens synchronously.
    const dispatchPromise = dispatchExitPlanMode({});

    // Let the file-read Promise resolve so the push path runs.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const order = coordinator.modalLifecycleAPI().stackOrder();
    const typed = order.find((h) => h.typeName === 'plan-exit-modal');

    expect(typed).toBeDefined();
    expect(typed!.tier).toBe('dialog');
    expect(typed!.key).toBe('plan-exit');
    expect(typed!.isDisposed()).toBe(false);

    // Close the modal so the promise resolves + test doesn't leak.
    typed!.dispose();
    await Promise.race([
      dispatchPromise,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  });

  test('disposing the typed handle triggers coord.closeSurface (B-3b reverse-wiring)', async () => {
    const { coordinator } = harness();
    setExitPlanModeDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });
    activatePlanMode();

    const dispatchPromise = dispatchExitPlanMode({});
    await new Promise((resolve) => setTimeout(resolve, 10));

    const handle = coordinator.modalLifecycleAPI()
      .stackOrder()
      .find((h) => h.typeName === 'plan-exit-modal');
    expect(handle).toBeDefined();

    const surfaceId = handle!.surface.id;
    expect(coordinator.surface(surfaceId)).not.toBeNull();

    handle!.dispose();

    // B-3b Part 2 reverse-wiring.
    expect(coordinator.surface(surfaceId)).toBeNull();
    expect(coordinator.focusManagerAPI().isRegistered(surfaceId)).toBe(false);

    await Promise.race([
      dispatchPromise,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  });

  test('plan mode inactive — dispatch short-circuits · no typed push', async () => {
    const { coordinator } = harness();
    setExitPlanModeDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });
    // Don't activate plan mode — tool should refuse.

    const result = await dispatchExitPlanMode({});
    expect(result.output).toContain('plan mode is not active');

    const order = coordinator.modalLifecycleAPI().stackOrder();
    const typed = order.find((h) => h.typeName === 'plan-exit-modal');
    expect(typed).toBeUndefined();
  });

  test('no-deps path — refuses without wiring · no typed push', async () => {
    // Intentionally leave deps null.
    activatePlanMode();
    const result = await dispatchExitPlanMode({});
    expect(result.output).toContain('TUI deps not wired');
  });
});
