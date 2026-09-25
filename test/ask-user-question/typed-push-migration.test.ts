// Phase B-3c pilot #2 — `dispatchAskUserQuestion` migrated from
// `coord.pushModal(surface)` onto
// `coord.modalLifecycleAPI().push('ask-user-question-modal', {...}, surface)`.
//
// This test pins the typed-push contract on the tool's TUI path so
// regressions that accidentally revert to `coord.pushModal` (or swap
// the typeName to a generic mirror) fail loudly. Pattern mirrors the
// B-3b attachment popup pilot (PR #304): the caller's pre-existing
// control flow is unchanged; only the primitive push + dispose
// target shifts.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { DisplayCoordinator } from '../../src/display/index.js';
import {
  dispatchAskUserQuestion,
  setAskUserQuestionDeps,
  setAskUserQuestionResolver,
} from '../../src/ask-user-question/tool.js';
import { approvalModalRouter } from '../../src/approval-modal.js';
import { debug } from '../../src/debug/log.js';

function harness() {
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { setTimeout(fn, 0); return 0 as unknown as NodeJS.Timer; },
    termSize: () => ({ rows: 30, cols: 120 }),
  });
  return { coordinator };
}

const validRequest = {
  questions: [{
    id: 'q1',
    header: 'Pick one',
    question: 'Choose your option',
    options: [
      { label: 'Alpha', description: 'First option' },
      { label: 'Beta', description: 'Second option' },
    ],
  }],
};

beforeEach(() => {
  setAskUserQuestionDeps(null);
  setAskUserQuestionResolver(null);
  // approvalModalRouter is a singleton shared with approval-modal.
  // Clear any residual state left from prior tests.
  approvalModalRouter._resetForTesting();
});

afterEach(() => {
  setAskUserQuestionDeps(null);
  setAskUserQuestionResolver(null);
  approvalModalRouter._resetForTesting();
});

describe('B-3c pilot — dispatchAskUserQuestion uses typed primitive push', () => {
  test('typed handle appears in modalLifecycleAPI().stackOrder with correct typeName', async () => {
    const { coordinator } = harness();
    setAskUserQuestionDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });

    // Start the dispatch — it awaits modal.promise internally, so we
    // kick it off without awaiting and inspect primitive state
    // synchronously. Cleanup at the end completes the flow.
    const dispatchPromise = dispatchAskUserQuestion(validRequest);

    // Give the microtask queue a moment so the push has happened.
    await Promise.resolve();

    const order = coordinator.modalLifecycleAPI().stackOrder();
    const typed = order.find((h) => h.typeName === 'ask-user-question-modal');

    expect(typed).toBeDefined();
    expect(typed!.tier).toBe('dialog');
    expect(typed!.key).toBe('ask-user-question');
    expect(typed!.isDisposed()).toBe(false);

    // Complete the flow so the test doesn't leave dangling state:
    // dispose through the router (simulates user answer / cancel).
    typed!.dispose();
    // Cancel path surfaces via approvalModalRouter clearing → the
    // modal's promise rejects/resolves and dispatch returns. We only
    // await with a short timeout so a hung promise doesn't poison
    // the test runner.
    await Promise.race([
      dispatchPromise,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  });

  test('typed handle uses idempotencyKey "ask-user-question" (primitive replace works)', async () => {
    const { coordinator } = harness();
    setAskUserQuestionDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });

    // First dispatch; don't await.
    const first = dispatchAskUserQuestion(validRequest);
    await Promise.resolve();

    const firstHandle = coordinator.modalLifecycleAPI()
      .stackOrder()
      .find((h) => h.typeName === 'ask-user-question-modal');
    expect(firstHandle).toBeDefined();

    // ApprovalModalRouter blocks a second concurrent ask — verify the
    // rejected-concurrent-prompt branch still returns the structured
    // failure output. This pins that the router check runs AFTER the
    // primitive push (the early router path would call `modal.dispose`
    // + `disposePrimitive()` which also disposes our typed handle).
    const logs: Array<[string, string, Record<string, unknown>]> = [];
    const originalLog = debug.log;
    debug.log = ((category: string, event: string, data: Record<string, unknown>) => {
      logs.push([category, event, data]);
    }) as typeof debug.log;
    let second;
    try {
      second = await dispatchAskUserQuestion(validRequest);
    } finally {
      debug.log = originalLog;
    }
    expect(typeof second.output).toBe('string');
    expect(second.output).toContain('another approval/question is already open');
    expect(logs.at(-1)).toMatchObject([expect.any(String), 'end', { outcome: 'busy', elapsedMs: expect.any(Number) }]);

    // Cleanup first.
    firstHandle!.dispose();
    await Promise.race([
      first,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  });

  test('disposing the typed handle triggers coord.closeSurface (B-3b reverse-wiring)', async () => {
    const { coordinator } = harness();
    setAskUserQuestionDeps({
      coordinator,
      termSize: () => ({ rows: 30, cols: 120 }),
    });

    const dispatchPromise = dispatchAskUserQuestion(validRequest);
    await Promise.resolve();

    const handle = coordinator.modalLifecycleAPI()
      .stackOrder()
      .find((h) => h.typeName === 'ask-user-question-modal');
    expect(handle).toBeDefined();

    const surfaceId = handle!.surface.id;
    expect(coordinator.surface(surfaceId)).not.toBeNull();

    handle!.dispose();

    // B-3b Part 2 reverse-wiring: primitive disposed → coord closeSurface
    // → surface removed from coord.surfaces + focus manager unregistered.
    expect(coordinator.surface(surfaceId)).toBeNull();
    expect(coordinator.focusManagerAPI().isRegistered(surfaceId)).toBe(false);

    await Promise.race([
      dispatchPromise,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  });

  test('no-deps path — resolver-only — does NOT push typed handle', async () => {
    const { coordinator } = harness();
    // Intentionally leave deps null to exercise the resolver-only
    // branch. The typed push is deps-gated; verify no typed handle
    // leaks onto the primitive stack when the TUI path is skipped.
    setAskUserQuestionResolver(async () => ({
      answers: [{ questionId: 'q1', optionId: 'a' }],
    }));

    const result = await dispatchAskUserQuestion(validRequest);

    expect(typeof result.output).toBe('string');
    const order = coordinator.modalLifecycleAPI().stackOrder();
    const typed = order.find((h) => h.typeName === 'ask-user-question-modal');
    expect(typed).toBeUndefined();
  });
});
