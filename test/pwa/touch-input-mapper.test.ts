// ── D (Phase 3 Bundle 2) — touch-input-mapper tests ──

import { describe, expect, test } from 'bun:test';
import {
  initialTouchState,
  processTouchEvent,
  type TouchEvent,
  type TouchSurfaceContext,
} from '../../src/pwa/touch-input-mapper';

const CTX: TouchSurfaceContext = {
  surfaceId: 'pane-1',
  paneKind: 'preview-terminal',
  exposure: { userExposure: 'observe-only', agentInteractive: true },
  capability: { canRead: true, canInterrupt: true, canWrite: false, canInspect: true },
  pixelToCell: (x, y) => ({ row: Math.floor(y / 20), col: Math.floor(x / 10) }),
};

function ev(opts: {
  phase: TouchEvent['phase'];
  x?: number;
  y?: number;
  ts: number;
}): TouchEvent {
  return {
    phase: opts.phase,
    touches: opts.x !== undefined && opts.y !== undefined
      ? [{ clientX: opts.x, clientY: opts.y, identifier: 1 }]
      : [],
    timestamp: opts.ts,
  };
}

describe('processTouchEvent — single tap', () => {
  test('start → end (short, no move) → caret-focus', () => {
    let state = initialTouchState;
    let r = processTouchEvent(ev({ phase: 'start', x: 100, y: 200, ts: 0 }), state, CTX);
    expect(r.intent).toBeNull();
    state = r.nextState;

    r = processTouchEvent(ev({ phase: 'end', ts: 100 }), state, CTX);
    expect(r.intent?.kind).toBe('caret-focus');
    expect(r.intent?.row).toBe(10); // y=200/20
    expect(r.intent?.col).toBe(10); // x=100/10
  });
});

describe('processTouchEvent — double tap', () => {
  test('two single-taps within DOUBLE_TAP_WINDOW → word-select', () => {
    let state = initialTouchState;
    // First tap
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    let r = processTouchEvent(ev({ phase: 'end', ts: 100 }), state, CTX);
    expect(r.intent?.kind).toBe('caret-focus');
    state = r.nextState;
    // Second tap within window (300ms)
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 200 }), state, CTX).nextState;
    r = processTouchEvent(ev({ phase: 'end', ts: 250 }), state, CTX);
    expect(r.intent?.kind).toBe('word-select');
  });

  test('two taps outside window → both caret-focus', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    let r = processTouchEvent(ev({ phase: 'end', ts: 100 }), state, CTX);
    expect(r.intent?.kind).toBe('caret-focus');
    state = r.nextState;
    // Second tap > 300ms later
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 600 }), state, CTX).nextState;
    r = processTouchEvent(ev({ phase: 'end', ts: 700 }), state, CTX);
    expect(r.intent?.kind).toBe('caret-focus');
  });
});

describe('processTouchEvent — long press', () => {
  test('start → end after >=500ms → context-menu', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    const r = processTouchEvent(ev({ phase: 'end', ts: 600 }), state, CTX);
    expect(r.intent?.kind).toBe('context-menu');
  });

  test('long-press cancels double-tap state', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    const r = processTouchEvent(ev({ phase: 'end', ts: 600 }), state, CTX);
    expect(r.intent?.kind).toBe('context-menu');
    expect(r.nextState.lastTapEndAt).toBeUndefined();
  });
});

describe('processTouchEvent — swipe', () => {
  test('start → move (>10px) → end → range-select-end', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    let r = processTouchEvent(ev({ phase: 'move', x: 150, y: 100, ts: 50 }), state, CTX);
    expect(r.intent?.kind).toBe('range-select-update');
    state = r.nextState;
    r = processTouchEvent(ev({ phase: 'end', ts: 100 }), state, CTX);
    expect(r.intent?.kind).toBe('range-select-end');
    expect(r.intent?.col).toBe(15);
  });

  test('small move (<10px) → still tap (caret-focus)', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    let r = processTouchEvent(ev({ phase: 'move', x: 105, y: 100, ts: 50 }), state, CTX);
    expect(r.intent).toBeNull();
    state = r.nextState;
    r = processTouchEvent(ev({ phase: 'end', ts: 100 }), state, CTX);
    expect(r.intent?.kind).toBe('caret-focus');
  });
});

describe('processTouchEvent — cancel', () => {
  test('cancel resets state', () => {
    let state = initialTouchState;
    state = processTouchEvent(ev({ phase: 'start', x: 100, y: 100, ts: 0 }), state, CTX).nextState;
    const r = processTouchEvent(ev({ phase: 'cancel', ts: 50 }), state, CTX);
    expect(r.intent).toBeNull();
    expect(r.nextState).toEqual(initialTouchState);
  });
});
