// ── PFC-S3.1: Andon core ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitEscalation,
  resolveEscalation,
  listEscalations,
  hasPendingCritical,
  getPendingCriticalSignals,
  countsBySeverity,
  buildAndonListResult,
  buildAndonPreamble,
  subscribeAndon,
  clearAllEscalationsForTest,
  type EscalationSignal,
} from '../src/cft/andon';
import { NotificationStore } from '../src/notifications/store';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';

describe('PFC-S3.1 — Andon core', () => {
  beforeEach(() => { clearAllEscalationsForTest(); });

  test('emitEscalation LOW adds to list', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'LOW', reason: 'slow' });
    expect(listEscalations().length).toBe(1);
    expect(listEscalations()[0]?.severity).toBe('LOW');
  });

  test('emit CRITICAL → hasPendingCritical true', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'CRITICAL', reason: 'source mismatch' });
    expect(hasPendingCritical()).toBe(true);
    expect(getPendingCriticalSignals().length).toBe(1);
  });

  test('emit same agentId replaces latest severity', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'LOW', reason: 'first' });
    await emitEscalation({ agentId: 'a1', severity: 'CRITICAL', reason: 'second' });
    const list = listEscalations();
    expect(list.length).toBe(1);
    expect(list[0]?.severity).toBe('CRITICAL');
    expect(list[0]?.reason).toBe('second');
  });

  test('resolveEscalation removes from state', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'HIGH', reason: 'x' });
    const resolved = resolveEscalation('a1');
    expect(resolved?.agentId).toBe('a1');
    expect(listEscalations().length).toBe(0);
  });

  test('resolveEscalation unknown agent → null', () => {
    expect(resolveEscalation('nope')).toBeNull();
  });

  test('buildAndonPreamble null when no CRITICAL', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'HIGH', reason: 'x' });
    expect(buildAndonPreamble()).toBeNull();
  });

  test('buildAndonPreamble text includes CRITICAL only', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'HIGH', reason: 'high-issue' });
    await emitEscalation({ agentId: 'a2', severity: 'CRITICAL', reason: 'crit-issue', context: 'details here' });
    const text = buildAndonPreamble();
    expect(text).toContain('🔴 ANDON ESCALATION');
    expect(text).toContain('[a2]');
    expect(text).toContain('crit-issue');
    expect(text).toContain('details here');
    expect(text).not.toContain('high-issue');
    expect(text).not.toContain('[a1]');
  });

  test('invalid severity throws', async () => {
    await expect(
      emitEscalation({ agentId: 'a1', severity: 'WHATEVER' as any, reason: 'x' }),
    ).rejects.toThrow(/invalid severity/);
  });

  test('empty reason throws', async () => {
    await expect(
      emitEscalation({ agentId: 'a1', severity: 'LOW', reason: '' }),
    ).rejects.toThrow(/reason is required/);
  });

  test('empty agentId throws', async () => {
    await expect(
      emitEscalation({ agentId: '  ', severity: 'LOW', reason: 'x' }),
    ).rejects.toThrow(/agentId is required/);
  });

  test('subscribeAndon callback fires on emit + resolve', async () => {
    const events: Array<{ agentId: string; kind: string }> = [];
    const unsub = subscribeAndon((s, kind) => events.push({ agentId: s.agentId, kind }));
    await emitEscalation({ agentId: 'a1', severity: 'MED', reason: 'x' });
    resolveEscalation('a1');
    expect(events.length).toBe(2);
    expect(events[0]?.kind).toBe('emit');
    expect(events[1]?.kind).toBe('resolve');
    unsub();
  });

  test('notificationStore push on emit + resolve', async () => {
    const store = new NotificationStore();
    await emitEscalation(
      { agentId: 'a1', severity: 'HIGH', reason: 'x' },
      { notificationStore: store },
    );
    resolveEscalation('a1', { notificationStore: store });
    const events = store.list('cft-andon');
    expect(events.length).toBe(2);
    expect(events[0]?.kind).toBe('escalation');
    expect(events[0]?.title).toContain('HIGH');
    expect(events[1]?.title).toContain('resolved');
  });

  test('Obsidian incident artifact written for CRITICAL', async () => {
    const home = mkdtempSync(join(tmpdir(), 'andon-obs-'));
    const vault = discoverObsidianVault({
      env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    const signal = await emitEscalation(
      { agentId: 'expert-e2', severity: 'CRITICAL', reason: 'source mismatch', context: 'TrendForce != DigiTimes' },
      { vault, now: 1_700_000_000_000 },
    );
    expect(signal.incidentPath).toBeDefined();
    expect(existsSync(signal.incidentPath!)).toBe(true);
    const body = readFileSync(signal.incidentPath!, 'utf-8');
    expect(body).toContain('severity: CRITICAL');
    expect(body).toContain('source mismatch');
    expect(body).toContain('TrendForce != DigiTimes');
  });

  test('Obsidian incident skipped for non-CRITICAL', async () => {
    const home = mkdtempSync(join(tmpdir(), 'andon-obs-low-'));
    const vault = discoverObsidianVault({
      env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    const signal = await emitEscalation(
      { agentId: 'a1', severity: 'LOW', reason: 'minor' },
      { vault },
    );
    expect(signal.incidentPath).toBeUndefined();
  });

  test('countsBySeverity aggregates all 4 tiers', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'CRITICAL', reason: '1' });
    await emitEscalation({ agentId: 'a2', severity: 'CRITICAL', reason: '2' });
    await emitEscalation({ agentId: 'a3', severity: 'HIGH', reason: '3' });
    await emitEscalation({ agentId: 'a4', severity: 'MED', reason: '4' });
    await emitEscalation({ agentId: 'a5', severity: 'LOW', reason: '5' });
    const counts = countsBySeverity();
    expect(counts.criticalCount).toBe(2);
    expect(counts.highCount).toBe(1);
    expect(counts.medCount).toBe(1);
    expect(counts.lowCount).toBe(1);
  });

  test('buildAndonListResult with filter returns only matching', async () => {
    await emitEscalation({ agentId: 'a1', severity: 'HIGH', reason: '1' });
    await emitEscalation({ agentId: 'a2', severity: 'LOW', reason: '2' });
    const res = buildAndonListResult({ severity: 'HIGH' });
    expect(res.pending.length).toBe(1);
    expect(res.pending[0]?.severity).toBe('HIGH');
    expect(res.highCount).toBe(1);   // counts reflect full state
    expect(res.lowCount).toBe(1);
  });
});
