// ── F6 LLM control · SendMouseEvent + OpenContextMenu tests ──
//
// ROADMAP-ui-core-separation §4 Phase S1 sub-PR C.
// PLAN-ui-core-separation-next-arc.md §2 Sub-PR S1.C checkpoint.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildSendMouseEventTool,
  dispatchSendMouseEvent,
  dispatchOpenContextMenu,
  sendMouseEventRuntime,
  openContextMenuRuntime,
  registerDisplayControlRuntimes,
  __resetDisplayControlRuntimesForTest,
} from '../../src/tool-runtime/display-control-runtimes.js';
import {
  getToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';
import type {
  DisplayMouseEvent,
  HitTarget,
} from '../../src/display/types.js';
import type {
  ContextMenuRegistry,
  Menu,
  MenuHandle,
  MenuPresenter,
  MenuResult,
} from '../../src/ui/context-menu-registry.js';
import { createContextMenuRegistry } from '../../src/ui/context-menu-registry.js';
import {
  createMenuProviderRegistry,
  type MenuProvider,
} from '../../src/ui/context-menu-providers.js';

const CTX = { surface: 'skill' as const };

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetDisplayControlRuntimesForTest();
});

// ─── SendMouseEvent ────────────────────────────────────────────────

describe('F6 · SendMouseEvent tool', () => {
  test('dispatches a click through the injected mouseDispatch', () => {
    const calls: DisplayMouseEvent[] = [];
    const mouseDispatch = (ev: DisplayMouseEvent): boolean => {
      calls.push(ev);
      return true;
    };
    const out = dispatchSendMouseEvent(
      { type: 'click', row: 5, col: 12 },
      { mouseDispatch },
    );
    expect(out.ok).toBe(true);
    expect(out.consumed).toBe(true);
    expect(out.type).toBe('click');
    expect(out.row).toBe(5);
    expect(out.col).toBe(12);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('click');
    expect(calls[0]!.row).toBe(5);
    expect(calls[0]!.col).toBe(12);
  });

  test('forwards modifier flags only when truthy', () => {
    const calls: DisplayMouseEvent[] = [];
    const mouseDispatch = (ev: DisplayMouseEvent): boolean => {
      calls.push(ev);
      return false;
    };
    dispatchSendMouseEvent(
      { type: 'right-click', row: 1, col: 1, shift: true, ctrl: false, alt: true },
      { mouseDispatch },
    );
    const ev = calls[0]!;
    expect(ev.shift).toBe(true);
    expect(ev.alt).toBe(true);
    expect('ctrl' in ev).toBe(false);
  });

  test('rejects unknown mouse type', () => {
    const out = dispatchSendMouseEvent(
      { type: 'rage-quit', row: 1, col: 1 },
      { mouseDispatch: () => true },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('unknown mouse type');
  });

  test('rejects missing row/col', () => {
    const out = dispatchSendMouseEvent(
      { type: 'click' },
      { mouseDispatch: () => true },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('row + col required');
  });

  test('rejects when mouseDispatch missing', () => {
    const out = dispatchSendMouseEvent({ type: 'click', row: 1, col: 1 }, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('mouseDispatch unavailable');
  });

  test('captures mouseDispatch throws as ok:false reason', () => {
    const mouseDispatch = (): boolean => {
      throw new Error('synthetic');
    };
    const out = dispatchSendMouseEvent(
      { type: 'click', row: 1, col: 1 },
      { mouseDispatch },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('mouseDispatch threw: synthetic');
  });

  test('reports consumed:false when wiring did not consume', () => {
    const out = dispatchSendMouseEvent(
      { type: 'motion', row: 2, col: 3 },
      { mouseDispatch: () => false },
    );
    expect(out.ok).toBe(true);
    expect(out.consumed).toBe(false);
  });

  test('tool spec exposes type/row/col required, modifiers optional', () => {
    const spec = buildSendMouseEventTool();
    expect(spec.name).toBe('SendMouseEvent');
    expect(spec.parameters.required).toEqual(['type', 'row', 'col']);
    const props = spec.parameters.properties as Record<string, unknown>;
    expect(props.shift).toBeDefined();
    expect(props.ctrl).toBeDefined();
    expect(props.alt).toBeDefined();
  });
});

// ─── OpenContextMenu ───────────────────────────────────────────────

function makeStubMenu(label = 'Open'): Menu {
  return {
    items: [{ kind: 'command', id: 'a', label }],
  };
}

function fakePresenter(): MenuPresenter {
  return async () => ({ value: null, reason: 'outside-click' }) satisfies MenuResult;
}

describe('F6 · OpenContextMenu tool', () => {
  test('resolves provider, registers menu, and calls showMenu', async () => {
    const providers = createMenuProviderRegistry();
    const provider: MenuProvider = (hit) =>
      hit.kind === 'pill' && hit.name === 'model' ? makeStubMenu('Switch model') : null;
    providers.register('pill:model', provider);
    const registry = createContextMenuRegistry({ presenter: fakePresenter() });
    const out = dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 30, col: 12 },
      { menuProviderRegistry: providers, contextMenuRegistry: registry },
    );
    expect(out.ok).toBe(true);
    expect(out.opened).toBe(true);
    expect(typeof out.menuId).toBe('string');
    // Allow the fire-and-forget showMenu chain to settle so the
    // unregister-on-finally side effect lands before the next test.
    await Promise.resolve();
    await Promise.resolve();
  });

  test('returns ok:false opened:false when no provider matched', () => {
    const providers = createMenuProviderRegistry();
    const registry = createContextMenuRegistry({ presenter: fakePresenter() });
    const out = dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 1, col: 1 },
      { menuProviderRegistry: providers, contextMenuRegistry: registry },
    );
    expect(out.ok).toBe(false);
    expect(out.opened).toBe(false);
    expect(out.reason).toContain('no menu provider');
  });

  test('rejects malformed target', () => {
    const out = dispatchOpenContextMenu(
      { target: 'not-an-object', row: 1, col: 1 },
      {
        menuProviderRegistry: createMenuProviderRegistry(),
        contextMenuRegistry: createContextMenuRegistry({ presenter: fakePresenter() }),
      },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('target required');
  });

  test('rejects target without kind', () => {
    const out = dispatchOpenContextMenu(
      { target: { name: 'model' }, row: 1, col: 1 },
      {
        menuProviderRegistry: createMenuProviderRegistry(),
        contextMenuRegistry: createContextMenuRegistry({ presenter: fakePresenter() }),
      },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('target.kind required');
  });

  test('rejects when menuProviderRegistry missing', () => {
    const out = dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 1, col: 1 },
      {
        contextMenuRegistry: createContextMenuRegistry({ presenter: fakePresenter() }),
      },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('menuProviderRegistry unavailable');
  });

  test('rejects when contextMenuRegistry missing', () => {
    const out = dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 1, col: 1 },
      { menuProviderRegistry: createMenuProviderRegistry() },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('contextMenuRegistry unavailable');
  });

  test('captures provider.resolve throws', () => {
    const providers: { resolve: (h: HitTarget) => Menu | null;
      register: (k: string, p: MenuProvider) => () => void;
      size: () => number; clear: () => void;
    } = {
      resolve: () => {
        throw new Error('boom');
      },
      register: () => () => undefined,
      size: () => 0,
      clear: () => undefined,
    };
    const registry = createContextMenuRegistry({ presenter: fakePresenter() });
    const out = dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 1, col: 1 },
      { menuProviderRegistry: providers, contextMenuRegistry: registry },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('menuProviderRegistry.resolve threw: boom');
  });

  test('passes anchor as {x:col, y:row} to showMenu', async () => {
    const captured: { handle?: MenuHandle; pos?: { x: number; y: number } } = {};
    const presenter: MenuPresenter = async (_menu, pos) => {
      captured.pos = pos;
      return { value: null, reason: 'outside-click' };
    };
    const providers = createMenuProviderRegistry();
    providers.register('pill:model', () => makeStubMenu());
    const registry = createContextMenuRegistry({ presenter });
    dispatchOpenContextMenu(
      { target: { kind: 'pill', name: 'model' } as HitTarget, row: 7, col: 21 },
      { menuProviderRegistry: providers, contextMenuRegistry: registry },
    );
    // Wait for the presenter promise chain to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(captured.pos).toEqual({ x: 21, y: 7 });
  });
});

// ─── Runtime registration cross-check ───────────────────────────────

describe('F6 · S1.C runtime registration', () => {
  test('factories return stable runtime ids', () => {
    expect(sendMouseEventRuntime().id).toBe('display_send_mouse_event');
    expect(openContextMenuRuntime().id).toBe('display_open_context_menu');
  });

  test('registerDisplayControlRuntimes exposes both via the registry', async () => {
    const calls: DisplayMouseEvent[] = [];
    const providers = createMenuProviderRegistry();
    providers.register('pill:model', () => makeStubMenu());
    const registry = createContextMenuRegistry({ presenter: fakePresenter() });
    registerDisplayControlRuntimes({
      mouseDispatch: (ev: DisplayMouseEvent) => {
        calls.push(ev);
        return true;
      },
      menuProviderRegistry: providers,
      contextMenuRegistry: registry as ContextMenuRegistry,
    });
    const send = getToolRuntime('display_send_mouse_event');
    const open = getToolRuntime('display_open_context_menu');
    expect(send).toBeDefined();
    expect(open).toBeDefined();
    const sendOut = JSON.parse(
      ((await send!.run({ type: 'click', row: 4, col: 8 }, CTX)) as { output: string }).output,
    );
    expect(sendOut.ok).toBe(true);
    expect(sendOut.consumed).toBe(true);
    expect(calls).toHaveLength(1);
    const openOut = JSON.parse(
      ((await open!.run(
        { target: { kind: 'pill', name: 'model' }, row: 1, col: 1 },
        CTX,
      )) as { output: string }).output,
    );
    expect(openOut.ok).toBe(true);
    expect(openOut.opened).toBe(true);
  });
});
