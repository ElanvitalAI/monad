// ── Mission router · configProvider thunk guard (P1-FU1 · 2026-05-14) ──
//
// Closes the gap discovered during live daemon dogfood (FEATURE doc
// §C-3): `globalMissionRouter()` cached the boot-time config and
// ignored subsequent `monad config mission set …` edits — restart
// or not.
//
// Fix: createMissionRouter accepts a `configProvider` thunk invoked
// on every predict(). Static `config` form preserved for tests that
// want a frozen slice.

import { describe, expect, test } from 'bun:test';
import {
  createMissionRouter,
  globalMissionRouter,
  resetGlobalMissionRouter,
  type MissionRoutingConfig,
} from '../src/llm/mission-router';

describe('configProvider thunk · per-call reload', () => {
  test('thunk return change between predict calls reflects immediately', async () => {
    let live: MissionRoutingConfig | undefined = undefined;
    const router = createMissionRouter({
      configProvider: () => live,
    });

    // Default — built-in plan → claude
    const r1 = await router.predict({ text: 'plan the migration' });
    expect(r1.mission).toBe('plan');
    expect(r1.provider).toBe('claude');

    // User edits config externally — thunk now returns override
    live = {
      missions: { plan: { provider: 'gemini', model: 'gemini-3-pro' } },
    };
    const r2 = await router.predict({ text: 'plan the migration' });
    expect(r2.provider).toBe('gemini');
    expect(r2.model).toBe('gemini-3-pro');

    // User resets — thunk returns undefined again
    live = undefined;
    const r3 = await router.predict({ text: 'plan the migration' });
    expect(r3.provider).toBe('claude');
  });

  test('thunk throw degrades to static fallback (no exception leak)', async () => {
    const router = createMissionRouter({
      config: { missions: { plan: { provider: 'gemini' } } },
      configProvider: () => {
        throw new Error('config read failed');
      },
    });
    const r = await router.predict({ text: 'plan the migration' });
    // Static config still wins; predict completes without throwing.
    expect(r.provider).toBe('gemini');
  });

  test('thunk returning undefined falls back to built-in defaults', async () => {
    const router = createMissionRouter({
      configProvider: () => undefined,
    });
    const r = await router.predict({ text: 'plan the migration' });
    expect(r.provider).toBe('claude');
  });

  test('static config is preserved when configProvider absent (legacy path)', async () => {
    const router = createMissionRouter({
      config: { missions: { build: { provider: 'gemini' } } },
    });
    const r = await router.predict({ text: 'implement the new cache layer' });
    expect(r.provider).toBe('gemini');
  });
});

describe('globalMissionRouter · thunk vs static arg dispatch', () => {
  test('thunk form is recognized and threaded into createMissionRouter', async () => {
    resetGlobalMissionRouter();
    let live: MissionRoutingConfig | undefined = {
      missions: { plan: { provider: 'gemini' } },
    };
    const router = globalMissionRouter(() => live);
    const r1 = await router.predict({ text: 'plan the migration' });
    expect(r1.provider).toBe('gemini');

    live = undefined;
    const r2 = await router.predict({ text: 'plan the migration' });
    expect(r2.provider).toBe('claude');
    resetGlobalMissionRouter();
  });

  test('static-config form still works (legacy boot path)', async () => {
    resetGlobalMissionRouter();
    const router = globalMissionRouter({
      missions: { plan: { provider: 'gemini' } },
    });
    const r = await router.predict({ text: 'plan the migration' });
    expect(r.provider).toBe('gemini');
    resetGlobalMissionRouter();
  });
});
