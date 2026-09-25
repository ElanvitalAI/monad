// IDX-F4 — `MONAD_BOUNDARY_CHECK=1` env-gated dev assertion in
// `coordinator.pushModal`. Verifies that:
//   • without the env var the check is silent (no perf impact)
//   • with the env var, missing-tier modals get logged
//   • with the env var, tier-ordering violations get logged
//   • valid stacks (compatible tier ordering) stay quiet
//
// We capture log lines via the `debug` module's tail buffer rather
// than monkey-patching console — the same instrumentation surface
// the production triage path uses.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { DisplayCoordinator, type DisplaySurface } from '../src/display/index.js';
import type { ModalTier } from '../src/display/types.js';
import { debug } from '../src/debug/log.js';

function modalSurface(id: string, tier?: ModalTier, focusable = true): DisplaySurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    ...(tier ? { tier } : {}),
    focusable,
    priority: 100,
    render: () => [],
  };
}

function harness() {
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { void fn; return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* noop */ },
  });
  return { coordinator };
}

let originalEnv: string | undefined;
let originalDebugEnabled: boolean;

beforeEach(() => {
  originalEnv = process.env.MONAD_BOUNDARY_CHECK;
  originalDebugEnabled = debug.enabled;
  debug.enable();
  debug.clear();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.MONAD_BOUNDARY_CHECK;
  else process.env.MONAD_BOUNDARY_CHECK = originalEnv;
  if (!originalDebugEnabled) debug.disable();
});

function tailContains(needle: string): boolean {
  return debug.tail(200).some(line => line.includes(needle));
}

describe('coordinator.pushModal — MONAD_BOUNDARY_CHECK=0/unset', () => {
  test('missing tier does not emit boundary-check logs (env unset)', () => {
    delete process.env.MONAD_BOUNDARY_CHECK;
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('untagged', undefined));
    expect(tailContains('window.boundaryCheck.missingTier')).toBe(false);
  });

  test('tier-violation does not emit logs (env unset)', () => {
    delete process.env.MONAD_BOUNDARY_CHECK;
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('top-dialog', 'dialog'));
    coordinator.pushModal(modalSurface('below-vw', 'vw'));   // would violate if checked
    expect(tailContains('window.boundaryCheck.tierViolation')).toBe(false);
  });
});

describe('coordinator.pushModal — MONAD_BOUNDARY_CHECK=1', () => {
  beforeEach(() => { process.env.MONAD_BOUNDARY_CHECK = '1'; });

  test('logs missingTier for an untagged modal', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('untagged', undefined));
    expect(tailContains('window.boundaryCheck.missingTier')).toBe(true);
  });

  test('does NOT log missingTier for a tagged modal', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('chat-picker', 'picker', false));
    expect(tailContains('window.boundaryCheck.missingTier')).toBe(false);
  });

  test('valid layering (vw → dialog → tooltip) stays quiet', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('vw-host', 'vw'));
    coordinator.pushModal(modalSurface('dialog-1', 'dialog'));
    coordinator.pushModal(modalSurface('hover', 'tooltip'));
    expect(tailContains('window.boundaryCheck.tierViolation')).toBe(false);
  });

  test('logs tierViolation when pushing below current top', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('top-dialog', 'dialog'));
    coordinator.pushModal(modalSurface('below-vw', 'vw'));
    expect(tailContains('window.boundaryCheck.tierViolation')).toBe(true);
  });

  test('same-tier stacking (e.g. nested menus) is legal', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modalSurface('menu-a', 'menu'));
    coordinator.pushModal(modalSurface('menu-b', 'menu'));
    expect(tailContains('window.boundaryCheck.tierViolation')).toBe(false);
  });
});
