// ── A-5b.0 · routeInputEventAsync unit tests ──
//
// Async dual of `routeInputEvent` · preserves every invariant of the
// sync entry + adds:
//   - Async route fields (routeStreamingKeyAsync · routeFocusedWidgetKeyAsync
//     · routeGlobalBindingsAsync) are awaited when set.
//   - Sync route fields remain fallback when async sibling unset.
//   - Async field wins when BOTH are set (precedence contract).
//   - A-8 ESC guard fires before any await (cheap sync check).
//   - `handleMouse`-equivalent mouse path is UNCHANGED — mouse
//     doesn't go through async fields.
//
// Reuses fixtures from the sync dispatcher suite.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEventAsync,
  derivePolicyForViewMode,
  type DispatchContext,
  type RouteCallbacks,
  type KeyInputEvent,
  type MouseInputEvent,
  type DispatchOutcome,
} from '../src/input-core/index.js';
import { createInterceptorRegistry } from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import type { ViewMode } from '../src/input-core/view-mode.js';

// ── Fixtures ───────────────────────────────────────────────

const VM_STREAMING: ViewMode = { kind: 'streaming' };
const VM_IDLE: ViewMode = { kind: 'idle' };
const VM_INPUT: ViewMode = { kind: 'input' };

function k(name: string, overrides: Partial<KeyInputEvent['key']> = {}): KeyInputEvent {
  return {
    kind: 'key',
    key: {
      name,
      sequence: name,
      ctrl: false,
      meta: false,
      shift: false,
      ...overrides,
    },
  };
}

function m(type: MouseInputEvent['type'] = 'click'): MouseInputEvent {
  return {
    kind: 'mouse',
    type,
    row: 5,
    col: 10,
    target: { kind: 'unknown' },
  };
}

function mkCtx(viewMode: ViewMode, routes: RouteCallbacks): DispatchContext {
  return {
    viewMode,
    policy: derivePolicyForViewMode(viewMode),
    routes,
  };
}

function mkDragManager(isActive: boolean): {
  manager: NonNullable<DispatchContext['dragManager']>;
  cancelCalls: string[];
  interceptors: NonNullable<DispatchContext['interceptors']>;
} {
  const cancelCalls: string[] = [];
  const manager = {
    isActive: () => isActive,
    cancelAll: (reason: string) => { cancelCalls.push(reason); },
  } as unknown as NonNullable<DispatchContext['dragManager']>;
  // Post-I.2 (PR #374) · A-8 ESC guard migrated from a dispatcher
  // hard-coded branch to a `DragEscInterceptor` on the registry.
  // Fixtures wire the interceptor so the same behavioural assertions
  // keep pinning the contract.
  const interceptors = createInterceptorRegistry();
  interceptors.register(createDragEscInterceptor(manager));
  return { manager, cancelCalls, interceptors };
}

// ── §1 A-8 ESC guard parity with sync entry ────────────

describe('routeInputEventAsync · A-8 ESC guard', () => {
  test('ESC + drag active → consumed + cancelAll(\'escape\')', async () => {
    const { manager, cancelCalls, interceptors } = mkDragManager(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, {}),
      dragManager: manager,
      interceptors,
    };
    const outcome = await routeInputEventAsync(k('escape'), ctx);
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
  });

  test('non-ESC + drag active → falls through (async path)', async () => {
    const { manager, cancelCalls, interceptors } = mkDragManager(true);
    const log: string[] = [];
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, {
        routeFocusedWidgetKey: (ev) => { log.push(`sync:${ev.key.name}`); return 'passthrough'; },
      }),
      dragManager: manager,
      interceptors,
    };
    await routeInputEventAsync(k('a'), ctx);
    expect(cancelCalls).toEqual([]);
    expect(log).toEqual(['sync:a']);
  });

  test('ESC + drag inactive → falls through · no cancel', async () => {
    const { manager, cancelCalls, interceptors } = mkDragManager(false);
    const log: string[] = [];
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, {
        routeFocusedWidgetKey: () => { log.push('sync-esc'); return 'passthrough'; },
      }),
      dragManager: manager,
      interceptors,
    };
    await routeInputEventAsync(k('escape'), ctx);
    expect(cancelCalls).toEqual([]);
    expect(log).toEqual(['sync-esc']);
  });
});

// ── §2 Async route field precedence ────────────────────

describe('routeInputEventAsync · async/sync precedence', () => {
  test('streaming viewMode · async field wins over sync when both set', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_STREAMING, {
      routeStreamingKey: () => { calls.push('sync'); return 'passthrough'; },
      routeStreamingKeyAsync: async () => { calls.push('async'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('j'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['async']);
  });

  test('streaming viewMode · routes a press once and ignores its release', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_STREAMING, {
      routeStreamingKeyAsync: async () => { calls.push('async'); return 'consumed'; },
    });
    const press = await routeInputEventAsync(k('j'), ctx);
    const release = await routeInputEventAsync(k('j', { kind: 'release' }), ctx);
    expect(press).toBe('consumed');
    expect(release).toBe('passthrough');
    expect(calls).toEqual(['async']);
  });

  test('streaming viewMode · sync fallback when async absent', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_STREAMING, {
      routeStreamingKey: () => { calls.push('sync'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('j'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['sync']);
  });

  test('streaming viewMode · no streaming key route · async passes to focused-widget fallback', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_STREAMING, {
      routeFocusedWidgetKeyAsync: async () => { calls.push('focused-async'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('j'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['focused-async']);
  });

  test('idle · focused-widget async preferred over sync', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_IDLE, {
      routeFocusedWidgetKey: () => { calls.push('sync'); return 'passthrough'; },
      routeFocusedWidgetKeyAsync: async () => { calls.push('async'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('x'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['async']);
  });

  test('idle · global bindings async preferred over sync', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_IDLE, {
      routeGlobalBindings: () => { calls.push('sync'); return 'passthrough'; },
      routeGlobalBindingsAsync: async () => { calls.push('async'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('ctrl+q'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['async']);
  });

  test('idle · async focused passthrough then async global consumes', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_IDLE, {
      routeFocusedWidgetKeyAsync: async () => { calls.push('focused'); return 'passthrough'; },
      routeGlobalBindingsAsync: async () => { calls.push('global'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('ctrl+e'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['focused', 'global']);
  });
});

// ── §3 Awaiting ordering · async handlers delay ────────

describe('routeInputEventAsync · await ordering', () => {
  test('async streaming handler resolves before fallback proceeds', async () => {
    const order: string[] = [];
    const ctx = mkCtx(VM_STREAMING, {
      routeStreamingKeyAsync: async (_ev) => {
        order.push('streaming-start');
        await new Promise((r) => setTimeout(r, 5));
        order.push('streaming-end');
        return 'passthrough';
      },
      routeFocusedWidgetKeyAsync: async () => {
        order.push('focused');
        return 'consumed';
      },
    });
    await routeInputEventAsync(k('j'), ctx);
    expect(order).toEqual(['streaming-start', 'streaming-end', 'focused']);
  });

  test('async global resolved before dispatcher returns', async () => {
    let resolved = false;
    const ctx = mkCtx(VM_IDLE, {
      routeGlobalBindingsAsync: async () => {
        await new Promise((r) => setTimeout(r, 3));
        resolved = true;
        return 'consumed';
      },
    });
    await routeInputEventAsync(k('a'), ctx);
    expect(resolved).toBe(true);
  });
});

// ── §4 Mouse path unchanged · async entry doesn't add overhead ──

describe('routeInputEventAsync · mouse path', () => {
  test('mouse event · routes through sync fallback chain unchanged', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_IDLE, {
      routeMouseWiring: () => { calls.push('wiring'); return 'passthrough'; },
      routePaneNavClick: () => { calls.push('pane-nav'); return 'passthrough'; },
      routePaneClick: () => { calls.push('pane-click'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(m(), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['wiring', 'pane-nav', 'pane-click']);
  });

  test('mouse event · async fields do NOT participate · no overhead', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_IDLE, {
      routeMouseWiring: () => { calls.push('wiring'); return 'consumed'; },
      // Async fields present but key-only — must not fire on mouse.
      routeStreamingKeyAsync: async () => { calls.push('streaming-key'); return 'consumed' as DispatchOutcome; },
      routeFocusedWidgetKeyAsync: async () => { calls.push('focused-key'); return 'consumed' as DispatchOutcome; },
    });
    await routeInputEventAsync(m(), ctx);
    expect(calls).toEqual(['wiring']);
  });
});

// ── §5 viewMode arm coverage ───────────────────────────

describe('routeInputEventAsync · viewMode arms', () => {
  test('terminal-modal arm uses sync routeToTerminalModal', async () => {
    const calls: string[] = [];
    const ctx = mkCtx({ kind: 'terminal-modal', terminalId: 'term-1' }, {
      routeToTerminalModal: () => { calls.push('term'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('a'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['term']);
  });

  test('modal arm uses sync routeToModal', async () => {
    const calls: string[] = [];
    const ctx = mkCtx({ kind: 'modal', modalId: 'x' as unknown as never }, {
      routeToModal: () => { calls.push('modal'); return 'consumed'; },
    });
    await routeInputEventAsync(k('escape'), ctx);
    expect(calls).toEqual(['modal']);
  });

  test('input arm · focused-widget async · global sync fallback', async () => {
    const calls: string[] = [];
    const ctx = mkCtx(VM_INPUT, {
      routeFocusedWidgetKeyAsync: async () => { calls.push('focused'); return 'passthrough'; },
      routeGlobalBindings: () => { calls.push('global-sync'); return 'consumed'; },
    });
    const outcome = await routeInputEventAsync(k('ctrl+q'), ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toEqual(['focused', 'global-sync']);
  });
});

// ── §6 Typo pin · field names visible on RouteCallbacks ───

describe('routeInputEventAsync · RouteCallbacks type shape', () => {
  test('new async fields compile as expected on RouteCallbacks shape', () => {
    const r: RouteCallbacks = {
      routeStreamingKeyAsync: async () => 'consumed',
      routeFocusedWidgetKeyAsync: async () => 'passthrough',
      routeGlobalBindingsAsync: async () => 'consumed',
    };
    // Type-level check — all three async fields are assignable.
    expect(typeof r.routeStreamingKeyAsync).toBe('function');
    expect(typeof r.routeFocusedWidgetKeyAsync).toBe('function');
    expect(typeof r.routeGlobalBindingsAsync).toBe('function');
  });
});
