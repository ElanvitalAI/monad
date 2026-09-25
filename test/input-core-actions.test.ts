import { afterEach, describe, expect, test } from 'bun:test';
import {
  registerAction,
  getAction,
  hasAction,
  listActions,
  isActionReserved,
  __resetActionRegistryForTests,
} from '../src/input-core/actions.js';

afterEach(() => __resetActionRegistryForTests());

describe('input-core actions — registry', () => {
  test('register + lookup', () => {
    let fired = 0;
    registerAction({
      id: 'test.noop',
      handler: () => { fired++; },
      description: 'no-op for tests',
    });
    expect(hasAction('test.noop')).toBe(true);
    const def = getAction('test.noop');
    expect(def?.id).toBe('test.noop');
    expect(def?.description).toBe('no-op for tests');
    // Handler fires on invocation.
    def?.handler();
    expect(fired).toBe(1);
  });

  test('missing action → null', () => {
    expect(getAction('nope.nothing')).toBeNull();
    expect(hasAction('nope.nothing')).toBe(false);
  });

  test('double registration throws unless allowOverwrite', () => {
    registerAction({ id: 'test.dup', handler: () => {} });
    expect(() => registerAction({ id: 'test.dup', handler: () => {} }))
      .toThrow(/already registered/);
    expect(() => registerAction({ id: 'test.dup', handler: () => {}, allowOverwrite: true }))
      .not.toThrow();
  });

  test('listActions returns sorted snapshot', () => {
    registerAction({ id: 'zeta.one', handler: () => {} });
    registerAction({ id: 'alpha.two', handler: () => {} });
    registerAction({ id: 'mu.three', handler: () => {} });
    const ids = listActions().map(a => a.id);
    expect(ids).toEqual(['alpha.two', 'mu.three', 'zeta.one']);
  });
});

describe('input-core actions — isActionReserved', () => {
  test('global reservations short-circuit the check', () => {
    // No need to register these — global list is authoritative.
    expect(isActionReserved('app.interrupt')).toBe(true);
    expect(isActionReserved('app.quit')).toBe(true);
    expect(isActionReserved('modal.cancel')).toBe(true);
    expect(isActionReserved('modal.submit')).toBe(true);
  });

  test('per-action reserved flag composes with global list', () => {
    registerAction({
      id: 'test.custom-reserved',
      handler: () => {},
      reserved: true,
    });
    expect(isActionReserved('test.custom-reserved')).toBe(true);
  });

  test('non-reserved action returns false', () => {
    registerAction({ id: 'test.free', handler: () => {} });
    expect(isActionReserved('test.free')).toBe(false);
  });

  test('unknown action → false (reservation gate is ADDITIVE, not default-deny)', () => {
    expect(isActionReserved('unknown.action')).toBe(false);
  });
});
