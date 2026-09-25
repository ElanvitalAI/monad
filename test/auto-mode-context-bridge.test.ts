// IDX-2b — AutoMode ↔ ContextKeys bridge.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { wireAutoModeContextBridge } from '../src/auto-research/auto-mode/context-keys-bridge.js';
import {
  setAutoModeState,
  resetAutoModeForTest,
  generateAutoModeSessionId,
} from '../src/auto-research/auto-mode/session.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';
import { __resetDashboardContextKeysForTests } from '../src/dashboard/context/keys.js';

beforeEach(() => {
  resetAutoModeForTest();
  __resetDashboardContextKeysForTests();
});
afterEach(() => {
  resetAutoModeForTest();
  __resetDashboardContextKeysForTests();
});

describe('wireAutoModeContextBridge', () => {
  test('seeds autoModeActive=false when AutoMode inactive', () => {
    const svc = createContextKeyService();
    wireAutoModeContextBridge(svc);
    expect(svc.keys.autoModeActive).toBe(false);
  });

  test('seeds autoModeActive=true when AutoMode already active at install', () => {
    setAutoModeState({
      active: true,
      sessionId: generateAutoModeSessionId(),
      goalSlug: 'g',
      goalRoot: '/tmp',
      maxTurns: 5,
      turnIndex: 0,
      startedAt: Date.now(),
      terminationRuleJson: null,
      terminationRuleSource: null,
    } as never);
    const svc = createContextKeyService();
    wireAutoModeContextBridge(svc);
    expect(svc.keys.autoModeActive).toBe(true);
  });

  test('updates on setAutoModeState(active=true)', () => {
    const svc = createContextKeyService();
    wireAutoModeContextBridge(svc);
    expect(svc.keys.autoModeActive).toBe(false);

    setAutoModeState({
      active: true,
      sessionId: generateAutoModeSessionId(),
      goalSlug: 'g',
      goalRoot: '/tmp',
      maxTurns: 5,
      turnIndex: 0,
      startedAt: Date.now(),
      terminationRuleJson: null,
      terminationRuleSource: null,
    } as never);
    expect(svc.keys.autoModeActive).toBe(true);
  });

  test('updates on setAutoModeState(active=false)', () => {
    const svc = createContextKeyService();
    wireAutoModeContextBridge(svc);
    setAutoModeState({
      active: true,
      sessionId: 's',
      goalSlug: 'g',
      goalRoot: '/tmp',
      maxTurns: 5,
      turnIndex: 0,
      startedAt: Date.now(),
      terminationRuleJson: null,
      terminationRuleSource: null,
    } as never);
    expect(svc.keys.autoModeActive).toBe(true);

    setAutoModeState({ active: false } as never);
    expect(svc.keys.autoModeActive).toBe(false);
  });

  test('dispose stops updates', () => {
    const svc = createContextKeyService();
    const dispose = wireAutoModeContextBridge(svc);
    dispose();

    setAutoModeState({ active: true, sessionId: 's', goalSlug: 'g', goalRoot: '/tmp',
      maxTurns: 5, turnIndex: 0, startedAt: Date.now(),
      terminationRuleJson: null, terminationRuleSource: null } as never);
    expect(svc.keys.autoModeActive).toBe(false);   // no update
  });

  test('falls back to dashboard singleton when service omitted', async () => {
    const { getDashboardContextKeys } = await import('../src/dashboard/context/keys.js');
    wireAutoModeContextBridge();
    setAutoModeState({ active: true, sessionId: 's', goalSlug: 'g', goalRoot: '/tmp',
      maxTurns: 5, turnIndex: 0, startedAt: Date.now(),
      terminationRuleJson: null, terminationRuleSource: null } as never);
    expect(getDashboardContextKeys().autoModeActive).toBe(true);
  });
});
