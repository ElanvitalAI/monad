// ── VW-term-infra W1 wiring · pane-substrate-boot tests ──
//
// Lock in the single-import, idempotent, diagnose-able boot contract.
// The dashboard entry point calls initPaneSubstrate() once; additional
// consumers (Capture arc boot, test harnesses, re-entry paths) must
// observe the same factory instance.
//
// See: src/pane-substrate-boot.ts · 내부 문서 `PLAN-session-vw-term-infra-wiring` §6.3

import { afterEach, describe, expect, test } from 'bun:test';

import { getDefaultPaneFactory, __setDefaultPaneFactory } from '../src/panes/index.js';
import {
  __resetPaneSubstrateBoot,
  initPaneSubstrate,
  peekPaneSubstrateBoot,
} from '../src/pane-substrate-boot.js';

afterEach(() => {
  __resetPaneSubstrateBoot();
  __setDefaultPaneFactory(null);
});

describe('initPaneSubstrate', () => {
  test('first call materializes a boot handle with the default factory', () => {
    expect(peekPaneSubstrateBoot()).toBeNull();
    const boot = initPaneSubstrate();
    expect(boot.factory).toBe(getDefaultPaneFactory());
    expect(peekPaneSubstrateBoot()).toBe(boot);
  });

  test('second call returns the same handle (idempotent)', () => {
    const first = initPaneSubstrate();
    const second = initPaneSubstrate();
    expect(second).toBe(first);
    expect(second.factory).toBe(first.factory);
  });

  test('dispose resets the cached handle and factory cache', () => {
    const boot = initPaneSubstrate();
    // Seed cache with an opaque placeholder ref so we can assert reset.
    boot.factory.resolvePlaceholder({ windowId: 'w', paneId: 'p' }, 'empty');
    expect(boot.factory.cacheSize).toBe(1);
    boot.dispose();
    expect(peekPaneSubstrateBoot()).toBeNull();
    // Cache is cleared by reset().
    expect(boot.factory.cacheSize).toBe(0);
  });

  test('dispose is idempotent', () => {
    const boot = initPaneSubstrate();
    boot.dispose();
    expect(() => boot.dispose()).not.toThrow();
  });

  test('after dispose, a new init produces a fresh handle', () => {
    const first = initPaneSubstrate();
    first.dispose();
    const second = initPaneSubstrate();
    expect(second).not.toBe(first);
    // They share the singleton factory — getDefaultPaneFactory re-lazies.
    expect(second.factory).toBe(getDefaultPaneFactory());
  });
});
