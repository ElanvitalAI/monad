// Integration test for installVwLifecycleHandlers — the subtle wiring
// layer that sits between the VW event bus and TerminalRegistry.kill.
// The pure helpers in src/terminal-matrix/vw-lifecycle.ts are already
// unit-tested; this file covers the subscribe + suppression + kill
// orchestration that the three callers compose into.

import { describe, expect, test } from 'bun:test';

import {
  createVwExitPaneCloser,
  installVwLifecycleHandlers,
  type VwLifecycleBus,
  type VwLifecycleEvent,
  type VwLifecycleTerminalMatrix,
  type VwRegistryHandle,
} from '../../src/dashboard/windowing/lifecycle.js';
import type { TerminalPlacement } from '../../src/terminal-matrix/types.js';
import type { VwPlacedTerminalLike } from '../../src/terminal-matrix/vw-lifecycle.js';

// ─── Fakes ────────────────────────────────────────────────────────

interface Subscription {
  types?: string[];
  cb: (ev: VwLifecycleEvent) => void;
}

function createFakeBus(): VwLifecycleBus & {
  emit: (ev: VwLifecycleEvent) => void;
  subscriptions: () => number;
} {
  const subs = new Set<Subscription>();
  return {
    subscribe(filter, cb) {
      const sub: Subscription = { types: filter.types, cb };
      subs.add(sub);
      return () => { subs.delete(sub); };
    },
    emit(ev) {
      for (const s of [...subs]) {
        if (s.types && !s.types.includes(ev.type)) continue;
        s.cb(ev);
      }
    },
    subscriptions() { return subs.size; },
  };
}

function createFakeMatrix(
  terminals: VwPlacedTerminalLike[],
): VwLifecycleTerminalMatrix & { killed: string[]; terminals: VwPlacedTerminalLike[] } {
  const killed: string[] = [];
  return {
    terminals,
    killed,
    list() { return terminals; },
    kill(id) {
      killed.push(id);
      const t = terminals.find(x => x.id === id);
      if (t) (t as { exitCode: number | null }).exitCode = 137; // SIGKILL
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('installVwLifecycleHandlers — pane:close', () => {
  test('kills every live vw terminal bound to the closing pane', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:A', exitCode: null, placement: { kind: 'vw', windowId: '3', slotId: 'pane-1' } },
      { id: 'term:B', exitCode: null, placement: { kind: 'vw', windowId: '3', slotId: 'pane-1' } },
      { id: 'term:C', exitCode: null, placement: { kind: 'vw', windowId: '3', slotId: 'other' } },
    ]);
    const bindings = new Map([
      ['3/pane-1', 'pane-1'],
      ['3/pane-1-duplicate', 'pane-1'],
      ['3/other', 'other'],
    ]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'pane:pane-1' });

    expect(matrix.killed.sort()).toEqual(['term:A', 'term:B']);
    expect(bindings.has('3/pane-1')).toBe(false);
    expect(bindings.has('3/pane-1-duplicate')).toBe(false);
    expect(bindings.has('3/other')).toBe(true);
  });

  test('suppressed paneId consumes the suppression entry and skips kill', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:X', exitCode: null, placement: { kind: 'vw', windowId: '5', slotId: 'pane-sup' } },
    ]);
    const bindings = new Map([['5/pane-sup', 'pane-sup']]);
    const suppressed = new Set<string>(['pane-sup']);

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'pane:pane-sup' });

    expect(matrix.killed).toEqual([]);
    expect(suppressed.has('pane-sup')).toBe(false); // consumed
    expect(bindings.has('5/pane-sup')).toBe(false); // bindings still dropped
  });

  test('exited terminals are skipped — registry.list returns them but kill is not re-issued', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:alive', exitCode: null, placement: { kind: 'vw', windowId: '4', slotId: 'p' } },
      { id: 'term:dead',  exitCode: 0,    placement: { kind: 'vw', windowId: '4', slotId: 'p' } },
    ]);
    const bindings = new Map([['4/p', 'p']]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'pane:p' });

    expect(matrix.killed).toEqual(['term:alive']);
  });

  test('addr without pane: prefix is handled as raw paneId', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '2', slotId: 'raw' } },
    ]);
    const bindings = new Map([['2/raw', 'raw']]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'raw' });

    expect(matrix.killed).toEqual(['term:1']);
  });

  test('kill throwing does not abort the remaining victims', () => {
    const bus = createFakeBus();
    let killCount = 0;
    const matrix: VwLifecycleTerminalMatrix & { killed: string[] } = {
      killed: [],
      list: () => [
        { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '1', slotId: 's' } },
        { id: 'term:2', exitCode: null, placement: { kind: 'vw', windowId: '1', slotId: 's' } },
      ],
      kill(id) {
        killCount++;
        if (killCount === 1) throw new Error('matrix already disposed this id');
        matrix.killed.push(id);
      },
    };
    const bindings = new Map([['1/s', 's']]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'pane:s' });

    expect(killCount).toBe(2);
    expect(matrix.killed).toEqual(['term:2']);
  });

  test('bindings unaffected when no terminal is bound to the pane', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([]);
    const bindings = new Map([['3/keep-me', 'keep-me']]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'pane:close', addr: 'pane:unrelated-pane' });

    expect(matrix.killed).toEqual([]);
    expect(bindings.has('3/keep-me')).toBe(true);
  });
});

describe('installVwLifecycleHandlers — window:close', () => {
  test('kills every live vw terminal in the closing window and drops its bindings', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '7', slotId: 'a' } },
      { id: 'term:2', exitCode: null, placement: { kind: 'vw', windowId: '7', slotId: 'b' } },
      { id: 'term:3', exitCode: 0,    placement: { kind: 'vw', windowId: '7', slotId: 'c' } },
      { id: 'term:4', exitCode: null, placement: { kind: 'vw', windowId: '8', slotId: 'a' } },
      { id: 'term:5', exitCode: null, placement: { kind: 'modal', modalId: 'xyz' } },
    ]);
    const bindings = new Map([
      ['7/a', 'a'],
      ['7/b', 'b'],
      ['8/a', 'other'],
    ]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'window:close', windowId: 7 });

    expect(matrix.killed.sort()).toEqual(['term:1', 'term:2']);
    expect(bindings.has('7/a')).toBe(false);
    expect(bindings.has('7/b')).toBe(false);
    expect(bindings.has('8/a')).toBe(true);
  });

  test('numeric windowId is stringified when matching string placement.windowId', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:n', exitCode: null, placement: { kind: 'vw', windowId: '42', slotId: 's' } },
    ]);
    const bindings = new Map([['42/s', 's']]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'window:close', windowId: 42 });

    expect(matrix.killed).toEqual(['term:n']);
    expect(bindings.size).toBe(0);
  });

  test('prefix-based binding drop does not clobber bindings in other windows that share a digit', () => {
    // regression guard: '7' startsWith should never match '71/...'
    const bus = createFakeBus();
    const matrix = createFakeMatrix([]);
    const bindings = new Map([
      ['7/a', 'x'],
      ['71/a', 'y'],
    ]);
    const suppressed = new Set<string>();

    installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    bus.emit({ type: 'window:close', windowId: 7 });

    expect(bindings.has('7/a')).toBe(false);
    expect(bindings.has('71/a')).toBe(true);
  });
});

describe('createVwExitPaneCloser — symmetric auto-close on terminal exit', () => {
  function fakeVw(): VwRegistryHandle & { closed: string[] } {
    const closed: string[] = [];
    return {
      closed,
      closePaneAt(paneId) { closed.push(paneId); return true; },
    };
  }

  test('closes VW pane when a vw-placed terminal exits', () => {
    const vw = fakeVw();
    const close = createVwExitPaneCloser({
      getVirtualWindow: (id) => (id === 5 ? vw : null),
      bindings: new Map([['5/slot-a', 'pane-xyz']]),
    });
    const placement: TerminalPlacement = { kind: 'vw', windowId: '5', slotId: 'slot-a' };
    const r = close(placement, 'exited');
    expect(r).toEqual({ closed: true });
    expect(vw.closed).toEqual(['pane-xyz']);
  });

  test('falls back to slotId when no binding entry exists', () => {
    const vw = fakeVw();
    const close = createVwExitPaneCloser({
      getVirtualWindow: (id) => (id === 2 ? vw : null),
      bindings: new Map(),
    });
    const r = close({ kind: 'vw', windowId: '2', slotId: 'chord-slot' }, 'killed');
    expect(r).toEqual({ closed: true });
    expect(vw.closed).toEqual(['chord-slot']);
  });

  test('non-vw placements are a no-op with reason=not-vw', () => {
    const close = createVwExitPaneCloser({
      getVirtualWindow: () => { throw new Error('should not be called'); },
      bindings: new Map(),
    });
    expect(close({ kind: 'background' }, 'exited')).toEqual({ closed: false, reason: 'not-vw' });
    expect(close({ kind: 'preview' }, 'exited')).toEqual({ closed: false, reason: 'not-vw' });
    expect(close({ kind: 'modal', modalId: 'm:1' }, 'killed')).toEqual({ closed: false, reason: 'not-vw' });
  });

  test('non-numeric windowId returns bad-window-id', () => {
    const close = createVwExitPaneCloser({
      getVirtualWindow: () => { throw new Error('should not be called'); },
      bindings: new Map(),
    });
    const r = close({ kind: 'vw', windowId: 'garbage', slotId: 's' }, 'exited');
    expect(r).toEqual({ closed: false, reason: 'bad-window-id' });
  });

  test('missing VirtualWindow returns no-window (window already closed)', () => {
    const close = createVwExitPaneCloser({
      getVirtualWindow: () => null,
      bindings: new Map([['9/s', 'p']]),
    });
    const r = close({ kind: 'vw', windowId: '9', slotId: 's' }, 'exited');
    expect(r).toEqual({ closed: false, reason: 'no-window' });
  });

  test('closePaneAt returning false yields reason=no-op', () => {
    const vw: VwRegistryHandle = { closePaneAt: () => false };
    const close = createVwExitPaneCloser({
      getVirtualWindow: () => vw,
      bindings: new Map(),
    });
    const r = close({ kind: 'vw', windowId: '1', slotId: 'absent' }, 'exited');
    expect(r).toEqual({ closed: false, reason: 'no-op' });
  });

  test('closePaneAt throwing is caught and reported as reason=threw', () => {
    const vw: VwRegistryHandle = { closePaneAt: () => { throw new Error('boom'); } };
    const close = createVwExitPaneCloser({
      getVirtualWindow: () => vw,
      bindings: new Map(),
    });
    const r = close({ kind: 'vw', windowId: '1', slotId: 's' }, 'killed');
    expect(r).toEqual({ closed: false, reason: 'threw' });
  });
});

describe('installVwLifecycleHandlers — disposer', () => {
  test('returned disposer unsubscribes both handlers', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([
      { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '1', slotId: 's' } },
    ]);
    const bindings = new Map([['1/s', 's']]);
    const suppressed = new Set<string>();

    const dispose = installVwLifecycleHandlers({ bus, terminalMatrix: matrix, bindings, suppressedKills: suppressed });
    expect(bus.subscriptions()).toBe(2);
    dispose();
    expect(bus.subscriptions()).toBe(0);

    bus.emit({ type: 'pane:close', addr: 'pane:s' });
    bus.emit({ type: 'window:close', windowId: 1 });
    expect(matrix.killed).toEqual([]);
  });

  test('disposer is idempotent', () => {
    const bus = createFakeBus();
    const matrix = createFakeMatrix([]);
    const dispose = installVwLifecycleHandlers({
      bus, terminalMatrix: matrix,
      bindings: new Map(), suppressedKills: new Set(),
    });
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});
