// ── IDX-2a consumer: global-context-keys singleton + publishContextKey ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  OWNER_KEY_MAP,
  getGlobalContextKeyService,
  publishContextKey,
  resetGlobalContextKeysForTest,
} from '../src/input-core/global-context-keys';

beforeEach(() => {
  resetGlobalContextKeysForTest();
});

describe('publishContextKey — owner gate', () => {
  test('pfc owner publishes autoModeActive', () => {
    publishContextKey('autoModeActive', true, 'pfc');
    expect(getGlobalContextKeyService().keys.autoModeActive).toBe(true);
  });

  test('pfc owner rejects focusMode (input-owned)', () => {
    expect(() => publishContextKey('focusMode', 'input', 'pfc' as any)).toThrow(
      /owner "pfc" cannot write key "focusMode"/,
    );
  });

  test('test owner bypasses ownership (for fixtures)', () => {
    publishContextKey('focusMode', 'modal', 'test');
    expect(getGlobalContextKeyService().keys.focusMode).toBe('modal');
  });

  test('unknown owner throws', () => {
    expect(() => publishContextKey('autoModeActive', true, 'xxx' as any)).toThrow(
      /unknown owner "xxx"/,
    );
  });

  test('display owner publishes modalTopTier', () => {
    publishContextKey('modalTopTier', 'popup', 'display');
    expect(getGlobalContextKeyService().keys.modalTopTier).toBe('popup');
  });

  test('task owner is empty (TOX reserved) — any write rejected', () => {
    expect(() => publishContextKey('autoModeActive', true, 'task')).toThrow(
      /owner "task" cannot write key "autoModeActive"/,
    );
  });
});

describe('subscribe + equality + reset', () => {
  test('subscriber sees initial prime + subsequent change', () => {
    const svc = getGlobalContextKeyService();
    const calls: number[] = [];
    const dispose = svc.subscribe(() => {
      calls.push(svc.keys.autoModeActive ? 1 : 0);
    });
    publishContextKey('autoModeActive', true, 'pfc');
    publishContextKey('autoModeActive', true, 'pfc'); // equality no-op
    publishContextKey('autoModeActive', false, 'pfc');
    dispose();
    // Prime (false) + set true + set false = 3 calls; duplicate-true no-op
    expect(calls).toEqual([0, 1, 0]);
  });

  test('resetGlobalContextKeysForTest rebuilds singleton fresh', () => {
    publishContextKey('autoModeActive', true, 'pfc');
    expect(getGlobalContextKeyService().keys.autoModeActive).toBe(true);
    resetGlobalContextKeysForTest();
    expect(getGlobalContextKeyService().keys.autoModeActive).toBe(false);
  });

  test('OWNER_KEY_MAP has no duplicate ownership', () => {
    const seen = new Set<string>();
    for (const [owner, keys] of Object.entries(OWNER_KEY_MAP)) {
      if (owner === 'test') continue;
      for (const k of keys) {
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });
});

describe('subscriber fault isolation', () => {
  test('throwing subscriber does not break sibling subscribers', () => {
    const svc = getGlobalContextKeyService();
    let b = 0;
    svc.subscribe(() => { throw new Error('bad subscriber'); });
    const dispose = svc.subscribe(() => { b++; });
    publishContextKey('autoModeActive', true, 'pfc');
    dispose();
    expect(b).toBeGreaterThan(0);
  });
});
