// ── PFC-S3.1 P2: Andon LLM tools ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  dispatchEscalateSignal,
  buildEscalateSignalTool,
} from '../src/cft/tools/escalate-signal';
import {
  dispatchResolveEscalation,
  buildResolveEscalationTool,
} from '../src/cft/tools/resolve-escalation';
import {
  dispatchAndonList,
  buildAndonListTool,
} from '../src/cft/tools/andon-list';
import {
  clearAllEscalationsForTest,
} from '../src/cft/andon';

beforeEach(() => { clearAllEscalationsForTest(); });

describe('PFC-S3.1 P2 — EscalateSignal', () => {
  test('happy path — returns signal + output', async () => {
    const r = await dispatchEscalateSignal({
      agent_id: 'a1',
      severity: 'HIGH',
      reason: 'unexpected data shape',
    });
    expect(r.signal.severity).toBe('HIGH');
    expect(r.signal.agentId).toBe('a1');
    expect(r.output).toContain('[a1]');
    expect(r.output).toContain('HIGH');
  });

  test('CRITICAL notice flags preamble gating', async () => {
    const r = await dispatchEscalateSignal(
      { agent_id: 'a1', severity: 'CRITICAL', reason: 'source mismatch' },
      { skipObsidian: true },
    );
    expect(r.notices?.some(n => n.toLowerCase().includes('preamble'))).toBe(true);
  });

  test('invalid severity rejected', async () => {
    await expect(
      dispatchEscalateSignal({ agent_id: 'a1', severity: 'UHH' as any, reason: 'x' }),
    ).rejects.toThrow(/invalid severity/);
  });

  test('missing reason rejected', async () => {
    await expect(
      dispatchEscalateSignal({ agent_id: 'a1', severity: 'LOW', reason: '' }),
    ).rejects.toThrow(/reason is required/);
  });

  test('LLM tool spec shape', () => {
    const spec = buildEscalateSignalTool();
    expect(spec.name).toBe('EscalateSignal');
    const p = spec.parameters as Record<string, unknown>;
    expect(p.required).toEqual(['agent_id', 'severity', 'reason']);
  });
});

describe('PFC-S3.1 P2 — ResolveEscalation', () => {
  test('resolve unknown agent returns null resolved', async () => {
    const r = await dispatchResolveEscalation({ agent_id: 'nope' });
    expect(r.resolved).toBeNull();
    expect(r.output).toContain('no pending signal');
  });

  test('resolve known agent returns signal', async () => {
    await dispatchEscalateSignal({ agent_id: 'a1', severity: 'HIGH', reason: 'x' });
    const r = await dispatchResolveEscalation({ agent_id: 'a1' });
    expect(r.resolved?.agentId).toBe('a1');
    expect(r.output).toContain('HIGH cleared');
  });

  test('CRITICAL without resolution note gets notice', async () => {
    await dispatchEscalateSignal(
      { agent_id: 'a1', severity: 'CRITICAL', reason: 'x' },
      { skipObsidian: true },
    );
    const r = await dispatchResolveEscalation({ agent_id: 'a1' });
    expect(r.notices?.some(n => n.includes('A3 Report'))).toBe(true);
  });

  test('missing agent_id rejected', async () => {
    await expect(
      dispatchResolveEscalation({ agent_id: '' }),
    ).rejects.toThrow(/agent_id is required/);
  });

  test('LLM tool spec shape', () => {
    const spec = buildResolveEscalationTool();
    expect(spec.name).toBe('ResolveEscalation');
    const p = spec.parameters as Record<string, unknown>;
    expect(p.required).toEqual(['agent_id']);
  });
});

describe('PFC-S3.1 P2 — AndonList', () => {
  test('empty → zero counts + informative format', async () => {
    const r = await dispatchAndonList();
    expect(r.pending).toEqual([]);
    expect(r.criticalCount).toBe(0);
    expect(r.preamble).toBeNull();
    expect(r.format).toContain('no pending escalations');
  });

  test('after emits → pending list + preamble + format', async () => {
    await dispatchEscalateSignal({ agent_id: 'a1', severity: 'HIGH', reason: 'h' });
    await dispatchEscalateSignal(
      { agent_id: 'a2', severity: 'CRITICAL', reason: 'c' },
      { skipObsidian: true },
    );
    const r = await dispatchAndonList();
    expect(r.pending.length).toBe(2);
    expect(r.criticalCount).toBe(1);
    expect(r.highCount).toBe(1);
    expect(r.preamble).toContain('🔴 ANDON ESCALATION');
    expect(r.format).toContain('[CRITICAL]');
    expect(r.format).toContain('[HIGH]');
  });

  test('severity_filter narrows pending, keeps full counts', async () => {
    await dispatchEscalateSignal({ agent_id: 'a1', severity: 'HIGH', reason: 'h' });
    await dispatchEscalateSignal(
      { agent_id: 'a2', severity: 'CRITICAL', reason: 'c' },
      { skipObsidian: true },
    );
    const r = await dispatchAndonList({ severity_filter: 'CRITICAL' });
    expect(r.pending.length).toBe(1);
    expect(r.pending[0]?.severity).toBe('CRITICAL');
    expect(r.criticalCount).toBe(1);
    expect(r.highCount).toBe(1);
  });

  test('LLM tool spec shape', () => {
    const spec = buildAndonListTool();
    expect(spec.name).toBe('AndonList');
    const p = spec.parameters as Record<string, unknown>;
    const props = p.properties as Record<string, any>;
    expect(props.severity_filter?.enum).toContain('CRITICAL');
  });
});
