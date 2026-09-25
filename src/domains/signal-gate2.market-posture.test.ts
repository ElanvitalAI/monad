import { describe, expect, test } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import {
  buildGate2Prompt,
  gate2AlertPriority,
  runGate2,
  type Gate2Classify,
  type Gate2Verdict,
} from './signal-gate2.js';
import type { MarketPosture } from './market-posture.js';

const posture = (defcon: MarketPosture['defcon']): MarketPosture => ({
  schemaVersion: 'market-posture/v2',
  asOf: '2026-07-16T00:00:00.000Z',
  defcon,
  response: { cadenceMultiplier: 1, depth: 'rules', alertMode: 'batch', emergencySweep: false, gate2HitlRequired: false },
  provenance: { calculatedBy: 'market-posture-cycle', sources: ['regime.db', 'capstone_regime.json'] },
  freshness: { status: 'FRESH', observedAt: '2026-07-16T00:00:00.000Z', ageMs: 0 },
  regime: { composite: 0, label: 'NEUTRAL', transition: false, transitionAxes: [], asOf: '2026-07-16T00:00:00.000Z' },
  leverage: { regime: 'BULL_1X', effectiveExposure: 1 },
});

const signal = (eventId: string, raw: string, proposedAction: string): Signal => ({
  eventId,
  source: 'market',
  observedAt: '2026-07-16T00:00:00.000Z',
  collectedAt: '2026-07-16T00:00:01.000Z',
  origin: 'fixture',
  trust: 1,
  severity: 'S3',
  proposedAction,
  raw,
});

describe('Gate2 market-posture context', () => {
  test('deep-review prompt carries DEFCON, provenance, freshness without a direction mandate', () => {
    const prompt = buildGate2Prompt(signal('defense', '급락 방어 신호', 'defensive review'), posture(2));
    expect(prompt).toContain('DEFCON: 2');
    expect(prompt).toContain('calculatedBy=market-posture-cycle');
    expect(prompt).toContain('sources=regime.db,capstone_regime.json');
    expect(prompt).toContain('freshness: FRESH');
    expect(prompt).toContain('must not force either direction');
    expect(prompt).toContain('new-buy freeze');
  });

  test('higher DEFCON increases review priority but leaves both HITL directions to the classifier', async () => {
    const pool = new SignalPool({ path: ':memory:' });
    try {
      pool.ingest(signal('defense', '급락 방어 검토', 'defensive review'));
      pool.ingest(signal('bargain', '과매도 저가매수 검토', 'low-price buy review'));
      const contexts: { defcon: number; priority: string }[] = [];
      const classify: Gate2Classify = async (s, context): Promise<Gate2Verdict> => {
        contexts.push({ defcon: context.posture!.defcon, priority: context.alertPriority });
        return s.eventId === 'defense'
          ? { confirmed: true, recommendation: 'adjust', relatedSectors: ['risk'], reason: 'defensive HITL review' }
          : { confirmed: true, recommendation: 'alert', relatedSectors: ['value'], reason: 'bargain-buy HITL review' };
      };
      const result = await runGate2(pool, { posture: posture(1), classify, now: () => '2026-07-16T00:01:00.000Z' });
      expect(result).toEqual({ judged: 2, confirmed: 2, falsePositive: 0 });
      expect(contexts).toEqual([{ defcon: 1, priority: 'urgent' }, { defcon: 1, priority: 'urgent' }]);
      expect(pool.listConfirmed().map(s => [s.eventId, s.recommendation]).sort()).toEqual([
        ['bargain', 'alert'], ['defense', 'adjust'],
      ]);
      // Gate2 records the existing HITL boundary only; it cannot directly execute either fixture.
      expect(pool.listPendingExec().map(s => s.eventId)).toEqual(['defense']);
      expect(pool.listConfirmed().every(s => s.execAt == null)).toBe(true);
    } finally { pool.close(); }
  });

  test('priority rises with DEFCON severity and never changes parser/verdict direction', () => {
    expect(gate2AlertPriority(posture(5))).toBe('routine');
    expect(gate2AlertPriority(posture(3))).toBe('elevated');
    expect(gate2AlertPriority(posture(1))).toBe('urgent');
    expect(gate2AlertPriority(null)).toBe('routine');
  });
});
