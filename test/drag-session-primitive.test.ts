// Phase DS-1 — DragSession primitive reference implementation tests.
// Pins the contract published in PLAN-drag-session-primitive §3 so
// DS-2 (coord attach) / DS-3+ (consumers) can rely on observable
// behavior without re-spec'ing from the PLAN each time.

import { describe, expect, test } from 'bun:test';
import {
  createDragManager,
  payload,
  lazyPayload,
  makeDraggable,
  type DragEvent,
  type DragManager,
  type DropFeedback,
  type DropOutcome,
  type DropTarget,
} from '../src/primitives/drag-session/index.js';
import type { HitTarget, MouseInputEvent } from '../src/input-core/event.js';
import type { SurfaceId } from '../src/display/types.js';

// ───── helpers ──────────────────────────────────────────────────

function hitPane(paneId: string): HitTarget {
  return { kind: 'pane-body', paneId };
}
function hitVwPane(windowId: number, paneId: string): HitTarget {
  return { kind: 'vw-pane-body', windowId, paneId };
}
function mouseEv(
  type: MouseInputEvent['type'],
  row: number,
  col: number,
  target: HitTarget = { kind: 'unknown' },
): MouseInputEvent {
  return { kind: 'mouse', type, row, col, target };
}

function harness(opts?: {
  threshold?: number;
  now?: () => number;
  hitTest?: (pt: { row: number; col: number }) => HitTarget | null;
}): {
  manager: DragManager;
  events: DragEvent[];
} {
  const manager = createDragManager({
    hitTest: opts?.hitTest ?? (() => null),
    threshold: opts?.threshold ?? 0,
    now: opts?.now ?? (() => 1000),
  });
  const events: DragEvent[] = [];
  for (const kind of ['begin', 'pull', 'hover', 'leave', 'end', 'cancel'] as const) {
    manager.on(kind, (ev) => events.push(ev));
  }
  return { manager, events };
}

// ───── §Payload helpers ─────────────────────────────────────────

describe('payload()', () => {
  test('eager entries — get returns the value or null for unknown kinds', () => {
    const p = payload([
      ['text/plain', 'hello'],
      ['file-path[]', ['/a', '/b']],
    ]);
    expect(p.kinds).toEqual(['text/plain', 'file-path[]']);
    expect(p.get('text/plain')).toBe('hello');
    expect(p.get('file-path[]')).toEqual(['/a', '/b']);
    expect(p.get('nonexistent')).toBeNull();
  });

  test('duplicate kinds — later entry wins, kinds de-duped', () => {
    const p = payload([
      ['k', 'first'],
      ['k', 'second'],
    ]);
    expect(p.kinds).toEqual(['k']);
    expect(p.get('k')).toBe('second');
  });

  test('preview passed through', () => {
    const p = payload([['k', 'v']], { label: '3 files', icon: '📄' });
    expect(p.preview?.label).toBe('3 files');
    expect(p.preview?.icon).toBe('📄');
  });
});

describe('lazyPayload()', () => {
  test('resolver called on first get · cached afterward', () => {
    let calls = 0;
    const p = lazyPayload(['k'], (k) => { calls++; return k === 'k' ? 'v' : null; });
    expect(p.get('k')).toBe('v');
    expect(p.get('k')).toBe('v');
    expect(calls).toBe(1);
  });

  test('unknown kinds never invoke resolver · return null', () => {
    let calls = 0;
    const p = lazyPayload(['k'], () => { calls++; return 'v'; });
    expect(p.get('other')).toBeNull();
    expect(calls).toBe(0);
  });

  test('resolver throw treated as null · cached', () => {
    let calls = 0;
    const p = lazyPayload(['k'], () => { calls++; throw new Error('boom'); });
    expect(p.get('k')).toBeNull();
    expect(p.get('k')).toBeNull();
    expect(calls).toBe(1);
  });

  test('resolver returning undefined normalized to null', () => {
    const p = lazyPayload(['k'], () => undefined);
    expect(p.get('k')).toBeNull();
  });
});

// ───── §Manager.begin / current / isActive ──────────────────────

describe('manager.begin / current / isActive', () => {
  test('begin emits begin event and current returns session', () => {
    const { manager, events } = harness();
    const handle = manager.begin({
      source: 'pane:src' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 5, col: 10 },
    });
    expect(manager.isActive()).toBe(true);
    expect(manager.current()?.source).toBe('pane:src');
    expect(manager.current()?.button).toBe('left');
    expect(manager.current()?.startAt).toEqual({ row: 5, col: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('begin');
    expect(handle.session.id).toBe(manager.current()!.id);
  });

  test('begin while prior session active — prior is cancelled with superseded reason', () => {
    const { manager, events } = harness();
    manager.begin({
      source: 'a' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    events.length = 0;
    manager.begin({
      source: 'b' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v2']]),
      startAt: { row: 1, col: 1 },
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('cancel');
    expect(kinds).toContain('begin');
    // Cancel must precede the new begin.
    expect(kinds.indexOf('cancel')).toBeLessThan(kinds.indexOf('begin'));
    expect(manager.current()?.source).toBe('b');
  });

  test('current returns null when no session · isActive matches', () => {
    const { manager } = harness();
    expect(manager.current()).toBeNull();
    expect(manager.isActive()).toBe(false);
  });
});

// ───── §Threshold / accumulator ─────────────────────────────────

describe('threshold + accumulator', () => {
  test('default threshold suppresses small pulls · arms past it', () => {
    const { manager, events } = harness({ threshold: 2 });
    const handle = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    // 1-cell move: suppressed (1 < 2).
    handle.pull({ row: 0, col: 1 }, null);
    expect(events.filter((e) => e.kind === 'pull')).toHaveLength(0);
    // 2-cell move: armed, emits.
    handle.pull({ row: 0, col: 2 }, null);
    expect(events.filter((e) => e.kind === 'pull')).toHaveLength(1);
    // Subsequent moves emit even if within threshold (armed).
    handle.pull({ row: 0, col: 2 }, null);
    expect(events.filter((e) => e.kind === 'pull')).toHaveLength(2);
  });

  test('threshold 0 — every pull emits immediately', () => {
    const { manager, events } = harness({ threshold: 0 });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 3, col: 3 },
    });
    h.pull({ row: 3, col: 3 }, null);
    expect(events.filter((e) => e.kind === 'pull')).toHaveLength(1);
  });
});

// ───── §DropTarget hover/leave ──────────────────────────────────

describe('DropTarget registration + hover/leave', () => {
  function makeTarget(opts: {
    surfaceId: string;
    acceptKinds: string[];
    feedback?: DropFeedback;
    onDrop?: (s: unknown, h: HitTarget) => DropOutcome;
  }): DropTarget {
    const f = opts.feedback ?? { accept: true, action: 'copy' };
    return {
      surfaceId: opts.surfaceId as SurfaceId,
      acceptKinds: opts.acceptKinds,
      onEnter: () => f,
      onOver: () => f,
      onDrop: opts.onDrop ?? (() => ({
        type: 'dropped', target: opts.surfaceId as SurfaceId, action: f.action ?? 'copy',
      })),
    };
  }

  test('registerTarget returns a disposer that removes the target', () => {
    const { manager } = harness();
    const target = makeTarget({ surfaceId: 't', acceptKinds: ['k'] });
    const off = manager.registerTarget(target);
    expect(manager.targetsFor(['k'])).toHaveLength(1);
    off();
    expect(manager.targetsFor(['k'])).toHaveLength(0);
  });

  test('hover emitted on first pull over matching target', () => {
    const { manager, events } = harness();
    manager.registerTarget(makeTarget({ surfaceId: 'pane:tgt', acceptKinds: ['k'] }));
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:tgt'));
    const hovers = events.filter((e) => e.kind === 'hover');
    expect(hovers).toHaveLength(1);
    expect(hovers[0]!.kind).toBe('hover');
  });

  test('leave emitted when pointer moves to different target', () => {
    const { manager, events } = harness();
    manager.registerTarget(makeTarget({ surfaceId: 'pane:a', acceptKinds: ['k'] }));
    manager.registerTarget(makeTarget({ surfaceId: 'pane:b', acceptKinds: ['k'] }));
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:a'));
    h.pull({ row: 2, col: 2 }, hitPane('pane:b'));
    const leaves = events.filter((e) => e.kind === 'leave');
    expect(leaves).toHaveLength(1);
    const hovers = events.filter((e) => e.kind === 'hover');
    expect(hovers).toHaveLength(2);
  });

  test('onOver called on same-target refinement without leave', () => {
    let onEnter = 0, onOver = 0;
    const target: DropTarget = {
      surfaceId: 'pane:x' as SurfaceId,
      acceptKinds: ['k'],
      onEnter: () => { onEnter++; return { accept: true }; },
      onOver: () => { onOver++; return { accept: true }; },
      onDrop: () => ({ type: 'dropped', target: 'pane:x' as SurfaceId, action: 'copy' }),
    };
    const { manager } = harness();
    manager.registerTarget(target);
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:x'));   // onEnter
    h.pull({ row: 2, col: 2 }, hitPane('pane:x'));   // onOver
    h.pull({ row: 3, col: 3 }, hitPane('pane:x'));   // onOver
    expect(onEnter).toBe(1);
    expect(onOver).toBe(2);
  });

  test('hit with no target — no hover emitted · prior hover receives leave', () => {
    const { manager, events } = harness();
    manager.registerTarget(makeTarget({ surfaceId: 'pane:a', acceptKinds: ['k'] }));
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:a'));
    h.pull({ row: 2, col: 2 }, null);   // no hit → no target
    expect(events.filter((e) => e.kind === 'leave')).toHaveLength(1);
  });

  test('unregister during hover clears hoverTarget atomically', () => {
    const { manager, events } = harness();
    const target = {
      surfaceId: 'pane:a' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'pane:a' as SurfaceId, action: 'copy' as const }),
    };
    const off = manager.registerTarget(target);
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:a'));
    off();
    // After unregister, the next pull should NOT refer to the removed
    // target in onOver. (Previously hoverTarget was the unregistered one;
    // the manager clears it in the disposer.)
    events.length = 0;
    h.pull({ row: 1, col: 2 }, hitPane('pane:a'));
    // No hover/leave for removed target.
    const hoverLeave = events.filter((e) => e.kind === 'hover' || e.kind === 'leave');
    expect(hoverLeave).toHaveLength(0);
  });
});

// ───── §End / cancel ────────────────────────────────────────────

describe('end()', () => {
  test('end over matching target invokes onDrop · returns outcome · emits end', () => {
    const { manager, events } = harness();
    let droppedWith: HitTarget | null = null;
    manager.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: (_s, h) => {
        droppedWith = h;
        return { type: 'dropped', target: 'pane:t' as SurfaceId, action: 'copy' };
      },
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const outcome = h.end({ row: 1, col: 1 }, hitPane('pane:t'));
    expect(outcome.type).toBe('dropped');
    expect((outcome as { target: string }).target).toBe('pane:t');
    expect(droppedWith).toEqual(hitPane('pane:t'));
    expect(events.some((e) => e.kind === 'end')).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  test('end outside any target returns cancelled-no-target · session ends', () => {
    const { manager } = harness();
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const outcome = h.end({ row: 1, col: 1 }, null);
    expect(outcome.type).toBe('cancelled');
    expect(manager.isActive()).toBe(false);
  });

  test('onDrop throw becomes rejected outcome (reason = error message)', () => {
    const { manager } = harness();
    manager.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => { throw new Error('full disk'); },
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const outcome = h.end({ row: 1, col: 1 }, hitPane('pane:t'));
    expect(outcome.type).toBe('rejected');
    expect((outcome as { reason: string }).reason).toBe('full disk');
  });

  test('prior hover target receives leave on end when drop target differs', () => {
    const { manager, events } = harness();
    manager.registerTarget({
      surfaceId: 'pane:a' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'pane:a' as SurfaceId, action: 'copy' }),
    });
    manager.registerTarget({
      surfaceId: 'pane:b' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'pane:b' as SurfaceId, action: 'copy' }),
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:a'));
    events.length = 0;
    h.end({ row: 2, col: 2 }, hitPane('pane:b'));
    // Expect leave (for pane:a) then end.
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('leave');
    expect(kinds[kinds.length - 1]).toBe('end');
  });

  test('end on stale session returns cancelled · no-session', () => {
    const { manager } = harness();
    const h1 = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    // Begin a new session — h1's id becomes stale.
    manager.begin({
      source: 't' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const outcome = h1.end({ row: 1, col: 1 }, null);
    expect(outcome.type).toBe('cancelled');
  });
});

describe('cancel()', () => {
  test('handle.cancel emits cancel event · resets state', () => {
    const { manager, events } = harness();
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.cancel('user-esc');
    expect(manager.isActive()).toBe(false);
    const cancelEv = events.find((e) => e.kind === 'cancel');
    expect(cancelEv).toBeDefined();
    expect((cancelEv as { reason: string }).reason).toBe('user-esc');
  });

  test('manager.cancelAll cancels any active session', () => {
    const { manager, events } = harness();
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    manager.cancelAll('escape');
    expect(manager.isActive()).toBe(false);
    const cancelEv = events.find((e) => e.kind === 'cancel');
    expect((cancelEv as { reason: string }).reason).toBe('escape');
  });

  test('cancel idempotent — second call is no-op', () => {
    const { manager, events } = harness();
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.cancel('r1');
    events.length = 0;
    h.cancel('r2');
    expect(events).toHaveLength(0);
  });

  test('cancel while hovering emits leave before cancel', () => {
    const { manager, events } = harness();
    manager.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'pane:t' as SurfaceId, action: 'copy' }),
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:t'));
    events.length = 0;
    h.cancel('esc');
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('leave');
    expect(kinds[kinds.length - 1]).toBe('cancel');
  });

  test('Symbol.dispose cancels via using-like path', () => {
    const { manager, events } = harness();
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h[Symbol.dispose]();
    expect(manager.isActive()).toBe(false);
    expect(events.some((e) => e.kind === 'cancel')).toBe(true);
  });
});

// ───── §handleMouse dispatch adapter ────────────────────────────

describe('handleMouse (DS-2 adapter entrypoint)', () => {
  test('drag while active → pull event · returns true', () => {
    const { manager, events } = harness();
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const consumed = manager.handleMouse(mouseEv('drag', 3, 3), null);
    expect(consumed).toBe(true);
    expect(events.some((e) => e.kind === 'pull')).toBe(true);
  });

  test('release while active → end event · returns true · session ends', () => {
    const { manager, events } = harness();
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    const consumed = manager.handleMouse(mouseEv('release', 2, 2), null);
    expect(consumed).toBe(true);
    expect(events.some((e) => e.kind === 'end')).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  test('drag when no session → returns false · no emit', () => {
    const { manager, events } = harness();
    const consumed = manager.handleMouse(mouseEv('drag', 3, 3), null);
    expect(consumed).toBe(false);
    expect(events).toHaveLength(0);
  });

  test('non-drag mouse types (click/scroll) pass through when active', () => {
    const { manager } = harness();
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    expect(manager.handleMouse(mouseEv('click', 1, 1), null)).toBe(false);
    expect(manager.handleMouse(mouseEv('scroll-up', 1, 1), null)).toBe(false);
    expect(manager.isActive()).toBe(true);
  });

  test('hit parameter preferred · manager falls back to injected hitTest', () => {
    let hitTestCalls = 0;
    const { manager, events } = harness({
      hitTest: () => { hitTestCalls++; return hitPane('pane:fallback'); },
    });
    manager.registerTarget({
      surfaceId: 'pane:fallback' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'pane:fallback' as SurfaceId, action: 'copy' }),
    });
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    // hit passed explicitly: hitTest not called.
    manager.handleMouse(mouseEv('drag', 1, 1), hitPane('pane:explicit'));
    expect(hitTestCalls).toBe(0);
    // hit null: hitTest fallback fires.
    manager.handleMouse(mouseEv('drag', 2, 2), null);
    expect(hitTestCalls).toBe(1);
    const hoverTargetIds = events
      .filter((e) => e.kind === 'hover')
      .map((e) => (e as { target: { surfaceId: string } }).target.surfaceId);
    expect(hoverTargetIds).toContain('pane:fallback');
  });
});

// ───── §Multi-format payload + targetsFor ──────────────────────

describe('multi-format payload + target kind matching', () => {
  test('target accepts one of multiple declared kinds', () => {
    const { manager, events } = harness();
    manager.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['file-path[]'],   // ← target only wants files
      onDrop: () => ({ type: 'dropped', target: 'pane:t' as SurfaceId, action: 'copy' }),
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([
        ['text/plain', 'hello'],
        ['file-path[]', ['/a']],         // ← payload has files too
      ]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:t'));
    expect(events.some((e) => e.kind === 'hover')).toBe(true);
  });

  test('target rejects when no accept-kind matches any payload kind', () => {
    const { manager, events } = harness();
    manager.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['image/png'],
      onDrop: () => ({ type: 'dropped', target: 'pane:t' as SurfaceId, action: 'copy' }),
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['text/plain', 'hi']]),
      startAt: { row: 0, col: 0 },
    });
    h.pull({ row: 1, col: 1 }, hitPane('pane:t'));
    expect(events.filter((e) => e.kind === 'hover')).toHaveLength(0);
  });

  test('targetsFor returns only targets with intersecting kinds', () => {
    const { manager } = harness();
    manager.registerTarget({
      surfaceId: 'pane:a' as SurfaceId,
      acceptKinds: ['k1', 'k2'],
      onDrop: () => ({ type: 'dropped', target: 'pane:a' as SurfaceId, action: 'copy' }),
    });
    manager.registerTarget({
      surfaceId: 'pane:b' as SurfaceId,
      acceptKinds: ['k3'],
      onDrop: () => ({ type: 'dropped', target: 'pane:b' as SurfaceId, action: 'copy' }),
    });
    expect(manager.targetsFor(['k2']).map((t) => t.surfaceId)).toEqual(['pane:a']);
    expect(manager.targetsFor(['k3']).map((t) => t.surfaceId)).toEqual(['pane:b']);
    expect(manager.targetsFor(['k1', 'k3']).map((t) => t.surfaceId)).toEqual(['pane:a', 'pane:b']);
    expect(manager.targetsFor([])).toHaveLength(0);
  });
});

// ───── §VW pane surface matching ────────────────────────────────

describe('hit surface matching — vw + pane kinds', () => {
  test('vw-pane-body paneId routing to DropTarget', () => {
    const { manager, events } = harness();
    manager.registerTarget({
      surfaceId: 'vw-pane:7:right' as SurfaceId,
      acceptKinds: ['k'],
      onDrop: () => ({ type: 'dropped', target: 'vw-pane:7:right' as SurfaceId, action: 'copy' }),
    });
    const h = manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    // vw-pane-body.paneId = 'vw-pane:7:right' → matches target.
    h.pull({ row: 1, col: 1 }, hitVwPane(7, 'vw-pane:7:right'));
    expect(events.some((e) => e.kind === 'hover')).toBe(true);
  });
});

// ───── §Listener robustness ─────────────────────────────────────

describe('listener error isolation', () => {
  test('a throwing listener does not break the emit chain', () => {
    const { manager } = harness();
    let later = 0;
    manager.on('begin', () => { throw new Error('boom'); });
    manager.on('begin', () => { later++; });
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    expect(later).toBe(1);
  });

  test('on() returns disposer that removes listener', () => {
    const { manager } = harness();
    let calls = 0;
    const off = manager.on('begin', () => { calls++; });
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    manager.cancelAll('r');
    off();
    manager.begin({
      source: 's' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    expect(calls).toBe(1);
  });
});

// ───── §makeDraggable helper ────────────────────────────────────

describe('makeDraggable', () => {
  test('start calls onBegin · on null return does NOT begin session', () => {
    const { manager } = harness();
    const draggable = makeDraggable({
      surfaceId: 'src' as SurfaceId,
      manager,
      onBegin: () => null,
    });
    const handle = draggable.start({ row: 0, col: 0 }, 'left');
    expect(handle).toBeNull();
    expect(manager.isActive()).toBe(false);
  });

  test('start calls onBegin · on payload return begins session', () => {
    const { manager } = harness();
    const p = payload([['k', 'v']]);
    const draggable = makeDraggable({
      surfaceId: 'src' as SurfaceId,
      manager,
      onBegin: () => ({ payload: p }),
    });
    const handle = draggable.start({ row: 2, col: 3 }, 'left');
    expect(handle).not.toBeNull();
    expect(manager.current()?.source).toBe('src');
    expect(manager.current()?.startAt).toEqual({ row: 2, col: 3 });
    expect(manager.current()?.payload).toBe(p);
  });

  test('onBegin sees the at + button args', () => {
    const { manager } = harness();
    const seen: Array<{ at: { row: number; col: number }; button: string }> = [];
    const draggable = makeDraggable({
      surfaceId: 'src' as SurfaceId,
      manager,
      onBegin: (ev) => {
        seen.push({ at: ev.at, button: ev.button });
        return { payload: payload([['k', 'v']]) };
      },
    });
    draggable.start({ row: 4, col: 5 }, 'right');
    expect(seen).toEqual([{ at: { row: 4, col: 5 }, button: 'right' }]);
  });
});
