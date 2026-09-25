// IDX-2b — Andon ↔ ContextKeys bridge.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { wireAndonContextBridge } from '../src/cft/andon-context-bridge.js';
import {
  emitEscalation,
  resolveEscalation,
  clearAllEscalationsForTest,
} from '../src/cft/andon.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';
import { __resetDashboardContextKeysForTests } from '../src/dashboard/context/keys.js';

beforeEach(() => {
  clearAllEscalationsForTest();
  __resetDashboardContextKeysForTests();
});
afterEach(() => {
  clearAllEscalationsForTest();
  __resetDashboardContextKeysForTests();
});

describe('wireAndonContextBridge', () => {
  test('seeds escalationPending=false when no critical pending', () => {
    const svc = createContextKeyService();
    wireAndonContextBridge(svc);
    expect(svc.keys.escalationPending).toBe(false);
  });

  test('emit CRITICAL → escalationPending=true', () => {
    const svc = createContextKeyService();
    wireAndonContextBridge(svc);

    emitEscalation({
      agentId: 'agent-a',
      severity: 'CRITICAL',
      reason: 'budget exhausted',
      context: 'eval loop',
    });
    expect(svc.keys.escalationPending).toBe(true);
  });

  test('emit non-CRITICAL does not flip the flag', () => {
    const svc = createContextKeyService();
    wireAndonContextBridge(svc);

    emitEscalation({
      agentId: 'agent-a',
      severity: 'HIGH',
      reason: 'slow turnaround',
      context: 'eval',
    });
    expect(svc.keys.escalationPending).toBe(false);
  });

  test('resolve clears escalationPending when no critical remains', () => {
    const svc = createContextKeyService();
    wireAndonContextBridge(svc);

    emitEscalation({ agentId: 'a', severity: 'CRITICAL', reason: 'r', context: 'c' });
    expect(svc.keys.escalationPending).toBe(true);

    resolveEscalation('a');
    expect(svc.keys.escalationPending).toBe(false);
  });

  test('resolve does not flip flag when other criticals pending', () => {
    const svc = createContextKeyService();
    wireAndonContextBridge(svc);

    emitEscalation({ agentId: 'a', severity: 'CRITICAL', reason: 'r1', context: 'c' });
    emitEscalation({ agentId: 'b', severity: 'CRITICAL', reason: 'r2', context: 'c' });
    expect(svc.keys.escalationPending).toBe(true);

    resolveEscalation('a');
    expect(svc.keys.escalationPending).toBe(true);   // 'b' still pending

    resolveEscalation('b');
    expect(svc.keys.escalationPending).toBe(false);
  });

  test('dispose stops updates', () => {
    const svc = createContextKeyService();
    const dispose = wireAndonContextBridge(svc);
    dispose();

    emitEscalation({ agentId: 'a', severity: 'CRITICAL', reason: 'r', context: 'c' });
    expect(svc.keys.escalationPending).toBe(false);   // subscriber is gone
  });
});
