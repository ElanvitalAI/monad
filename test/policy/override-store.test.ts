// H6 P3 Bundle 1 · OverrideStore · 4-scope + throttle-bypass.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OverrideStore } from '../../src/policy/override-store';

function makeStore(tmp: string, opts: { now?: () => number; hasLocalLLM?: () => boolean } = {}) {
  return new OverrideStore({ storageDir: tmp, ...opts });
}

describe('OverrideStore · session-lock', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'policy-ov-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test('setSessionLock surfaces in getView()', () => {
    const s = makeStore(tmp);
    s.setSessionLock('claude', 'opus');
    expect(s.getView().sessionLock?.brand).toBe('claude');
    expect(s.getView().sessionLock?.model).toBe('opus');
  });

  test('clearSessionLock removes it', () => {
    const s = makeStore(tmp);
    s.setSessionLock('claude');
    s.clearSessionLock();
    expect(s.getView().sessionLock).toBeUndefined();
  });

  test('session-lock is NOT persisted to disk', () => {
    const a = makeStore(tmp);
    a.setSessionLock('claude');
    const b = makeStore(tmp);
    expect(b.getView().sessionLock).toBeUndefined();
  });

  test('invalid brand throws', () => {
    const s = makeStore(tmp);
    expect(() => s.setSessionLock('bogus' as 'claude')).toThrow();
  });
});

describe('OverrideStore · persistent-default', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'policy-ov-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test('setPersistentDefault persists across reload', () => {
    const a = makeStore(tmp);
    a.setPersistentDefault('claude', 'sonnet');
    const b = makeStore(tmp);
    expect(b.getView().persistentDefault?.brand).toBe('claude');
    expect(b.getView().persistentDefault?.model).toBe('sonnet');
  });

  test('local-llm default emits warning when hasLocalLLM=false', () => {
    const s = makeStore(tmp, { hasLocalLLM: () => false });
    const result = s.setPersistentDefault('local-llm');
    expect(result.localLLMWarning).toBe(true);
  });

  test('local-llm default suppresses warning when hasLocalLLM=true', () => {
    const s = makeStore(tmp, { hasLocalLLM: () => true });
    const result = s.setPersistentDefault('local-llm');
    expect(result.localLLMWarning).toBe(false);
  });

  test('clearPersistentDefault returns cleared=false when nothing set', () => {
    const s = makeStore(tmp);
    expect(s.clearPersistentDefault().cleared).toBe(false);
  });
});

describe('OverrideStore · throttle-bypass', () => {
  let tmp: string;
  const fixedNow = 1_700_000_000_000;
  const future = fixedNow + 60_000;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'policy-ov-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test('addThrottleBypass stores entry', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: future });
    expect(s.listThrottleBypasses()).toHaveLength(1);
  });

  test('hasActiveBypass matches brand+window+model', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: future });
    expect(s.hasActiveBypass('claude', 'weekly', 'opus')).toBe(true);
    expect(s.hasActiveBypass('claude', 'session', 'opus')).toBe(false);
    expect(s.hasActiveBypass('claude', 'weekly', 'sonnet')).toBe(false);
  });

  test('model-wildcard bypass matches any model on brand+window', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'codex', window: 'weekly', expiresAt: future });
    expect(s.hasActiveBypass('codex', 'weekly', 'gpt-5')).toBe(true);
    expect(s.hasActiveBypass('codex', 'weekly', 'gpt-5-mini')).toBe(true);
  });

  test('duplicate key collapses · latest wins', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: future });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: future + 1000, reason: 'renewed' });
    const list = s.listThrottleBypasses();
    expect(list).toHaveLength(1);
    expect(list[0]!.reason).toBe('renewed');
  });

  test('expired bypasses auto-prune on getView', () => {
    let t = fixedNow;
    const s = makeStore(tmp, { now: () => t });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: fixedNow + 1000 });
    t = fixedNow + 2000; // pass expiry
    expect(s.getView().throttleBypasses).toHaveLength(0);
  });

  test('expired bypasses pruned on reload', () => {
    let t = fixedNow;
    const a = makeStore(tmp, { now: () => t });
    a.addThrottleBypass({ brand: 'claude', window: 'weekly', expiresAt: fixedNow + 1000 });
    t = fixedNow + 2000;
    const b = makeStore(tmp, { now: () => t });
    expect(b.listThrottleBypasses()).toHaveLength(0);
  });

  test('rejects expiresAt in the past', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    expect(() => s.addThrottleBypass({ brand: 'claude', window: 'weekly', expiresAt: fixedNow - 1 })).toThrow();
  });

  test('clearThrottleBypasses removes all', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'claude', window: 'weekly', expiresAt: future });
    s.addThrottleBypass({ brand: 'codex', window: 'weekly', expiresAt: future });
    const n = s.clearThrottleBypasses();
    expect(n).toBe(2);
    expect(s.listThrottleBypasses()).toHaveLength(0);
  });

  test('persists bypasses to disk · atomic write', () => {
    const s = makeStore(tmp, { now: () => fixedNow });
    s.addThrottleBypass({ brand: 'claude', model: 'opus', window: 'weekly', expiresAt: future });
    expect(existsSync(join(tmp, 'overrides.json'))).toBe(true);
  });
});
