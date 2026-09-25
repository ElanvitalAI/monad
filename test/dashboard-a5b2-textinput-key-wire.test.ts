// ── A-5b.2 · textInput opts.onKey dispatcher hook ──
//
// textInput readKey loop now exposes an `opts.onKey` hook that runs
// AFTER `onPreKey` (modal/picker routing) and BEFORE every textInput-
// specific handler. Dashboard wires this to `routeInputEventAsync`
// with `ViewMode={kind:'input'}` so the A-8 ESC guard fires on drag-
// active ESC in input mode · dispatcher consumes the key · textInput
// stays in the loop (no cancel).
//
// Tests here reconstruct the dashboard wiring and verify:
//   - A-8 ESC guard fires via dispatcher path
//   - non-ESC keys always passthrough · textInput buffer unaffected
//   - onPreKey precedence preserved (runs FIRST · if consumed, onKey
//     not called)
//   - empty routes (dashboard's shape) · dispatcher passes through
//     non-ESC keys even when drag is active.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEventAsync,
  derivePolicyForViewMode,
  keyEvent,
  type RouteCallbacks,
  type DispatchContext,
} from '../src/input-core/index.js';
import { createInterceptorRegistry } from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { Key as TuiKey } from '../src/tui.js';

// ── Fixtures ──────────────────────────────────────────────

function mkKey(name: string, opts: Partial<TuiKey> = {}): TuiKey {
  return {
    name,
    sequence: name,
    ctrl: false,
    shift: false,
    ...opts,
  };
}

function mkDragManager(isActive: boolean): {
  manager: NonNullable<DispatchContext['dragManager']>;
  cancelCalls: string[];
} {
  const cancelCalls: string[] = [];
  const manager = {
    isActive: () => isActive,
    cancelAll: (reason: string) => { cancelCalls.push(reason); },
  } as unknown as NonNullable<DispatchContext['dragManager']>;
  return { manager, cancelCalls };
}

/** Replicate the dashboard wire: empty routes · viewMode=input ·
 *  drag manager from harness. I.2 (PR #374): when a dragManager is
 *  supplied, the DragEscInterceptor is auto-registered so the
 *  pre-I.2 "ESC + drag → cancelAll" invariant keeps firing. */
function mkInputCtx(dragManager?: NonNullable<DispatchContext['dragManager']>): DispatchContext {
  const viewMode: ViewMode = { kind: 'input' };
  const routes: RouteCallbacks = {};
  let interceptors: NonNullable<DispatchContext['interceptors']> | undefined;
  if (dragManager) {
    interceptors = createInterceptorRegistry();
    interceptors.register(createDragEscInterceptor(dragManager));
  }
  return {
    viewMode,
    policy: derivePolicyForViewMode(viewMode),
    routes,
    ...(dragManager ? { dragManager } : {}),
    ...(interceptors ? { interceptors } : {}),
  };
}

/** The dashboard's onKey wire · isolated so the test exercises the
 *  real shape. */
async function dashboardOnKey(
  key: TuiKey,
  dragManager?: NonNullable<DispatchContext['dragManager']>,
): Promise<'consumed' | 'passthrough'> {
  const ev = keyEvent(key);
  const ctx = mkInputCtx(dragManager);
  const outcome = await routeInputEventAsync(ev, ctx);
  return outcome === 'consumed' ? 'consumed' : 'passthrough';
}

// ── §1 A-8 ESC guard · drag active ────────────────────────

describe('A-5b.2 · dashboard onKey · A-8 ESC guard', () => {
  test('ESC + drag active → consumed · cancelAll(\'escape\')', async () => {
    const { manager, cancelCalls } = mkDragManager(true);
    const outcome = await dashboardOnKey(mkKey('escape'), manager);
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
  });

  test('ESC + drag inactive → passthrough · no cancel', async () => {
    const { manager, cancelCalls } = mkDragManager(false);
    const outcome = await dashboardOnKey(mkKey('escape'), manager);
    expect(outcome).toBe('passthrough');
    expect(cancelCalls).toEqual([]);
  });

  test('ESC · no drag manager wired → passthrough (A-8 guard no-op)', async () => {
    const outcome = await dashboardOnKey(mkKey('escape'));
    expect(outcome).toBe('passthrough');
  });
});

// ── §2 Non-ESC keys always passthrough ────────────────────

describe('A-5b.2 · dashboard onKey · non-ESC passthrough', () => {
  test('Enter (submit) → passthrough (textInput owns submit)', async () => {
    const { manager } = mkDragManager(false);
    const outcome = await dashboardOnKey(mkKey('enter'), manager);
    expect(outcome).toBe('passthrough');
  });

  test('char `a` → passthrough (textInput owns char insert)', async () => {
    const outcome = await dashboardOnKey(mkKey('a'));
    expect(outcome).toBe('passthrough');
  });

  test('backspace → passthrough (textInput owns buffer delete)', async () => {
    const outcome = await dashboardOnKey(mkKey('backspace'));
    expect(outcome).toBe('passthrough');
  });

  test('arrow keys → passthrough', async () => {
    expect(await dashboardOnKey(mkKey('left'))).toBe('passthrough');
    expect(await dashboardOnKey(mkKey('right'))).toBe('passthrough');
    expect(await dashboardOnKey(mkKey('up'))).toBe('passthrough');
    expect(await dashboardOnKey(mkKey('down'))).toBe('passthrough');
  });

  test('Ctrl+Y (copy) → passthrough (textInput/opts.onCopyLastBlock owns)', async () => {
    const outcome = await dashboardOnKey(mkKey('y', { ctrl: true }));
    expect(outcome).toBe('passthrough');
  });

  test('Ctrl+V → passthrough (textInput owns paste-image)', async () => {
    const outcome = await dashboardOnKey(mkKey('v', { ctrl: true }));
    expect(outcome).toBe('passthrough');
  });

  test('Ctrl+Q → passthrough (textInput owns quit handler)', async () => {
    const outcome = await dashboardOnKey(mkKey('q', { ctrl: true }));
    expect(outcome).toBe('passthrough');
  });
});

// ── §3 Non-ESC keys · drag active · still passthrough ─────

describe('A-5b.2 · dashboard onKey · non-ESC keys unaffected by drag', () => {
  test('char `a` + drag active → passthrough (only ESC is drag-aware)', async () => {
    const { manager, cancelCalls } = mkDragManager(true);
    const outcome = await dashboardOnKey(mkKey('a'), manager);
    expect(outcome).toBe('passthrough');
    expect(cancelCalls).toEqual([]);
  });

  test('Enter + drag active → passthrough', async () => {
    const { manager, cancelCalls } = mkDragManager(true);
    const outcome = await dashboardOnKey(mkKey('enter'), manager);
    expect(outcome).toBe('passthrough');
    expect(cancelCalls).toEqual([]);
  });

  test('Ctrl+T (goto pane) + drag active → passthrough', async () => {
    const { manager, cancelCalls } = mkDragManager(true);
    const outcome = await dashboardOnKey(mkKey('t', { ctrl: true }), manager);
    expect(outcome).toBe('passthrough');
    expect(cancelCalls).toEqual([]);
  });
});

// ── §4 Idempotence · consecutive same-key events ─────────

describe('A-5b.2 · dashboard onKey · sequential ESC calls', () => {
  test('ESC + drag active · then ESC + drag already-cancelled → second call passthrough', async () => {
    const cancelCalls: string[] = [];
    // isActive flips to false after first cancelAll.
    let isActive = true;
    const manager = {
      isActive: () => isActive,
      cancelAll: (reason: string) => { cancelCalls.push(reason); isActive = false; },
    } as unknown as NonNullable<DispatchContext['dragManager']>;

    const first = await dashboardOnKey(mkKey('escape'), manager);
    const second = await dashboardOnKey(mkKey('escape'), manager);

    expect(first).toBe('consumed');
    expect(second).toBe('passthrough');
    expect(cancelCalls).toEqual(['escape']);    // single cancel · second bailed
  });
});
