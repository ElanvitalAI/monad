// ── U-1 · WidgetHost focus API tests ──
//
// Covers focus / blur / disposeById / getFocused / getFocusedId /
// onFocusChange and the legacy `dispose(id)` cascade.

import { describe, test, expect, beforeEach } from 'bun:test';
import { WidgetHost, type WidgetHostHooks, type WidgetFocusChangeEvent } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

function makeHooks(): WidgetHostHooks {
  return {
    log: () => {},
    requestRender: () => {},
  };
}

const fakeDef: WidgetDef<{ count: number }> = {
  type: 'fake',
  description: 'test fixture',
  defaultCharacter: 'Fake',
  initialState: () => ({ count: 0 }),
  render: (state) => [`count:${state.count}`],
};

describe('WidgetHost focus API', () => {
  let host: WidgetHost;
  let events: WidgetFocusChangeEvent[];
  let unsubFocus: () => void;

  beforeEach(() => {
    host = new WidgetHost(makeHooks());
    host.register(fakeDef);
    events = [];
    unsubFocus = host.onFocusChange((e) => { events.push(e); });
  });

  test('initial state · getFocused null · getFocusedId null', () => {
    expect(host.getFocused()).toBe(null);
    expect(host.getFocusedId()).toBe(null);
  });

  test('focus(id) on existing instance → true, event fired, getFocused returns instance', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    const ok = host.focus('w1', 'test');
    expect(ok).toBe(true);
    expect(host.getFocusedId()).toBe('w1');
    expect(host.getFocused()?.id).toBe('w1');
    expect(events).toHaveLength(1);
    expect(events[0]!.next).toBe('w1');
    expect(events[0]!.prev).toBe(null);
    expect(events[0]!.reason).toBe('test');
  });

  test('focus(id) on unknown instance → false, no event', () => {
    const ok = host.focus('nope', 'test');
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
    expect(host.getFocusedId()).toBe(null);
  });

  test('focus(id) when already focused is idempotent → true, no additional event', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'a');
    expect(events).toHaveLength(1);
    const ok = host.focus('w1', 'b');
    expect(ok).toBe(true);
    expect(events).toHaveLength(1); // no new event
  });

  test('focus transition fires event with correct prev/next', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.spawn({ type: 'fake', id: 'w2' });
    host.focus('w1', 'first');
    host.focus('w2', 'switch');
    expect(events).toHaveLength(2);
    expect(events[1]!.prev).toBe('w1');
    expect(events[1]!.next).toBe('w2');
    expect(events[1]!.reason).toBe('switch');
  });

  test('blur(id) when focused → clears focus, fires event with next=null', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'focus');
    const ok = host.blur('w1', 'release');
    expect(ok).toBe(true);
    expect(host.getFocusedId()).toBe(null);
    expect(events).toHaveLength(2);
    expect(events[1]!.next).toBe(null);
    expect(events[1]!.prev).toBe('w1');
    expect(events[1]!.reason).toBe('release');
  });

  test('blur(id) when not focused → false, no event', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    const ok = host.blur('w1', 'release');
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  test('disposeById cascades blur when focused · event reason has suffix', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'focus');
    const ok = host.disposeById('w1', 'user-close');
    expect(ok).toBe(true);
    expect(host.getFocusedId()).toBe(null);
    expect(host.get('w1')).toBeNull();
    expect(events[1]!.next).toBe(null);
    expect(events[1]!.reason).toBe('user-close::dispose-cascade');
  });

  test('disposeById on non-focused instance → no focus event', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.spawn({ type: 'fake', id: 'w2' });
    host.focus('w1', 'focus');
    host.disposeById('w2', 'cleanup');
    // Only the w1 focus event fires, not a blur for w2.
    expect(events).toHaveLength(1);
    expect(events[0]!.next).toBe('w1');
  });

  test('disposeById on unknown id → false, no events', () => {
    const ok = host.disposeById('nope', 'test');
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  test('legacy dispose(id) also cascades blur when focused', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'focus');
    host.dispose('w1');
    expect(host.getFocusedId()).toBe(null);
    expect(events[1]!.reason).toBe('dispose-cascade');
  });

  test('onFocusChange disposer stops events', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'first');
    expect(events).toHaveLength(1);
    unsubFocus();
    host.focus('w1', 'second'); // idempotent - won't fire anyway
    host.spawn({ type: 'fake', id: 'w2' });
    host.focus('w2', 'transition');
    expect(events).toHaveLength(1); // unsubbed, no new events
  });

  test('multiple subscribers · one throw does not break the other', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    let second = 0;
    host.onFocusChange(() => { throw new Error('boom'); });
    host.onFocusChange(() => { second++; });
    host.focus('w1', 'test');
    expect(second).toBe(1);
  });

  test('focus event timestamp is set to Date.now()', () => {
    host.spawn({ type: 'fake', id: 'w1' });
    const before = Date.now();
    host.focus('w1', 'test');
    const after = Date.now();
    expect(events[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(events[0]!.timestamp).toBeLessThanOrEqual(after);
  });
});
