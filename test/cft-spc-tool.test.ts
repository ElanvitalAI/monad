// ── PFC-S3.2 P2: EmitProcessHealth tool ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  buildEmitProcessHealthTool,
  dispatchEmitProcessHealth,
} from '../src/cft/tools/emit-process-health';
import { clearSpcForTest } from '../src/cft/spc';
import { clearAllEscalationsForTest, buildAndonPreamble } from '../src/cft/andon';

beforeEach(() => {
  clearSpcForTest();
  clearAllEscalationsForTest();
});

describe('EmitProcessHealth tool', () => {
  test('happy path records sample and returns stats', async () => {
    const r = await dispatchEmitProcessHealth(
      { series: 'latency', value: 100 },
      { skipObsidian: true },
    );
    expect(r.stats.n).toBe(1);
    expect(r.escalated).toBeUndefined();
    expect(r.output).toContain('latency');
  });

  test('outlier auto-escalates with MED severity by default', async () => {
    for (const v of [100, 102, 98, 101, 99]) {
      await dispatchEmitProcessHealth(
        { series: 'L', value: v },
        { skipObsidian: true },
      );
    }
    const r = await dispatchEmitProcessHealth(
      { series: 'L', value: 1000 },
      { skipObsidian: true },
    );
    expect(r.escalated).toBeDefined();
    expect(r.escalated!.severity).toBe('MED');
    expect(r.escalated!.agentId).toBe('spc:L');
  });

  test('auto_escalate=false suppresses escalation even on outlier', async () => {
    for (const v of [100, 102, 98, 101, 99]) {
      await dispatchEmitProcessHealth(
        { series: 'L', value: v },
        { skipObsidian: true },
      );
    }
    const r = await dispatchEmitProcessHealth(
      { series: 'L', value: 1000, auto_escalate: false },
      { skipObsidian: true },
    );
    expect(r.escalated).toBeUndefined();
    expect(r.notices).toBeDefined();
  });

  test('under-warm-up samples never escalate', async () => {
    const r1 = await dispatchEmitProcessHealth({ series: 'L', value: 1 }, { skipObsidian: true });
    const r2 = await dispatchEmitProcessHealth({ series: 'L', value: 10_000 }, { skipObsidian: true });
    expect(r1.escalated).toBeUndefined();
    expect(r2.escalated).toBeUndefined();
  });

  test('escalate_severity=CRITICAL forces Andon preamble', async () => {
    for (const v of [100, 102, 98, 101, 99]) {
      await dispatchEmitProcessHealth(
        { series: 'L', value: v },
        { skipObsidian: true },
      );
    }
    const r = await dispatchEmitProcessHealth(
      { series: 'L', value: 1000, escalate_severity: 'CRITICAL' },
      { skipObsidian: true },
    );
    expect(r.escalated).toBeDefined();
    expect(r.escalated!.severity).toBe('CRITICAL');
    const p = buildAndonPreamble();
    expect(p).not.toBeNull();
    expect(p).toContain('spc:L');
  });

  test('invalid value (NaN) throws', async () => {
    await expect(
      dispatchEmitProcessHealth({ series: 'L', value: NaN }, { skipObsidian: true }),
    ).rejects.toThrow();
  });

  test('invalid escalate_severity throws', async () => {
    await expect(
      dispatchEmitProcessHealth(
        { series: 'L', value: 1, escalate_severity: 'MAYBE' as any },
        { skipObsidian: true },
      ),
    ).rejects.toThrow();
  });

  test('tool spec shape — name + required', () => {
    const spec = buildEmitProcessHealthTool();
    expect(spec.name).toBe('EmitProcessHealth');
    expect(spec.parameters.required).toEqual(['series', 'value']);
  });
});
