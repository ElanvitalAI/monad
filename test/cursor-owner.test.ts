// IDX-F5d — deriveCursor tier-aware ownership protocol.
//
// Covers the 4 rules from cursor-owner.ts:
//   1. terminal tier → owner='terminal', signals suppress-emission
//   2. picker / focus !== 'owns' → skip, keep walking down
//   3. first modal whose cursor() returns non-null wins
//   4. fallback to coordinator cursor / 'none'

import { describe, expect, test } from 'bun:test';

import type { CursorState } from '../src/display/cursor-state.js';
import { deriveCursor, deriveCursorState } from '../src/display/cursor-owner.js';
import type { DisplaySurface, ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeModal(opts: {
  id: string;
  tier?: ModalTier;
  focus?: 'owns' | 'participates' | 'none';
  backgroundInteractionPolicy?: 'allow' | 'block';
  windowRole?: 'foreground' | 'companion';
  interactionClass?: ModalSurface['interactionClass'];
  cursor?: CursorState | null | (() => CursorState | null);
}): ModalSurface {
  const cursorFn = typeof opts.cursor === 'function'
    ? (opts.cursor as () => CursorState | null)
    : opts.cursor === undefined
      ? undefined
      : () => opts.cursor as CursorState | null;
  return {
    id: opts.id,
    kind: 'modal',
    owner: 'dashboard',
    focus: opts.focus ?? 'owns',
    priority: 10,
    tier: opts.tier,
    bounds: { row: 1, col: 1, width: 10, height: 3 },
    backgroundInteractionPolicy: opts.backgroundInteractionPolicy,
    windowRole: opts.windowRole,
    interactionClass: opts.interactionClass,
    paint: () => '',
    cursor: cursorFn,
    render: () => [],
  } as unknown as ModalSurface;
}

function mkInput(modals: ModalSurface[], coordinatorCursor: CursorState | null = null) {
  const surfaces = new Map<SurfaceId, DisplaySurface>();
  const stack: SurfaceId[] = [];
  for (const m of modals) {
    surfaces.set(m.id, m);
    stack.push(m.id);
  }
  return { surfaces, focusStack: stack, coordinatorCursor };
}

const cursorA: CursorState = { row: 3, col: 4, visible: true };
const cursorB: CursorState = { row: 9, col: 2, visible: true };

describe('deriveCursor · ownership rules', () => {
  test('empty stack + no coordinator cursor → owner:none', () => {
    const d = deriveCursor(mkInput([]));
    expect(d.owner).toBe('none');
    expect(d.cursor).toBeNull();
    expect(d.modalId).toBeNull();
  });

  test('empty stack + coordinator cursor → owner:coordinator', () => {
    const d = deriveCursor(mkInput([], cursorA));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorA);
    expect(d.modalId).toBeNull();
  });

  test('top modal claims cursor → owner:modal', () => {
    const m = makeModal({ id: 'dialog-1', tier: 'dialog', cursor: cursorA });
    const d = deriveCursor(mkInput([m]));
    expect(d.owner).toBe('modal');
    expect(d.cursor).toEqual(cursorA);
    expect(d.modalId).toBe('dialog-1');
  });

  test('top modal returns null cursor → fall through to coordinator', () => {
    const m = makeModal({ id: 'm', tier: 'dialog', cursor: null });
    const d = deriveCursor(mkInput([m], cursorA));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorA);
  });

  test('foreground blocking modal suppresses coordinator fallback cursor', () => {
    const m = makeModal({
      id: 'browser-preview',
      tier: 'popup',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
      cursor: null,
    });
    const d = deriveCursor(mkInput([m], cursorA));
    expect(d.owner).toBe('suppressed');
    expect(d.cursor).toBeNull();
    expect(d.modalId).toBe('browser-preview');
  });

  test('companion popup does not suppress coordinator fallback cursor', () => {
    const m = makeModal({
      id: 'scratch-popup',
      tier: 'popup',
      backgroundInteractionPolicy: 'allow',
      windowRole: 'companion',
      cursor: null,
    });
    const d = deriveCursor(mkInput([m], cursorA));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorA);
  });

  test('workspace-class virtual window does not suppress coordinator fallback cursor', () => {
    const m = makeModal({
      id: 'sim-vw',
      tier: 'vw',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
      interactionClass: 'workspace',
      cursor: null,
    });
    const d = deriveCursor(mkInput([m], cursorA));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorA);
  });

  test('blocking foreground modal below a picker still suppresses fallback cursor', () => {
    const blocker = makeModal({
      id: 'browser-preview',
      tier: 'popup',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
      cursor: null,
    });
    const picker = makeModal({
      id: 'slash',
      tier: 'picker',
      cursor: cursorB,
    });
    const d = deriveCursor(mkInput([blocker, picker], cursorA));
    expect(d.owner).toBe('suppressed');
    expect(d.cursor).toBeNull();
    expect(d.modalId).toBe('browser-preview');
  });

  test('terminal tier on top → owner:terminal (suppress emission)', () => {
    const term = makeModal({ id: 'pty', tier: 'terminal', cursor: cursorA });
    const d = deriveCursor(mkInput([term], cursorB));
    expect(d.owner).toBe('terminal');
    expect(d.cursor).toBeNull();
    expect(d.modalId).toBe('pty');
  });

  test('terminal tier wins even when it returns no cursor()', () => {
    const term = makeModal({ id: 'pty', tier: 'terminal' });
    const d = deriveCursor(mkInput([term], cursorB));
    expect(d.owner).toBe('terminal');
    expect(d.cursor).toBeNull();
  });

  test('picker tier skips — next modal down claims', () => {
    const picker = makeModal({ id: 'slash', tier: 'picker', cursor: cursorA });
    const dialog = makeModal({ id: 'd', tier: 'dialog', cursor: cursorB });
    // stack: [dialog, picker] — picker is on top
    const d = deriveCursor(mkInput([dialog, picker]));
    expect(d.owner).toBe('modal');
    expect(d.cursor).toEqual(cursorB);
    expect(d.modalId).toBe('d');
  });

  test('picker tier skips even without lower claim → coordinator fallback', () => {
    const picker = makeModal({ id: 'slash', tier: 'picker', cursor: cursorA });
    const d = deriveCursor(mkInput([picker], cursorB));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorB);
  });

  test('focus:none modals skip regardless of tier', () => {
    const paintOnly = makeModal({ id: 'paint', tier: 'popup', focus: 'none', cursor: cursorA });
    const d = deriveCursor(mkInput([paintOnly], cursorB));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorB);
  });

  test('stack walk finds first claiming modal top→bottom', () => {
    const bottom = makeModal({ id: 'b', tier: 'dialog', cursor: cursorA });
    const mid = makeModal({ id: 'm', tier: 'popup', cursor: null });
    const top = makeModal({ id: 't', tier: 'popup', cursor: cursorB });
    const d = deriveCursor(mkInput([bottom, mid, top]));
    // Top claims first.
    expect(d.modalId).toBe('t');
    expect(d.cursor).toEqual(cursorB);
  });

  test('modal cursor() that throws is treated as null (isolates coordinator)', () => {
    const blown = makeModal({
      id: 'bad',
      tier: 'dialog',
      cursor: () => { throw new Error('boom'); },
    });
    const d = deriveCursor(mkInput([blown], cursorA));
    expect(d.owner).toBe('coordinator');
    expect(d.cursor).toEqual(cursorA);
  });
});

describe('deriveCursorState · convenience wrapper', () => {
  test('returns just the cursor state (null on terminal tier)', () => {
    const term = makeModal({ id: 'pty', tier: 'terminal', cursor: cursorA });
    expect(deriveCursorState(mkInput([term], cursorB))).toBeNull();
  });

  test('returns coordinator cursor when stack empty', () => {
    expect(deriveCursorState(mkInput([], cursorA))).toEqual(cursorA);
  });

  test('returns null when nothing claims', () => {
    expect(deriveCursorState(mkInput([]))).toBeNull();
  });
});
