// ── A-5b.1 · streaming key migration · dispatch snapshot tests ──
//
// Validates `runStreamingKeyUnifiedDispatch` by reconstructing the
// same `routeStreamingKeyAsync` shape dashboard.ts wires. Each key
// path (scroll / fold / Tab / Ctrl+T / Ctrl+G / `/` reopen) is
// exercised at the dispatcher level so regressions surface as PR-
// time test failures instead of runtime drift.
//
// Coverage:
//   * Async dispatch ordering — handleLogPaneKey's promise is awaited
//     BEFORE the next key routes.
//   * Scroll keys (j/k/g/G/down/up~/Ctrl+D/Ctrl+U) both in
//     agents-focused roster mode and default log mode.
//   * Focus ladder (tab · ctrl+t · ctrl+g · `/` reopen) · setWorkingFocus
//     mock captures reason strings.
//   * `/` in agent-roster with/without search modal.
//   * A-8 ESC guard fires when drag is active (dispatcher-level ·
//     bypassing the pre-dispatch ESC handler that lives in dashboard.ts
//     `attachStreamingKeys` callback).
//   * passthrough leaves the handler unconsumed so the outer wrapper
//     can log-drop.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEventAsync,
  derivePolicyForViewMode,
  keyEvent,
  type RouteCallbacks,
  type DispatchContext,
  type KeyInputEvent,
} from '../src/input-core/index.js';
import { createInterceptorRegistry } from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { Key as TuiKey } from '../src/tui.js';

// ── Fixtures ──────────────────────────────────────────────

const SCROLL_KEYS = new Set([
  'j', 'k', 'down', 'up', 'pagedown', 'pageup', 'home', 'end', 'g', 'G',
]);

interface StreamingKeyMock {
  workingDirFocus: 'agent-roster' | 'browser' | 'log' | 'input' | 'scratch' | 'preview';
  scratchMode: 'preview' | 'scheduler';
  agentRosterCursor: number;
  agentCursorManual: boolean;
  agentSearchModalOpen: boolean;
  handleLogPaneKeyCalls: string[];
  focusShifts: Array<{ target: string; reason: string }>;
  userScrolledDuringStream: boolean;
  drawCalls: number;
  openAgentRosterSearchCalls: number;
  rosterLen: number;
}

function mkMock(overrides: Partial<StreamingKeyMock> = {}): StreamingKeyMock {
  return {
    workingDirFocus: 'browser',
    scratchMode: 'preview',
    agentRosterCursor: 0,
    agentCursorManual: false,
    agentSearchModalOpen: false,
    handleLogPaneKeyCalls: [],
    focusShifts: [],
    userScrolledDuringStream: false,
    drawCalls: 0,
    openAgentRosterSearchCalls: 0,
    rosterLen: 3,
    ...overrides,
  };
}

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

/** Reconstruct the exact `routeStreamingKeyAsync` body that
 *  dashboard.ts wires · parametrised by mock state so side-effects
 *  are observable. Mirrors src/dashboard.ts:runStreamingKeyUnifiedDispatch. */
function buildStreamingRoutes(mock: StreamingKeyMock): RouteCallbacks {
  const handleLogPaneKey = async (k: TuiKey): Promise<void> => {
    // Simulate an async delay so ordering is measurable.
    await new Promise((r) => setImmediate(r));
    mock.handleLogPaneKeyCalls.push(`${k.ctrl ? 'C-' : ''}${k.name}`);
  };

  const setWorkingFocus = (target: string, reason: string): void => {
    mock.focusShifts.push({ target, reason });
    mock.workingDirFocus = target as StreamingKeyMock['workingDirFocus'];
  };

  const draw = (): void => { mock.drawCalls++; };
  const tabNext = (cur: string, dir: 1 | -1): string => {
    const order = ['input', 'browser', 'preview', 'scratch', 'log'] as const;
    const i = order.indexOf(cur as typeof order[number]);
    if (i < 0) return 'browser';
    const n = (i + dir + order.length) % order.length;
    return order[n] as string;
  };
  const firstPaneOfView = (_v: string): string => 'browser';

  return {
    routeStreamingKeyAsync: async (kev) => {
      const k = kev.key;
      const isScroll = SCROLL_KEYS.has(k.name)
        || (k.ctrl && (k.name === 'd' || k.name === 'u'));
      if (isScroll) {
        mock.userScrolledDuringStream = true;
        const agentsFocused = mock.workingDirFocus === 'agent-roster';
        if (agentsFocused) {
          const n = mock.rosterLen;
          if (n > 0) {
            switch (k.name) {
              case 'j': case 'down':
                mock.agentRosterCursor = Math.min(mock.agentRosterCursor + 1, n - 1); break;
              case 'k': case 'up':
                mock.agentRosterCursor = Math.max(0, mock.agentRosterCursor - 1); break;
              case 'g': case 'home':
                mock.agentRosterCursor = 0; break;
              case 'G': case 'end':
                mock.agentRosterCursor = n - 1; break;
              default:
                await handleLogPaneKey(k);
            }
            mock.agentCursorManual = true;
          }
        } else {
          await handleLogPaneKey(k);
        }
        draw();
        return 'consumed';
      }
      if (k.name === 'f' && !k.ctrl && !k.shift) {
        await handleLogPaneKey(k);
        draw();
        return 'consumed';
      }
      if (k.name === 'tab') {
        setWorkingFocus(tabNext(mock.workingDirFocus, k.shift ? -1 : 1), 'tab-cycle-streaming');
        draw();
        return 'consumed';
      }
      if (k.ctrl && (k.name === 't' || k.name === 'ㅅ')) {
        setWorkingFocus(
          mock.workingDirFocus === 'input'
            ? firstPaneOfView('view1')
            : tabNext(mock.workingDirFocus, 1),
          'ctrl-t-streaming',
        );
        draw();
        return 'consumed';
      }
      if (k.ctrl && (k.name === 'g' || k.name === 'ㅎ')) {
        setWorkingFocus('log', 'ctrl-g-streaming');
        draw();
        return 'consumed';
      }
      if (k.name === '/' && mock.workingDirFocus !== 'input') {
        const inAgentRoster = mock.workingDirFocus === 'agent-roster';
        if (inAgentRoster && !mock.agentSearchModalOpen) {
          mock.openAgentRosterSearchCalls++;
          draw();
          return 'consumed';
        }
        setWorkingFocus('input', 'slash-reopen-input-streaming');
        draw();
        return 'consumed';
      }
      return 'passthrough';
    },
  };
}

function mkCtx(
  mock: StreamingKeyMock,
  dragManager?: NonNullable<DispatchContext['dragManager']>,
): DispatchContext {
  const viewMode: ViewMode = { kind: 'streaming' };
  // I.2 (PR #374): the A-8 ESC guard migrated to an interceptor. When
  // a dragManager is supplied, also register the DragEscInterceptor so
  // the pre-I.2 assertion path ("ESC + drag → cancelAll") keeps firing.
  let interceptors: NonNullable<DispatchContext['interceptors']> | undefined;
  if (dragManager !== undefined) {
    interceptors = createInterceptorRegistry();
    interceptors.register(createDragEscInterceptor(dragManager));
  }
  const ctx: DispatchContext = {
    viewMode,
    policy: derivePolicyForViewMode(viewMode),
    routes: buildStreamingRoutes(mock),
    ...(dragManager !== undefined ? { dragManager } : {}),
    ...(interceptors !== undefined ? { interceptors } : {}),
  };
  return ctx;
}

function ev(name: string, opts: Partial<TuiKey> = {}): KeyInputEvent {
  return keyEvent(mkKey(name, opts));
}

// ── §1 Scroll keys (default log mode) ─────────────────────

describe('A-5b.1 · scroll keys · default log mode', () => {
  test('j → handleLogPaneKey + scroll flag + consumed', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('j'), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.handleLogPaneKeyCalls).toEqual(['j']);
    expect(mock.userScrolledDuringStream).toBe(true);
    expect(mock.drawCalls).toBe(1);
  });

  test('ctrl+d → handleLogPaneKey + consumed', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('d', { ctrl: true }), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.handleLogPaneKeyCalls).toEqual(['C-d']);
  });

  test('pageup → handleLogPaneKey + consumed', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('pageup'), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.handleLogPaneKeyCalls).toEqual(['pageup']);
  });
});

// ── §2 Scroll keys (agents-focused roster) ────────────────

describe('A-5b.1 · scroll keys · agents roster focused', () => {
  test('j → roster cursor +1 · handleLogPaneKey NOT called', async () => {
    const mock = mkMock({ workingDirFocus: 'agent-roster' });
    await routeInputEventAsync(ev('j'), mkCtx(mock));
    expect(mock.agentRosterCursor).toBe(1);
    expect(mock.agentCursorManual).toBe(true);
    expect(mock.handleLogPaneKeyCalls).toEqual([]);
  });

  test('k → roster cursor clamps at 0', async () => {
    const mock = mkMock({ workingDirFocus: 'agent-roster' });
    await routeInputEventAsync(ev('k'), mkCtx(mock));
    expect(mock.agentRosterCursor).toBe(0);
  });

  test('G (shift+g) → cursor to last', async () => {
    const mock = mkMock({ workingDirFocus: 'agent-roster', rosterLen: 5 });
    await routeInputEventAsync(ev('G'), mkCtx(mock));
    expect(mock.agentRosterCursor).toBe(4);
  });

  test('pagedown (unknown roster key) → handleLogPaneKey default branch', async () => {
    const mock = mkMock({ workingDirFocus: 'agent-roster' });
    await routeInputEventAsync(ev('pagedown'), mkCtx(mock));
    expect(mock.handleLogPaneKeyCalls).toEqual(['pagedown']);
  });
});

// ── §3 f fold toggle ──────────────────────────────────────

describe('A-5b.1 · f fold toggle', () => {
  test('f (plain) → handleLogPaneKey + consumed', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('f'), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.handleLogPaneKeyCalls).toEqual(['f']);
  });

  test('Ctrl+f → NOT fold (falls through to passthrough)', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('f', { ctrl: true }), mkCtx(mock));
    expect(outcome).toBe('passthrough');
    expect(mock.handleLogPaneKeyCalls).toEqual([]);
  });

  test('Shift+f → NOT fold (falls through)', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('f', { shift: true }), mkCtx(mock));
    expect(outcome).toBe('passthrough');
  });
});

// ── §4 Focus ladder ──────────────────────────────────────

describe('A-5b.1 · focus ladder', () => {
  test('Tab → setWorkingFocus tabNext +1 with reason', async () => {
    const mock = mkMock({ workingDirFocus: 'browser' });
    const outcome = await routeInputEventAsync(ev('tab'), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([{ target: 'preview', reason: 'tab-cycle-streaming' }]);
  });

  test('Shift+Tab → tabNext -1', async () => {
    const mock = mkMock({ workingDirFocus: 'browser' });
    await routeInputEventAsync(ev('tab', { shift: true }), mkCtx(mock));
    expect(mock.focusShifts[0]?.target).toBe('input');
  });

  test('Ctrl+T → ctrl-t-streaming reason', async () => {
    const mock = mkMock({ workingDirFocus: 'browser' });
    await routeInputEventAsync(ev('t', { ctrl: true }), mkCtx(mock));
    expect(mock.focusShifts).toEqual([{ target: 'preview', reason: 'ctrl-t-streaming' }]);
  });

  test('Ctrl+G · 기존 ladder 에서 SCROLL_KEYS ' + `'g'` + ' 가 먼저 매칭 → scroll branch (pre-existing parity)', async () => {
    // SCROLL_KEYS 에 'g' 가 포함 · isScroll check 가 ctrl+g 블록보다
    // 먼저 fire 하므로 기존 dashboard.ts 에서도 ctrl+g focus-to-log
    // path 는 unreachable 이었음. A-5b.1 은 순서를 보존 · 동일
    // behavior 유지. 별 arc 에서 'g' 를 SCROLL_KEYS 에서 제외하거나
    // ctrl-modifier guard 추가해야 ctrl+g 가 focus-shift 경로로 진입.
    const mock = mkMock();
    await routeInputEventAsync(ev('g', { ctrl: true }), mkCtx(mock));
    expect(mock.handleLogPaneKeyCalls).toEqual(['C-g']);
    expect(mock.focusShifts).toEqual([]);
    expect(mock.userScrolledDuringStream).toBe(true);
  });

  test('Ctrl+T from input → firstPaneOfView', async () => {
    const mock = mkMock({ workingDirFocus: 'input' });
    await routeInputEventAsync(ev('t', { ctrl: true }), mkCtx(mock));
    expect(mock.focusShifts[0]?.target).toBe('browser');
  });
});

// ── §5 `/` reopen input ──────────────────────────────────

describe('A-5b.1 · `/` reopen input', () => {
  test('/ in default focus → flip to input', async () => {
    const mock = mkMock({ workingDirFocus: 'browser' });
    const outcome = await routeInputEventAsync(ev('/'), mkCtx(mock));
    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([{ target: 'input', reason: 'slash-reopen-input-streaming' }]);
  });

  test('/ already in input → passthrough (guard)', async () => {
    const mock = mkMock({ workingDirFocus: 'input' });
    const outcome = await routeInputEventAsync(ev('/'), mkCtx(mock));
    expect(outcome).toBe('passthrough');
    expect(mock.focusShifts).toEqual([]);
  });

  test('/ in agent-roster · no search modal → openAgentRosterSearch', async () => {
    const mock = mkMock({
      workingDirFocus: 'agent-roster', agentSearchModalOpen: false,
    });
    await routeInputEventAsync(ev('/'), mkCtx(mock));
    expect(mock.openAgentRosterSearchCalls).toBe(1);
    expect(mock.focusShifts).toEqual([]);
  });

  test('/ in agent-roster · search modal already open → fall through to input flip', async () => {
    const mock = mkMock({
      workingDirFocus: 'agent-roster', agentSearchModalOpen: true,
    });
    await routeInputEventAsync(ev('/'), mkCtx(mock));
    expect(mock.openAgentRosterSearchCalls).toBe(0);
    expect(mock.focusShifts).toEqual([{ target: 'input', reason: 'slash-reopen-input-streaming' }]);
  });
});

// ── §6 A-8 ESC guard fires on dispatcher-level ESC ────────

describe('A-5b.1 · A-8 ESC guard · dispatcher-level', () => {
  test('ESC + drag active → consumed + cancelAll (dispatcher A-8)', async () => {
    const mock = mkMock();
    const { manager, cancelCalls } = mkDragManager(true);
    const outcome = await routeInputEventAsync(ev('escape'), mkCtx(mock, manager));
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
    // Route callbacks never reached · no handleLogPaneKey, no focus shift.
    expect(mock.handleLogPaneKeyCalls).toEqual([]);
    expect(mock.focusShifts).toEqual([]);
  });

  test('ESC + drag inactive → passthrough (route doesn\'t handle ESC · expected)', async () => {
    const mock = mkMock();
    const { manager } = mkDragManager(false);
    const outcome = await routeInputEventAsync(ev('escape'), mkCtx(mock, manager));
    expect(outcome).toBe('passthrough');
  });
});

// ── §7 Async ordering · handleLogPaneKey awaited ─────────

describe('A-5b.1 · async ordering', () => {
  test('consecutive j keys · handleLogPaneKey awaited sequentially', async () => {
    const mock = mkMock();
    const ctx = mkCtx(mock);
    await routeInputEventAsync(ev('j'), ctx);
    await routeInputEventAsync(ev('k'), ctx);
    expect(mock.handleLogPaneKeyCalls).toEqual(['j', 'k']);
    expect(mock.drawCalls).toBe(2);
  });
});

// ── §8 Passthrough (log-and-drop boundary) ────────────────

describe('A-5b.1 · passthrough', () => {
  test('unrelated key (e.g. `x`) → passthrough · route unaffected', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('x'), mkCtx(mock));
    expect(outcome).toBe('passthrough');
    expect(mock.handleLogPaneKeyCalls).toEqual([]);
    expect(mock.focusShifts).toEqual([]);
  });

  test('Shift+letter (e.g. `A`) → passthrough', async () => {
    const mock = mkMock();
    const outcome = await routeInputEventAsync(ev('A', { shift: true }), mkCtx(mock));
    expect(outcome).toBe('passthrough');
  });
});
