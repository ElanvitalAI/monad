/**
 * Swipe gesture contract — pure classifier + DOM attach lifecycle.
 * Workspace 모바일 (#1647) 의 좌우 인접 탭 전환 wire 가 회귀 안 되도록.
 */

import { describe, expect, it } from 'bun:test';

import { attachSwipe, classifySwipe } from './swipe-gesture';

describe('classifySwipe — threshold matrix', () => {
  it('returns "left" when dx is sufficiently negative + fast', () => {
    expect(classifySwipe({ dx: -200, dy: 10, dt: 100 })).toBe('left');
  });

  it('returns "right" when dx is sufficiently positive + fast', () => {
    expect(classifySwipe({ dx: 200, dy: 10, dt: 100 })).toBe('right');
  });

  it('returns null when |dx| < minDistance default 100', () => {
    expect(classifySwipe({ dx: 80, dy: 10, dt: 100 })).toBeNull();
    expect(classifySwipe({ dx: -80, dy: 10, dt: 100 })).toBeNull();
  });

  it('returns null when vertical motion dominates (스크롤로 본다)', () => {
    expect(classifySwipe({ dx: 150, dy: 200, dt: 100 })).toBeNull();
  });

  it('returns null when velocity below minVelocity default 0.3 px/ms', () => {
    // 150 px / 1000 ms = 0.15 px/ms → drop
    expect(classifySwipe({ dx: 150, dy: 10, dt: 1000 })).toBeNull();
  });

  it('respects custom minDistance', () => {
    expect(classifySwipe({ dx: 80, dy: 10, dt: 100, minDistance: 50 })).toBe('right');
  });

  it('respects custom minVelocity', () => {
    expect(classifySwipe({ dx: 150, dy: 10, dt: 1000, minVelocity: 0.1 })).toBe('right');
  });

  it('clamps dt to ≥1 to avoid divide-by-zero', () => {
    // dt=0 → clamped to 1 → v=∞ effectively → distance + axis만 결정
    expect(classifySwipe({ dx: 150, dy: 10, dt: 0 })).toBe('right');
  });
});

class FakeElement {
  private listeners = new Map<string, Set<(e: PointerEvent) => void>>();

  addEventListener(type: string, listener: (e: PointerEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: PointerEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string, event: Partial<PointerEvent>): void {
    this.listeners.get(type)?.forEach((cb) => cb(event as PointerEvent));
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('attachSwipe — DOM lifecycle', () => {
  it('attaches pointerdown / pointerup / pointercancel listeners', () => {
    const el = new FakeElement();
    const detach = attachSwipe(el as unknown as HTMLElement, { onSwipe: () => {} });
    expect(el.listenerCount('pointerdown')).toBe(1);
    expect(el.listenerCount('pointerup')).toBe(1);
    expect(el.listenerCount('pointercancel')).toBe(1);
    detach();
    expect(el.listenerCount('pointerdown')).toBe(0);
    expect(el.listenerCount('pointerup')).toBe(0);
    expect(el.listenerCount('pointercancel')).toBe(0);
  });

  it('fires onSwipe("left") on a fast leftward swipe', () => {
    const el = new FakeElement();
    const swipes: string[] = [];
    attachSwipe(el as unknown as HTMLElement, { onSwipe: (d) => swipes.push(d) });
    el.fire('pointerdown', {
      clientX: 300, clientY: 400, timeStamp: 1000, pointerId: 1,
    } as Partial<PointerEvent>);
    el.fire('pointerup', {
      clientX: 50, clientY: 410, timeStamp: 1100, pointerId: 1,
    } as Partial<PointerEvent>);
    expect(swipes).toEqual(['left']);
  });

  it('fires onSwipe("right") on a fast rightward swipe', () => {
    const el = new FakeElement();
    const swipes: string[] = [];
    attachSwipe(el as unknown as HTMLElement, { onSwipe: (d) => swipes.push(d) });
    el.fire('pointerdown', {
      clientX: 50, clientY: 400, timeStamp: 1000, pointerId: 1,
    } as Partial<PointerEvent>);
    el.fire('pointerup', {
      clientX: 300, clientY: 405, timeStamp: 1100, pointerId: 1,
    } as Partial<PointerEvent>);
    expect(swipes).toEqual(['right']);
  });

  it('skips swipe when shouldIgnore returns true (input/textarea inside)', () => {
    const el = new FakeElement();
    const swipes: string[] = [];
    const fakeInput = {} as EventTarget;
    attachSwipe(el as unknown as HTMLElement, {
      onSwipe: (d) => swipes.push(d),
      shouldIgnore: (target) => target === fakeInput,
    });
    el.fire('pointerdown', {
      clientX: 300, clientY: 400, timeStamp: 1000, pointerId: 1, target: fakeInput,
    } as Partial<PointerEvent>);
    el.fire('pointerup', {
      clientX: 50, clientY: 410, timeStamp: 1100, pointerId: 1,
    } as Partial<PointerEvent>);
    expect(swipes).toEqual([]);
  });

  it('ignores pointerup with mismatched pointerId', () => {
    const el = new FakeElement();
    const swipes: string[] = [];
    attachSwipe(el as unknown as HTMLElement, { onSwipe: (d) => swipes.push(d) });
    el.fire('pointerdown', {
      clientX: 300, clientY: 400, timeStamp: 1000, pointerId: 1,
    } as Partial<PointerEvent>);
    el.fire('pointerup', {
      clientX: 50, clientY: 410, timeStamp: 1100, pointerId: 99,
    } as Partial<PointerEvent>);
    expect(swipes).toEqual([]);
  });

  it('cancels active gesture on pointercancel — subsequent up does not fire', () => {
    const el = new FakeElement();
    const swipes: string[] = [];
    attachSwipe(el as unknown as HTMLElement, { onSwipe: (d) => swipes.push(d) });
    el.fire('pointerdown', {
      clientX: 300, clientY: 400, timeStamp: 1000, pointerId: 1,
    } as Partial<PointerEvent>);
    el.fire('pointercancel', {} as Partial<PointerEvent>);
    el.fire('pointerup', {
      clientX: 50, clientY: 410, timeStamp: 1100, pointerId: 1,
    } as Partial<PointerEvent>);
    expect(swipes).toEqual([]);
  });
});
