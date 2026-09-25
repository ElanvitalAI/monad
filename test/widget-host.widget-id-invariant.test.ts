// ── WidgetHost widgetId invariant tests — Bundle 5W P3 (W-Identity-3) ──
//
// Contract documented in 내부 문서 `CAPABILITIES-widget-observation` §3.
// Pinning these invariants lets Phase W recorder + Phase L DescribeSurface
// tool rely on widgetId identity semantics without guarding each call.

import { describe, test, expect } from 'bun:test';
import { WidgetHost } from '../src/widgets/host.js';
import type { Widget } from '../src/widgets/types.js';

interface S { counter: number }

function makeHost(): WidgetHost {
  return new WidgetHost({ log: () => {}, requestRender: () => {} });
}

function makeWidget(type: string): Widget<S> {
  return {
    type,
    description: 'test widget',
    initialState: () => ({ counter: 0 }),
    render: () => [''],
  };
}

// ── Invariant 1 · Session-unique ────────────────────────

describe('widgetId invariants — session-unique', () => {
  test('100 sequential spawns of the same type yield 100 distinct ids', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(host.spawn({ type: 'alpha' }).id);
    }
    expect(ids.size).toBe(100);
  });

  test('spawns across different types keep id space disjoint', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    host.register(makeWidget('beta'));
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(host.spawn({ type: 'alpha' }).id);
      ids.add(host.spawn({ type: 'beta' }).id);
    }
    expect(ids.size).toBe(40);
  });
});

// ── Invariant 2 · Monotonic increment ────────────────────

describe('widgetId invariants — monotonic default id', () => {
  test('default ids follow <type>-N with N strictly increasing', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const a1 = host.spawn({ type: 'alpha' }).id;
    const a2 = host.spawn({ type: 'alpha' }).id;
    const a3 = host.spawn({ type: 'alpha' }).id;
    const n1 = Number(a1.split('-')[1]);
    const n2 = Number(a2.split('-')[1]);
    const n3 = Number(a3.split('-')[1]);
    expect(n1).toBeLessThan(n2);
    expect(n2).toBeLessThan(n3);
  });

  test('counter does not reset on dispose', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const a1 = host.spawn({ type: 'alpha' });
    host.dispose(a1.id);
    const a2 = host.spawn({ type: 'alpha' });
    expect(a2.id).not.toBe(a1.id);
    const n1 = Number(a1.id.split('-')[1]);
    const n2 = Number(a2.id.split('-')[1]);
    expect(n2).toBeGreaterThan(n1);
  });

  test('counter is shared across types (not per-type)', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    host.register(makeWidget('beta'));
    const a = host.spawn({ type: 'alpha' });
    const b = host.spawn({ type: 'beta' });
    const nA = Number(a.id.split('-')[1]);
    const nB = Number(b.id.split('-')[1]);
    expect(nB).toBeGreaterThan(nA);
  });
});

// ── Invariant 3 · Remount after dispose ≠ same id ────────

describe('widgetId invariants — remount yields new id', () => {
  test('dispose + spawn same type returns a different id', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const a1 = host.spawn({ type: 'alpha' });
    const origId = a1.id;
    host.dispose(origId);
    const a2 = host.spawn({ type: 'alpha' });
    expect(a2.id).not.toBe(origId);
  });

  test('even with 50 remount cycles, every cycle gets a fresh id', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const inst = host.spawn({ type: 'alpha' });
      expect(seen.has(inst.id)).toBe(false);
      seen.add(inst.id);
      host.dispose(inst.id);
    }
    expect(seen.size).toBe(50);
  });
});

// ── Invariant 4 · Explicit id override ───────────────────

describe('widgetId invariants — explicit id override', () => {
  test('spawn with explicit id uses it verbatim', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    const inst = host.spawn({ type: 'alpha', id: 'my-fixed-id' });
    expect(inst.id).toBe('my-fixed-id');
  });

  test('explicit id does not consume the nextInstanceSeq counter', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    host.spawn({ type: 'alpha', id: 'explicit-1' });
    host.spawn({ type: 'alpha', id: 'explicit-2' });
    const auto = host.spawn({ type: 'alpha' }).id;
    // Counter was at 0, so first default id has suffix -1 (not -3).
    expect(auto.endsWith('-1')).toBe(true);
  });
});

// ── Invariant 5 · id collision throws ────────────────────

describe('widgetId invariants — collision guard', () => {
  test('spawn with an already-taken id throws', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    host.spawn({ type: 'alpha', id: 'duplicate' });
    expect(() => host.spawn({ type: 'alpha', id: 'duplicate' }))
      .toThrow(/already exists/);
  });

  test('dispose clears the slot so the same explicit id can be reused', () => {
    const host = makeHost();
    host.register(makeWidget('alpha'));
    host.spawn({ type: 'alpha', id: 'slot-a' });
    host.dispose('slot-a');
    // After dispose the id is free — second spawn with same id succeeds.
    expect(() => host.spawn({ type: 'alpha', id: 'slot-a' })).not.toThrow();
  });
});
