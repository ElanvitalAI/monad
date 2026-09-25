import { describe, expect, test } from 'bun:test';

import { tryPillHitAtLineIndex } from '../src/log-pane/pill-click-dispatch.js';

interface FakeDebug {
  enabled: boolean;
  events: Array<{ category: string; msg: string; snap?: Record<string, unknown> }>;
}

function makeDebug(enabled = true): FakeDebug {
  return {
    enabled,
    events: [],
  };
}

function attach(debug: FakeDebug) {
  return {
    enabled: debug.enabled,
    log: (category: string, msg: string, snap?: Record<string, unknown>) => {
      debug.events.push({ category, msg, snap });
    },
  };
}

describe('tryPillHitAtLineIndex', () => {
  test('returns "no-pill" when pill row is null', () => {
    let clicks = 0;
    const out = tryPillHitAtLineIndex(5, {
      pillRowGetter: () => null,
      onPillClick: () => { clicks++; },
    });
    expect(out).toBe('no-pill');
    expect(clicks).toBe(0);
  });

  test('returns "no-pill" when click row does not match pill row', () => {
    let clicks = 0;
    const out = tryPillHitAtLineIndex(3, {
      pillRowGetter: () => 7,
      onPillClick: () => { clicks++; },
    });
    expect(out).toBe('no-pill');
    expect(clicks).toBe(0);
  });

  test('fires onPillClick + returns "opened" on row match', () => {
    let clicks = 0;
    const out = tryPillHitAtLineIndex(7, {
      pillRowGetter: () => 7,
      onPillClick: () => { clicks++; },
    });
    expect(out).toBe('opened');
    expect(clicks).toBe(1);
  });

  test('emits log-pane.pill-click when debug enabled + hit', () => {
    const debug = makeDebug(true);
    tryPillHitAtLineIndex(2, {
      pillRowGetter: () => 2,
      onPillClick: () => {},
      debug: attach(debug),
    });
    expect(debug.events).toHaveLength(1);
    expect(debug.events[0]!.category).toBe('log-pane.pill-click');
    expect(debug.events[0]!.snap).toEqual({ pillRow: 2 });
  });

  test('does not log when debug disabled', () => {
    const debug = makeDebug(false);
    tryPillHitAtLineIndex(2, {
      pillRowGetter: () => 2,
      onPillClick: () => {},
      debug: attach(debug),
    });
    expect(debug.events).toHaveLength(0);
  });

  test('does not log on miss', () => {
    const debug = makeDebug(true);
    tryPillHitAtLineIndex(5, {
      pillRowGetter: () => 9,
      onPillClick: () => {},
      debug: attach(debug),
    });
    expect(debug.events).toHaveLength(0);
  });

  test('row 0 is a valid pill index (not coerced as falsy)', () => {
    let clicks = 0;
    const out = tryPillHitAtLineIndex(0, {
      pillRowGetter: () => 0,
      onPillClick: () => { clicks++; },
    });
    expect(out).toBe('opened');
    expect(clicks).toBe(1);
  });
});
