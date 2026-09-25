// ── PFC-S3.2 P3: CFT SPC ToolRuntime registration ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  ALL_CFT_SPC_RUNTIMES,
  emitProcessHealthRuntime,
} from '../src/tool-runtime/cft-spc-runtimes';
import {
  dispatchToolByName,
  getToolRuntime,
  registerToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';
import { clearSpcForTest } from '../src/cft/spc';
import { clearAllEscalationsForTest } from '../src/cft/andon';

describe('PFC-S3.2 P3 — CFT SPC ToolRuntime registration', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    clearSpcForTest();
    clearAllEscalationsForTest();
  });

  test('ALL_CFT_SPC_RUNTIMES has 1 unique id', () => {
    expect(ALL_CFT_SPC_RUNTIMES.length).toBe(1);
    expect(ALL_CFT_SPC_RUNTIMES[0]!.id).toBe('emit_process_health');
    expect(emitProcessHealthRuntime.spec.name).toBe('EmitProcessHealth');
  });

  test('registration idempotent', () => {
    for (const rt of ALL_CFT_SPC_RUNTIMES) registerToolRuntime(rt);
    for (const rt of ALL_CFT_SPC_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('emit_process_health')).toBeDefined();
  });

  test('dispatchToolByName routes through SPC runtime end-to-end', async () => {
    for (const rt of ALL_CFT_SPC_RUNTIMES) registerToolRuntime(rt);

    const r = await dispatchToolByName(
      'emit_process_health',
      { series: 'rt-latency', value: 42 },
      { surface: 'skill' },
    );
    expect((r as any).stats?.series).toBe('rt-latency');
    expect((r as any).stats?.n).toBe(1);
  });
});
