import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator, type DisplaySurface } from '../src/display/index.js';
import type { ModalTier } from '../src/display/types.js';

/**
 * IDX-F1 — `coordinator.topOfTier(tier)` should find the top-most
 * surface with the matching tier label, independent of the legacy
 * per-subsystem singletons (`mouseWiring.activePopup`,
 * `terminalModalRouter.current()`, chat picker handle).
 *
 * These tests simulate the 2026-04-19 bug scenario: multiple modal
 * tiers stacked at once (picker + popup + terminal) and assert that
 * each can be located by tier without consulting other singletons.
 */

function modalSurface(id: string, tier: ModalTier, focusable = true): DisplaySurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    tier,
    focusable,
    priority: 100,
    render: () => [],
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* noop */ },
  });
  return { coordinator };
}

describe('coordinator.topOfTier', () => {
  test('returns null when no surface of the tier is mounted', () => {
    const { coordinator } = harness();
    expect(coordinator.topOfTier('popup')).toBeNull();
    expect(coordinator.topOfTier('terminal')).toBeNull();
    expect(coordinator.topOfTier('picker')).toBeNull();
  });

  test('returns the surface when a single tier member is mounted', () => {
    const { coordinator } = harness();
    const picker = modalSurface('chat:slash-picker:x1', 'picker', false);
    coordinator.pushModal(picker);
    expect(coordinator.topOfTier('picker')?.id).toBe('chat:slash-picker:x1');
    expect(coordinator.topOfTier('popup')).toBeNull();
  });

  test('independent tiers co-exist — picker + popup + terminal all locatable', () => {
    // The scenario F1 is specifically designed for: underlying chat
    // picker (paint-only) + pill popup (focusable) + interactive
    // terminal modal (focusable, highest priority) all on the stack.
    const { coordinator } = harness();
    const picker   = modalSurface('chat:slash-picker:x1', 'picker', false);
    const popup    = modalSurface('mx-popup:model',         'popup',    true);
    const terminal = modalSurface('terminal-modal:t1',      'terminal', true);

    coordinator.pushModal(picker);
    coordinator.pushModal(popup);
    coordinator.pushModal(terminal);

    expect(coordinator.topOfTier('picker')?.id).toBe('chat:slash-picker:x1');
    expect(coordinator.topOfTier('popup')?.id).toBe('mx-popup:model');
    expect(coordinator.topOfTier('terminal')?.id).toBe('terminal-modal:t1');
  });

  test('nested modals of the same tier return the topmost', () => {
    const { coordinator } = harness();
    const dlg1 = modalSurface('dialog:outer', 'dialog');
    const dlg2 = modalSurface('dialog:inner', 'dialog');
    coordinator.pushModal(dlg1);
    coordinator.pushModal(dlg2);
    expect(coordinator.topOfTier('dialog')?.id).toBe('dialog:inner');
  });

  test('ignores legacy surfaces that have not declared a tier', () => {
    // Pre-F1 modal surfaces exist without `tier` — they are invisible
    // to tier lookup. This is safe: lookups default to null, and the
    // caller fallback (checking singleton state) remains valid during
    // the migration.
    const { coordinator } = harness();
    const legacy: DisplaySurface = {
      id: 'legacy:modal', owner: 'dashboard', kind: 'modal',
      focus: 'owns', priority: 100, render: () => [],
      // no tier
    };
    coordinator.pushModal(legacy);
    expect(coordinator.topOfTier('popup')).toBeNull();
    expect(coordinator.topOfTier('dialog')).toBeNull();
  });

  test('pop removes surface from tier lookup', () => {
    const { coordinator } = harness();
    const popup = modalSurface('mx-popup:wd', 'popup');
    const { dispose } = coordinator.pushModal(popup);
    expect(coordinator.topOfTier('popup')?.id).toBe('mx-popup:wd');
    dispose();
    expect(coordinator.topOfTier('popup')).toBeNull();
  });
});
