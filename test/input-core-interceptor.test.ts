// I.2.1 · InterceptorRegistry primitive module tests.
//
// Covers the 10 cases enumerated in
// 내부 문서 `PLAN-compositor-i2-interceptor-registry` §2 Phase I.2.1:
//   1. Empty registry → passthrough
//   2. Single consumed short-circuits
//   3. Single passthrough continues (chain empty after)
//   4. Priority ordering (100 > 50 > 10)
//   5. Duplicate name throws
//   6. Dispose allows re-register
//   7. Multiple entries · first consumed stops chain
//   8. size() reflects register + dispose
//   9. FIFO tie-break on equal priority
//  10. Non-key (mouse) event flows through interceptors
//      (interceptor can inspect type and passthrough for type-level
//      expansion readiness · Android parity)
//
// No dispatcher coupling — purely exercises the registry contract.

import { describe, expect, test } from 'bun:test';
import {
  createInterceptorRegistry,
  type KeyInterceptor,
} from '../src/input-core/interceptor.js';
import {
  derivePolicyForViewMode,
  type DispatchContext,
  type DispatchOutcome,
} from '../src/input-core/dispatcher.js';
import { keyEvent, type InputEvent, type KeyInputEvent, type MouseInputEvent } from '../src/input-core/event.js';
import type { ViewMode } from '../src/input-core/view-mode.js';

// ── Fixture helpers ────────────────────────────────────────────────

const VM_IDLE: ViewMode = { kind: 'idle' };

const k = (name: string): KeyInputEvent => keyEvent({ name, ctrl: false, shift: false });

const mouse = (): MouseInputEvent => ({
  kind: 'mouse',
  type: 'click',
  row: 0,
  col: 0,
  target: { kind: 'unknown' },
});

function mkCtx(): DispatchContext {
  return {
    viewMode: VM_IDLE,
    policy: derivePolicyForViewMode(VM_IDLE),
    routes: {},
  };
}

function recorder(
  name: string,
  priority: number,
  outcome: DispatchOutcome,
  log?: string[],
): KeyInterceptor {
  return {
    name,
    priority,
    intercept(_ev, _ctx) {
      log?.push(name);
      return outcome;
    },
  };
}

// ── Case 1 · empty registry → passthrough ──────────────────────────

describe('createInterceptorRegistry · empty chain', () => {
  test('run on empty registry returns passthrough', () => {
    const r = createInterceptorRegistry();
    expect(r.run(k('a'), mkCtx())).toBe('passthrough');
    expect(r.size()).toBe(0);
  });
});

// ── Case 2 · single consumed short-circuits ────────────────────────

describe('createInterceptorRegistry · single consumed', () => {
  test('sole consumed interceptor returns consumed', () => {
    const r = createInterceptorRegistry();
    r.register(recorder('a', 50, 'consumed'));
    expect(r.run(k('escape'), mkCtx())).toBe('consumed');
  });
});

// ── Case 3 · single passthrough ────────────────────────────────────

describe('createInterceptorRegistry · single passthrough', () => {
  test('sole passthrough interceptor returns passthrough', () => {
    const r = createInterceptorRegistry();
    const log: string[] = [];
    r.register(recorder('a', 50, 'passthrough', log));
    expect(r.run(k('x'), mkCtx())).toBe('passthrough');
    expect(log).toEqual(['a']);
  });
});

// ── Case 4 · priority ordering ─────────────────────────────────────

describe('createInterceptorRegistry · priority ordering', () => {
  test('higher priority runs first (100 > 50 > 10)', () => {
    const r = createInterceptorRegistry();
    const log: string[] = [];
    // Register in deliberately wrong order — registry must sort.
    r.register(recorder('lo', 10, 'passthrough', log));
    r.register(recorder('hi', 100, 'passthrough', log));
    r.register(recorder('mid', 50, 'passthrough', log));
    r.run(k('x'), mkCtx());
    expect(log).toEqual(['hi', 'mid', 'lo']);
  });
});

// ── Case 5 · duplicate name throws ─────────────────────────────────

describe('createInterceptorRegistry · duplicate name', () => {
  test('registering two interceptors with the same name throws', () => {
    const r = createInterceptorRegistry();
    r.register(recorder('dup', 50, 'passthrough'));
    expect(() => r.register(recorder('dup', 60, 'passthrough'))).toThrow(
      /duplicate interceptor name 'dup'/,
    );
  });
});

// ── Case 6 · dispose + re-register ─────────────────────────────────

describe('createInterceptorRegistry · dispose', () => {
  test('dispose removes the entry and permits re-register', () => {
    const r = createInterceptorRegistry();
    const dispose = r.register(recorder('a', 50, 'consumed'));
    expect(r.size()).toBe(1);
    dispose();
    expect(r.size()).toBe(0);
    expect(r.run(k('x'), mkCtx())).toBe('passthrough');
    // Re-register is now legal.
    r.register(recorder('a', 60, 'consumed'));
    expect(r.run(k('x'), mkCtx())).toBe('consumed');
  });

  test('dispose is idempotent', () => {
    const r = createInterceptorRegistry();
    const dispose = r.register(recorder('a', 50, 'passthrough'));
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(r.size()).toBe(0);
  });
});

// ── Case 7 · first consumed stops chain ────────────────────────────

describe('createInterceptorRegistry · short-circuit', () => {
  test('remaining interceptors are NOT called after first consumed', () => {
    const r = createInterceptorRegistry();
    const log: string[] = [];
    r.register(recorder('hi', 100, 'consumed', log));
    r.register(recorder('mid', 50, 'passthrough', log));
    r.register(recorder('lo', 10, 'passthrough', log));
    expect(r.run(k('escape'), mkCtx())).toBe('consumed');
    expect(log).toEqual(['hi']);
  });
});

// ── Case 8 · size() reflects register + dispose ────────────────────

describe('createInterceptorRegistry · size()', () => {
  test('size tracks register and dispose', () => {
    const r = createInterceptorRegistry();
    expect(r.size()).toBe(0);
    const d1 = r.register(recorder('a', 50, 'passthrough'));
    const d2 = r.register(recorder('b', 60, 'passthrough'));
    expect(r.size()).toBe(2);
    d1();
    expect(r.size()).toBe(1);
    d2();
    expect(r.size()).toBe(0);
  });
});

// ── Case 9 · FIFO tie-break ────────────────────────────────────────

describe('createInterceptorRegistry · tie-break', () => {
  test('equal priority preserves registration order (FIFO)', () => {
    const r = createInterceptorRegistry();
    const log: string[] = [];
    r.register(recorder('first', 50, 'passthrough', log));
    r.register(recorder('second', 50, 'passthrough', log));
    r.register(recorder('third', 50, 'passthrough', log));
    r.run(k('x'), mkCtx());
    expect(log).toEqual(['first', 'second', 'third']);
  });
});

// ── Case 10 · non-key (mouse) events ───────────────────────────────

describe('createInterceptorRegistry · non-key events', () => {
  test('mouse events flow through interceptors · interceptor can passthrough', () => {
    const r = createInterceptorRegistry();
    let sawMouse = false;
    const sniff: KeyInterceptor = {
      name: 'mouse-sniff',
      priority: 50,
      intercept(ev: InputEvent, _ctx) {
        if (ev.kind === 'mouse') sawMouse = true;
        return 'passthrough';
      },
    };
    r.register(sniff);
    expect(r.run(mouse(), mkCtx())).toBe('passthrough');
    expect(sawMouse).toBe(true);
  });

  test('mouse interceptor can consume (type-level extension readiness)', () => {
    const r = createInterceptorRegistry();
    const eater: KeyInterceptor = {
      name: 'mouse-eater',
      priority: 50,
      intercept(ev, _ctx) {
        return ev.kind === 'mouse' ? 'consumed' : 'passthrough';
      },
    };
    r.register(eater);
    expect(r.run(mouse(), mkCtx())).toBe('consumed');
    expect(r.run(k('x'), mkCtx())).toBe('passthrough');
  });
});
