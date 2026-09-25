// ── PFC-S3.1 P3: CFT Andon ToolRuntime registration ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ALL_CFT_ANDON_RUNTIMES,
  escalateSignalRuntime,
  resolveEscalationRuntime,
  andonListRuntime,
} from '../src/tool-runtime/cft-andon-runtimes';
import {
  registerToolRuntime,
  getToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';
import { clearAllEscalationsForTest } from '../src/cft/andon';

describe('PFC-S3.1 P3 — CFT Andon ToolRuntime registration', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    clearAllEscalationsForTest();
  });

  test('ALL_CFT_ANDON_RUNTIMES has 3 unique ids', () => {
    expect(ALL_CFT_ANDON_RUNTIMES.length).toBe(3);
    const ids = ALL_CFT_ANDON_RUNTIMES.map(rt => rt.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['escalate_signal', 'resolve_escalation', 'andon_list']);
  });

  test('each runtime exposes matching spec name', () => {
    expect(escalateSignalRuntime.spec.name).toBe('EscalateSignal');
    expect(resolveEscalationRuntime.spec.name).toBe('ResolveEscalation');
    expect(andonListRuntime.spec.name).toBe('AndonList');
  });

  test('registration idempotent', () => {
    for (const rt of ALL_CFT_ANDON_RUNTIMES) registerToolRuntime(rt);
    for (const rt of ALL_CFT_ANDON_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('escalate_signal')).toBeDefined();
    expect(getToolRuntime('resolve_escalation')).toBeDefined();
    expect(getToolRuntime('andon_list')).toBeDefined();
  });

  test('dispatchToolByName routes through Andon runtimes end-to-end', async () => {
    for (const rt of ALL_CFT_ANDON_RUNTIMES) registerToolRuntime(rt);

    const emit = await dispatchToolByName(
      'escalate_signal',
      { agent_id: 'rt-1', severity: 'HIGH', reason: 'test' },
      { surface: 'skill' },
    );
    expect((emit as any).signal?.agentId).toBe('rt-1');

    const list = await dispatchToolByName('andon_list', {}, { surface: 'skill' });
    expect((list as any).pending?.length).toBe(1);
    expect((list as any).highCount).toBe(1);

    const resolved = await dispatchToolByName(
      'resolve_escalation',
      { agent_id: 'rt-1' },
      { surface: 'skill' },
    );
    expect((resolved as any).resolved?.agentId).toBe('rt-1');

    const after = await dispatchToolByName('andon_list', {}, { surface: 'skill' });
    expect((after as any).pending?.length).toBe(0);
  });
});
