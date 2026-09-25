import { describe, expect, test } from 'bun:test';

import type { ApprovalModalHandle, ApprovalModalRouter } from '../src/approval-modal.js';
import { routeApprovalModalKey } from '../src/dashboard/input/approval-key-router.js';
import type { Key } from '../src/tui.js';

function key(overrides?: Partial<Key>): Key {
  return { name: 'y', ctrl: false, shift: false, ...overrides };
}

function router(current: ApprovalModalHandle | null) {
  const events: unknown[] = [];
  const fake: ApprovalModalRouter = {
    current: () => current,
    currentKind: () => null,
    set: () => false,
    handleKey: (ev) => {
      events.push(ev);
      return current ? 'consumed' : 'passthrough';
    },
    _resetForTesting: () => {},
  };
  return { fake, events };
}

describe('routeApprovalModalKey', () => {
  test('passes through when no approval modal is active', () => {
    const t = router(null);
    expect(routeApprovalModalKey(key(), t.fake)).toBe('passthrough');
    expect(t.events).toEqual([]);
  });

  test('routes active approval modal through normalized key event', () => {
    const handle = {} as ApprovalModalHandle;
    const t = router(handle);
    expect(routeApprovalModalKey(key({ name: 'g', ctrl: true, raw: '\u0007' }), t.fake)).toBe('consumed');
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toEqual(expect.objectContaining({
      name: 'g',
      ctrl: true,
      shift: false,
      sequence: '\u0007',
    }));
  });
});
