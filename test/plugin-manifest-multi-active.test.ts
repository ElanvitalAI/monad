// ── PX-6 P1: manifest parser — allowMultiActive + activePeerCompat + resourceQuota ──

import { describe, test, expect } from 'bun:test';
import { parsePluginManifest } from '../src/plugins/core/manifest';

function base(fields: Record<string, unknown> = {}) {
  return parsePluginManifest({
    id: 'demo', name: 'Demo', version: '0.1.0',
    main: './plugin.ts', activationEvents: ['onStartup'],
    capabilities: [], contributes: {},
    ...fields,
  });
}

describe('PX-6 P1 — allowMultiActive', () => {
  test('omitted → undefined (backward compat)', () => {
    expect(base().allowMultiActive).toBeUndefined();
  });

  test('true parses through', () => {
    expect(base({ allowMultiActive: true }).allowMultiActive).toBe(true);
  });

  test('false parses through', () => {
    expect(base({ allowMultiActive: false }).allowMultiActive).toBe(false);
  });
});

describe('PX-6 P1 — activePeerCompat', () => {
  test('omitted → undefined', () => {
    expect(base().activePeerCompat).toBeUndefined();
  });

  test('allow + deny both parsed', () => {
    const m = base({
      activePeerCompat: { allow: ['a', 'b'], deny: ['c'] },
    });
    expect(m.activePeerCompat?.allow).toEqual(['a', 'b']);
    expect(m.activePeerCompat?.deny).toEqual(['c']);
  });

  test('empty arrays collapse to undefined field', () => {
    const m = base({
      activePeerCompat: { allow: [], deny: [] },
    });
    expect(m.activePeerCompat).toBeUndefined();
  });

  test('rejects non-object', () => {
    expect(() => base({ activePeerCompat: 'bad' })).toThrow(/object/);
  });

  test('filters non-string entries', () => {
    const m = base({
      activePeerCompat: { allow: ['good', 42, null, 'also-good'] },
    });
    expect(m.activePeerCompat?.allow).toEqual(['good', 'also-good']);
  });
});

describe('PX-6 P1 — resourceQuota', () => {
  test('omitted → undefined', () => {
    expect(base().resourceQuota).toBeUndefined();
  });

  test('integer axes parse + floor', () => {
    const m = base({
      resourceQuota: {
        ptySpawns: 4.9,
        concurrentSubagents: 2,
        tokensPerTurn: 100_000,
      },
    });
    expect(m.resourceQuota?.ptySpawns).toBe(4);
    expect(m.resourceQuota?.concurrentSubagents).toBe(2);
    expect(m.resourceQuota?.tokensPerTurn).toBe(100_000);
  });

  test('negative axis throws', () => {
    expect(() => base({ resourceQuota: { ptySpawns: -1 } }))
      .toThrow(/non-negative/);
  });

  test('non-number axis throws', () => {
    expect(() => base({ resourceQuota: { ptySpawns: 'inf' } }))
      .toThrow(/non-negative/);
  });

  test('empty quota object collapses to undefined', () => {
    expect(base({ resourceQuota: {} }).resourceQuota).toBeUndefined();
  });
});
