// IDX-2a — ContextKeyService behavior tests.
//
// Subscriber mechanics: immediate prime, equality-based change
// detection, error isolation, dispose. Reset semantics. Unknown key
// rejection. Shape frozen.

import { describe, expect, test } from 'bun:test';
import {
  createContextKeyService,
  INITIAL_CONTEXT_KEYS,
  type ContextKeys,
  type ContextKeyName,
} from '../src/input-core/index.js';

describe('INITIAL_CONTEXT_KEYS', () => {
  test('all expected keys present', () => {
    // Snapshot — if we add a new key to ContextKeys we should
    // deliberately update this list, not silently forget.
    const expected: ContextKeyName[] = [
      'focusMode', 'activePaneId',
      'modalTopTier', 'pickerOpen', 'popupOpen', 'dialogOpen', 'terminalModalActive',
      'planModeActive', 'syncModeActive', 'controlModeActive',
      'autoModeActive', 'budgetWarningActive', 'escalationPending',
      // IDX-5 Phase 1 — hover state
      'hoverTargetKind', 'hoverTooltip',
      // IDX-5 Phase 2 — context-menu
      'contextMenuOpen',
      // IDX-5 Phase 3 — last click state
      'lastClickHitKind',
      // IDX-6 Phase 3 — theme state
      'themeName', 'themeIsDark', 'themeIsPastel',
      // U-0 — ViewMode kind projection
      'viewModeKind',
      // A-7a — HitTarget live projection
      'hitTargetKind', 'hitTargetSurfaceKind', 'hitTargetPaneId', 'hitTargetWidgetInstanceId',
      // A-7a follow-up — inputId projection (DS-3a consumer)
      'hitTargetInputId',
    ];
    for (const k of expected) expect(k in INITIAL_CONTEXT_KEYS).toBe(true);
    expect(Object.keys(INITIAL_CONTEXT_KEYS).sort()).toEqual(expected.slice().sort() as string[]);
  });

  test('is frozen (runtime immutable)', () => {
    expect(Object.isFrozen(INITIAL_CONTEXT_KEYS)).toBe(true);
    // Mutation attempt should throw (strict mode) or silently no-op.
    expect(() => {
      (INITIAL_CONTEXT_KEYS as unknown as ContextKeys).pickerOpen = true;
    }).toThrow();
  });

  test('default values', () => {
    expect(INITIAL_CONTEXT_KEYS.focusMode).toBe('pane');
    expect(INITIAL_CONTEXT_KEYS.activePaneId).toBeNull();
    expect(INITIAL_CONTEXT_KEYS.modalTopTier).toBeNull();
    expect(INITIAL_CONTEXT_KEYS.pickerOpen).toBe(false);
    expect(INITIAL_CONTEXT_KEYS.autoModeActive).toBe(false);
  });
});

describe('createContextKeyService', () => {
  test('initial snapshot equals INITIAL_CONTEXT_KEYS when no override', () => {
    const svc = createContextKeyService();
    expect(svc.keys).toEqual(INITIAL_CONTEXT_KEYS);
  });

  test('initial override merges with defaults', () => {
    const svc = createContextKeyService({ pickerOpen: true, focusMode: 'input' });
    expect(svc.keys.pickerOpen).toBe(true);
    expect(svc.keys.focusMode).toBe('input');
    expect(svc.keys.popupOpen).toBe(false);   // default preserved
  });

  test('keys snapshot is frozen', () => {
    const svc = createContextKeyService();
    expect(Object.isFrozen(svc.keys)).toBe(true);
  });

  test('update() mutates snapshot and fires subscribers once', () => {
    const svc = createContextKeyService();
    const events: Array<{ keys: Readonly<ContextKeys>; changed: readonly ContextKeyName[] }> = [];
    svc.subscribe((keys, changed) => { events.push({ keys, changed }); });

    // Prime event = immediate subscribe fire with empty changed list.
    expect(events).toHaveLength(1);
    expect(events[0]!.changed).toEqual([]);

    svc.update({ pickerOpen: true, focusMode: 'input' });
    expect(events).toHaveLength(2);
    expect(events[1]!.changed.slice().sort()).toEqual(['focusMode', 'pickerOpen']);
    expect(events[1]!.keys.pickerOpen).toBe(true);
    expect(events[1]!.keys.focusMode).toBe('input');
  });

  test('update() with same values is a no-op (no fire)', () => {
    const svc = createContextKeyService();
    let fires = 0;
    svc.subscribe(() => { fires++; });
    // prime fire = 1
    expect(fires).toBe(1);

    svc.update({ pickerOpen: false });   // already false → no change
    expect(fires).toBe(1);

    svc.update({ focusMode: 'pane', pickerOpen: false });   // all same → no change
    expect(fires).toBe(1);
  });

  test('update() fires only when a field actually changes', () => {
    const svc = createContextKeyService();
    let fires = 0;
    const seen: ContextKeyName[][] = [];
    svc.subscribe((_k, ch) => { fires++; seen.push(ch.slice()); });

    svc.update({ pickerOpen: true });
    svc.update({ pickerOpen: true });   // no-op
    svc.update({ pickerOpen: false });  // back to default

    expect(fires).toBe(3);   // prime + 2 real changes
    expect(seen).toEqual([[], ['pickerOpen'], ['pickerOpen']]);
  });

  test('update() ignores unknown keys', () => {
    const svc = createContextKeyService();
    // @ts-expect-error deliberately pass unknown key at runtime
    svc.update({ doesNotExist: true, pickerOpen: true });
    expect(svc.keys.pickerOpen).toBe(true);
    expect((svc.keys as Record<string, unknown>).doesNotExist).toBeUndefined();
  });

  test('update() ignores undefined values (leaves key alone)', () => {
    const svc = createContextKeyService({ pickerOpen: true });
    svc.update({ pickerOpen: undefined });
    expect(svc.keys.pickerOpen).toBe(true);   // unchanged
  });

  test('reset() returns to initial and fires with all changed keys', () => {
    const svc = createContextKeyService();
    svc.update({ pickerOpen: true, focusMode: 'input' });

    let lastChanged: readonly ContextKeyName[] = [];
    svc.subscribe((_k, ch) => { lastChanged = ch; });
    // prime fire then reset
    svc.reset();

    expect(svc.keys).toEqual(INITIAL_CONTEXT_KEYS);
    // reset fires with the keys that were different from initial
    expect(lastChanged.slice().sort()).toEqual(['focusMode', 'pickerOpen']);
  });

  test('reset() is a no-op when already at initial', () => {
    const svc = createContextKeyService();
    let fires = 0;
    svc.subscribe(() => { fires++; });
    // prime = 1
    svc.reset();
    expect(fires).toBe(1);   // no additional fire
  });

  test('multiple subscribers all receive update', () => {
    const svc = createContextKeyService();
    const fires = [0, 0, 0];
    svc.subscribe(() => { fires[0]++; });
    svc.subscribe(() => { fires[1]++; });
    svc.subscribe(() => { fires[2]++; });
    // each primed once = [1,1,1]
    svc.update({ pickerOpen: true });
    expect(fires).toEqual([2, 2, 2]);
  });

  test('dispose stops further fires for that subscriber only', () => {
    const svc = createContextKeyService();
    let a = 0;
    let b = 0;
    const disposeA = svc.subscribe(() => { a++; });
    svc.subscribe(() => { b++; });
    // prime: a=1, b=1
    disposeA();
    svc.update({ pickerOpen: true });
    expect(a).toBe(1);   // no further fires
    expect(b).toBe(2);   // still fires
  });

  test('throwing subscriber does not break other subscribers or service', () => {
    const svc = createContextKeyService();
    let b = 0;
    svc.subscribe(() => { throw new Error('boom'); });
    svc.subscribe(() => { b++; });
    // prime both — first throws but second still runs
    expect(b).toBe(1);
    svc.update({ pickerOpen: true });
    expect(b).toBe(2);
    // service state still consistent
    expect(svc.keys.pickerOpen).toBe(true);
  });

  test('throwing subscriber on subscribe-prime does not break', () => {
    const svc = createContextKeyService();
    expect(() => {
      svc.subscribe(() => { throw new Error('prime boom'); });
    }).not.toThrow();
    // service still usable
    svc.update({ pickerOpen: true });
    expect(svc.keys.pickerOpen).toBe(true);
  });
});
