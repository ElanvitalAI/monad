// MSS M3.4 / Phase 2 D0 — myelination metric tests.

import { describe, expect, test } from 'bun:test';

import {
  MYELIN_BOOST_CAP,
  MYELIN_FAST_PATH_THRESHOLD,
  MYELIN_WINDOW_MS,
  MyelinMetric,
} from '../../src/mss/myelin.ts';

class MockClock {
  constructor(public t = 1_000_000) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

describe('MyelinMetric.snapshot', () => {
  test('zero-state category returns count=0 / boost=0', () => {
    const m = new MyelinMetric({ now: () => 0 });
    const s = m.snapshot('pty.error');
    expect(s.count).toBe(0);
    expect(s.fastPath).toBe(false);
    expect(s.boost).toBe(0);
  });

  test('counts every emit inside the 1h window', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    for (let i = 0; i < 7; i += 1) {
      m.emit('llm.call');
      c.advance(1000);
    }
    const s = m.snapshot('llm.call');
    expect(s.count).toBe(7);
  });

  test('emits older than 1h are evicted', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('signal.x');
    c.advance(30 * 60 * 1000);
    m.emit('signal.x');
    expect(m.snapshot('signal.x').count).toBe(2);
    c.advance(MYELIN_WINDOW_MS); // total 1.5h after first emit, 1h after second
    expect(m.snapshot('signal.x').count).toBe(1);
  });

  test('boost ladder — below half = 0, between half and threshold = 1, ≥ threshold = cap', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD / 4; i += 1) m.emit('x');
    expect(m.snapshot('x').boost).toBe(0);

    const m2 = new MyelinMetric({ now: c.now });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD / 2 + 1; i += 1) m2.emit('y');
    expect(m2.snapshot('y').boost).toBe(1);

    const m3 = new MyelinMetric({ now: c.now });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD + 1; i += 1) m3.emit('z');
    const s = m3.snapshot('z');
    expect(s.fastPath).toBe(true);
    expect(s.boost).toBe(MYELIN_BOOST_CAP);
  });

  test('isFastPath + boostFor delegate to snapshot', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < MYELIN_FAST_PATH_THRESHOLD; i += 1) m.emit('hot');
    expect(m.isFastPath('hot')).toBe(true);
    expect(m.boostFor('hot')).toBe(MYELIN_BOOST_CAP);
  });
});

describe('MyelinMetric.top', () => {
  test('orders by emit count desc + caps at N', () => {
    const m = new MyelinMetric({ now: () => 0 });
    for (let i = 0; i < 5; i += 1) m.emit('a');
    for (let i = 0; i < 12; i += 1) m.emit('b');
    for (let i = 0; i < 3; i += 1) m.emit('c');
    const top2 = m.top(2);
    expect(top2.length).toBe(2);
    expect(top2[0]!.category).toBe('b');
    expect(top2[1]!.category).toBe('a');
  });
});

describe('MyelinMetric.coActivation', () => {
  test('two emits within window record a pair', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('alpha');
    c.advance(1000); // within COACTIVATION_WINDOW_MS
    m.emit('beta');
    const pairs = m.coActivatedWith('alpha');
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.b).toBe('beta');
    expect(pairs[0]!.count).toBe(1);
  });

  test('emits further than 5s apart do not pair', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('alpha');
    c.advance(10_000); // > 5s
    m.emit('beta');
    expect(m.coActivatedWith('alpha').length).toBe(0);
  });

  test('pair keys are symmetric (a/b same bucket as b/a)', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('a');
    c.advance(500);
    m.emit('b');
    c.advance(500);
    m.emit('a');
    c.advance(500);
    m.emit('b');
    const fromA = m.coActivatedWith('a');
    const fromB = m.coActivatedWith('b');
    expect(fromA.length).toBe(1);
    expect(fromB.length).toBe(1);
    expect(fromA[0]!.count).toBe(fromB[0]!.count);
  });

  test('heatmap exposes all pairs sorted', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    // a-b pair x 3
    for (let i = 0; i < 3; i += 1) {
      m.emit('a');
      c.advance(500);
      m.emit('b');
      c.advance(500);
    }
    // a-c pair x 1
    m.emit('a');
    c.advance(500);
    m.emit('c');
    const heat = m.coActivationHeatmap();
    expect(heat[0]!.count).toBeGreaterThan(heat[heat.length - 1]!.count);
  });
});

describe('MyelinMetric.categories / totalEmits', () => {
  test('categories list excludes expired ones', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('cold');
    c.advance(MYELIN_WINDOW_MS + 1);
    m.emit('warm');
    expect(m.categories()).toEqual(['warm']);
  });

  test('totalEmits sums live windows only', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('x');
    m.emit('x');
    m.emit('y');
    expect(m.totalEmits()).toBe(3);
    c.advance(MYELIN_WINDOW_MS + 1);
    expect(m.totalEmits()).toBe(0);
  });
});

describe('MyelinMetric.reset', () => {
  test('wipes both bucket + coactivation state', () => {
    const c = new MockClock();
    const m = new MyelinMetric({ now: c.now });
    m.emit('a');
    c.advance(500);
    m.emit('b');
    m.reset();
    expect(m.totalEmits()).toBe(0);
    expect(m.coActivationHeatmap().length).toBe(0);
  });
});
