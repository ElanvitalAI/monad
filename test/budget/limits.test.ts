// H6 P1 Bundle 2 · LimitsStore tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LimitsStore, validateLimitInput } from '../../src/budget/limits';

describe('LimitsStore · effective resolution', () => {
  let tmp: string;
  let store: LimitsStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'limits-'));
    store = new LimitsStore({ storageDir: tmp, now: () => 1_000 });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('returns brand default when no user override', () => {
    const lim = store.getEffective('codex', 'session');
    expect(lim).toBeDefined();
    expect(lim?.source).toBe('brand-default');
    expect(lim?.quota).toBe(100);
  });

  test('user override wins over brand default', () => {
    store.setUserLimit({ brand: 'codex', window: 'session', quota: 50 });
    const lim = store.getEffective('codex', 'session');
    expect(lim?.source).toBe('user-config');
    expect(lim?.quota).toBe(50);
  });

  test('model-specific user override takes precedence over brand-level default', () => {
    store.setUserLimit({ brand: 'claude', window: 'weekly', model: 'opus', quota: 75 });
    const opus = store.getEffective('claude', 'weekly', 'opus');
    expect(opus?.quota).toBe(75);
    expect(opus?.model).toBe('opus');
    // Unmodeled query falls back to brand default.
    const aggregate = store.getEffective('claude', 'weekly');
    expect(aggregate?.source).toBe('brand-default');
  });

  test('model query falls back to brand-level user limit when no model-specific override', () => {
    store.setUserLimit({ brand: 'codex', window: 'weekly', quota: 60 });
    const haiku = store.getEffective('codex', 'weekly', 'gpt-5-mini');
    expect(haiku?.source).toBe('user-config');
    expect(haiku?.quota).toBe(60);
  });

  test('local-llm has Infinity brand default', () => {
    const lim = store.getEffective('local-llm', 'session');
    expect(lim?.quota).toBe(Number.POSITIVE_INFINITY);
  });

  test('clearUserLimit reverts to brand default', () => {
    store.setUserLimit({ brand: 'codex', window: 'session', quota: 50 });
    expect(store.getEffective('codex', 'session')?.quota).toBe(50);
    store.clearUserLimit('codex', 'session');
    expect(store.getEffective('codex', 'session')?.source).toBe('brand-default');
  });
});

describe('LimitsStore · persistence', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'limits-persist-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('user limit round-trips through disk', () => {
    const a = new LimitsStore({ storageDir: tmp, now: () => 1_000 });
    a.setUserLimit({ brand: 'claude', window: 'weekly', quota: 90 });
    expect(existsSync(join(tmp, 'limits.json'))).toBe(true);

    const b = new LimitsStore({ storageDir: tmp, now: () => 2_000 });
    const lim = b.getEffective('claude', 'weekly');
    expect(lim?.source).toBe('user-config');
    expect(lim?.quota).toBe(90);
  });
});

describe('validateLimitInput', () => {
  test('accepts a well-formed input', () => {
    expect(
      validateLimitInput({ brand: 'codex', window: 'session', quota: 75 }),
    ).toBeNull();
  });

  test('rejects unknown brand', () => {
    const err = validateLimitInput({ brand: 'openai', window: 'session', quota: 50 });
    expect(err?.field).toBe('brand');
  });

  test('rejects negative quota', () => {
    const err = validateLimitInput({ brand: 'codex', window: 'session', quota: -1 });
    expect(err?.field).toBe('quota');
  });

  test('accepts Infinity quota for unlimited', () => {
    expect(
      validateLimitInput({ brand: 'local-llm', window: 'session', quota: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });
});
