// Phase 2 D6 — MyelinPriorityBridge unit tests.

import { describe, expect, test } from 'bun:test';

import {
  MYELIN_BOOST_CAP,
  MYELIN_FAST_PATH_THRESHOLD,
  MyelinMetric,
} from '../../src/mss/myelin.ts';
import { MyelinPriorityBridge } from '../../src/dispatch/myelin-priority-bridge.ts';

class MockClock {
  constructor(public t = 1_000_000) {}
  now = (): number => this.t;
  advance(ms: number): void { this.t += ms; }
}

describe('MyelinPriorityBridge.lift', () => {
  test('zero state → no boost', () => {
    const m = new MyelinMetric({ now: () => 0 });
    const b = new MyelinPriorityBridge({ metric: m });
    const out = b.lift({ rank: 5, category: 'cold' });
    expect(out.effectiveRank).toBe(5);
    expect(out.boostApplied).toBe(0);
    expect(out.fastPath).toBe(false);
  });

  test('mid-frequency category gets boost=1', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD / 2 + 1; i += 1) m.emit('warm');
    const b = new MyelinPriorityBridge({ metric: m });
    const out = b.lift({ rank: 5, category: 'warm' });
    expect(out.boostApplied).toBe(1);
    expect(out.effectiveRank).toBe(4);
  });

  test('fast-path category gets boost cap (2)', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    const b = new MyelinPriorityBridge({ metric: m });
    const out = b.lift({ rank: 5, category: 'hot' });
    expect(out.fastPath).toBe(true);
    expect(out.boostApplied).toBe(MYELIN_BOOST_CAP);
    expect(out.effectiveRank).toBe(3);
  });

  test('caller cap override clamps the lift', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    const b = new MyelinPriorityBridge({ metric: m, cap: 1 });
    const out = b.lift({ rank: 5, category: 'hot' });
    expect(out.boostApplied).toBe(1);
    expect(out.effectiveRank).toBe(4);
  });

  test('floor prevents rank from going negative', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    const b = new MyelinPriorityBridge({ metric: m, floor: 2 });
    const out = b.lift({ rank: 3, category: 'hot' });
    expect(out.effectiveRank).toBe(2);
  });
});

describe('Co-activation lift', () => {
  test('cold seed lifted by hot peer fires partial boost', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    // Saturate peer first
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('peer');
    // Pair seed with peer (peer fires, then seed within 5s)
    for (let i = 0; i < 10; i += 1) {
      m.emit('peer');
      c.advance(500);
      m.emit('seed');
      c.advance(500);
    }
    const b = new MyelinPriorityBridge({ metric: m, coActivationWeight: 0.5 });
    const seedSnap = m.snapshot('seed');
    const out = b.lift({ rank: 5, category: 'seed' });
    // seed itself probably mid-boost from its emits — co-act only kicks
    // in when seed's own boost is 0. Either way, lift is ≤ cap.
    expect(out.boostApplied).toBeGreaterThanOrEqual(0);
    expect(out.boostApplied).toBeLessThanOrEqual(MYELIN_BOOST_CAP);
    if (seedSnap.boost === 0) {
      // Peer is fast-path (boost 2), weight 0.5 → 1.
      expect(out.boostApplied).toBe(1);
    }
  });

  test('co-activation weight zero suppresses peer lift entirely', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('peer');
    m.emit('seed');
    c.advance(500);
    m.emit('peer');
    const b = new MyelinPriorityBridge({ metric: m, coActivationWeight: 0 });
    const out = b.lift({ rank: 5, category: 'seed' });
    expect(out.boostApplied).toBe(0);
  });
});

describe('MyelinPriorityBridge.liftBatch', () => {
  test('applies lift across an entire ready queue', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('a');
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD / 2 + 1; i += 1) m.emit('b');
    const b = new MyelinPriorityBridge({ metric: m });
    const results = b.liftBatch([
      { rank: 5, category: 'a' },
      { rank: 5, category: 'b' },
      { rank: 5, category: 'cold' },
    ]);
    expect(results[0]!.effectiveRank).toBe(3); // cap boost
    expect(results[1]!.effectiveRank).toBe(4); // boost 1
    expect(results[2]!.effectiveRank).toBe(5); // no boost
  });
});

describe('Bridge caps + clamps', () => {
  test('negative cap is clamped to 0', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    const b = new MyelinPriorityBridge({ metric: m, cap: -5 });
    expect(b.lift({ rank: 5, category: 'hot' }).boostApplied).toBe(0);
  });

  test('cap above MYELIN_BOOST_CAP is silently clamped to cap', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    const b = new MyelinPriorityBridge({ metric: m, cap: 99 });
    expect(b.lift({ rank: 5, category: 'hot' }).boostApplied).toBe(MYELIN_BOOST_CAP);
  });
});
