// FU-2 — VW chord port through coordinator. Verifies that
// NavigationRouter.dispatchArmed stays in control of the actual body
// logic while the coordinator owns arming, and that registering the
// chord bindings produces the same routing outcomes as the legacy
// routeVirtualWindowKey path would have.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import { createNavigationRouter } from '../src/virtual-windows/navigation.js';
import type { KeyEvent } from '../src/display/types.js';
import type { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import type { VirtualWindow } from '../src/virtual-windows/virtual-window.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function mkRegistry(windows: Array<{ id: number }>): {
  registry: WindowRegistry;
  switches: number[];
  nextCount: () => number;
  prevCount: () => number;
} {
  let nextCount = 0;
  let prevCount = 0;
  const switches: number[] = [];
  const registry = {
    list: () => windows.map(w => ({ ...w } as unknown as VirtualWindow)),
    switchTo: (id: number) => { switches.push(id); },
    next: () => { nextCount++; },
    previous: () => { prevCount++; },
    current: () => null,
    close: () => {},
  } as unknown as WindowRegistry;
  return { registry, switches, nextCount: () => nextCount, prevCount: () => prevCount };
}

function mkHarness() {
  const windows = [{ id: 7 }, { id: 9 }, { id: 12 }];
  const reg = mkRegistry(windows);
  const cbs = {
    pickerFired: 0, newFired: 0, toggleFired: 0, helpFired: 0, closeWinFired: 0,
    hsplitFired: 0, vsplitFired: 0, syncBarFired: 0,
  };
  const router = createNavigationRouter({
    registry: reg.registry,
    callbacks: {
      onPicker: () => { cbs.pickerFired++; },
      onNewWindow: () => { cbs.newFired++; },
      onModalWindowToggle: () => { cbs.toggleFired++; },
      onHelp: () => { cbs.helpFired++; },
      onCloseWindow: () => { cbs.closeWinFired++; },
      onSplit: (dir) => {
        if (dir === 'h') cbs.hsplitFired++;
        else cbs.vsplitFired++;
      },
      onSyncInputBarToggle: () => { cbs.syncBarFired++; },
    },
  });
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: () => 0 as any,
  });
  // Mirror the registration loop from dashboard.ts.
  // Q4 (substrate Occam, 2026-05-03): single canonical form; jamo
  // alias resolved by KEY_ALIAS_TABLE at lookup time.
  const PREFIX = 'C-b';
  const mkEv = (name: string, mods: Partial<KeyEvent> = {}): KeyEvent =>
    ({ name, ctrl: false, shift: false, alt: false, ...mods });
  const bind = (id: string, k: string, ev: KeyEvent) => {
    coordinator.registerKeyBinding({
      id: `test:vw:${id}`,
      chordPrefix: PREFIX,
      key: k,
      scope: 'global',
      handler: () => router.dispatchArmed(ev),
    });
  };
  bind('0', '0', mkEv('0'));
  // Q4 (substrate Occam): no per-binding pipe alias. Plain digit and
  // Ctrl+digit are distinct chord bodies — register each separately.
  for (let n = 1; n <= 9; n++) {
    bind(`d-${n}`, `${n}`, mkEv(`${n}`));
    bind(`d-c-${n}`, `C-${n}`, mkEv(`${n}`));
  }
  bind('n',        'n', mkEv('n'));
  bind('p',        'p', mkEv('p'));
  bind('comma',    ',', mkEv(','));
  bind('lt',       '<', mkEv('<'));
  bind('dot',      '.', mkEv('.'));
  bind('gt',       '>', mkEv('>'));
  bind('c',        'c', mkEv('c'));
  bind('t',        't', mkEv('t'));
  bind('x',        'x', mkEv('x'));
  bind('X',        'S-x', mkEv('x', { shift: true }));
  bind('pct',      '%', mkEv('%'));
  bind('s',        's', mkEv('s'));
  bind('quote',    '"', mkEv('"'));
  bind('v',        'v', mkEv('v'));
  bind('?',        '?', mkEv('?'));
  bind('i',        'i', mkEv('i'));
  return { coordinator, router, registry: reg, cbs };
}

describe('FU-2 VW chord port', () => {
  test('Ctrl+B arms the coordinator (chord-armed)', () => {
    const { coordinator } = mkHarness();
    const r = coordinator.routeKey(key('b', { ctrl: true }));
    expect(r.type).toBe('chord-armed');
    if (r.type === 'chord-armed') expect(r.prefix).toBe('C-b');
  });

  test('Ctrl+B → digit fires NavigationRouter.switchTo', () => {
    const { coordinator, registry } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r = coordinator.routeKey(key('2'));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') r.invoke();
    expect(registry.switches).toEqual([9]); // windows[1] sorted by id
  });

  test('Ctrl+B → 0 opens the window picker', () => {
    const { coordinator, cbs } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r = coordinator.routeKey(key('0'));
    if (r.type === 'handler') r.invoke();
    expect(cbs.pickerFired).toBe(1);
  });

  test('Ctrl+B → n / p cycles next / previous', () => {
    const { coordinator, registry } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const rn = coordinator.routeKey(key('n'));
    if (rn.type === 'handler') rn.invoke();
    coordinator.routeKey(key('b', { ctrl: true }));
    const rp = coordinator.routeKey(key('p'));
    if (rp.type === 'handler') rp.invoke();
    expect(registry.nextCount()).toBe(1);
    expect(registry.prevCount()).toBe(1);
  });

  test('Ctrl+B → , or < both go previous (literal comma separator works)', () => {
    const { coordinator, registry } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r1 = coordinator.routeKey(key(','));
    if (r1.type === 'handler') r1.invoke();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r2 = coordinator.routeKey(key('<'));
    if (r2.type === 'handler') r2.invoke();
    expect(registry.prevCount()).toBe(2);
  });

  test('Ctrl+B → Shift+X fires onCloseWindow (not x→closePane)', () => {
    const { coordinator, cbs } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r = coordinator.routeKey(key('x', { shift: true }));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') r.invoke();
    expect(cbs.closeWinFired).toBe(1);
  });

  test('Ctrl+B → ? fires the help callback', () => {
    const { coordinator, cbs } = mkHarness();
    coordinator.routeKey(key('b', { ctrl: true }));
    const r = coordinator.routeKey(key('?'));
    if (r.type === 'handler') r.invoke();
    expect(cbs.helpFired).toBe(1);
  });

  test('Korean IME: Ctrl+ㅠ arms through the prefix alias', () => {
    const { coordinator, registry } = mkHarness();
    const armed = coordinator.routeKey(key('ㅠ', { ctrl: true }));
    expect(armed.type).toBe('chord-armed');
    const r = coordinator.routeKey(key('3'));
    if (r.type === 'handler') r.invoke();
    expect(registry.switches).toEqual([12]); // windows[2]
  });

  test('stray key without Ctrl+B does NOT fire the body', () => {
    const { coordinator, registry } = mkHarness();
    const r = coordinator.routeKey(key('2'));
    expect(r.type).toBe('passthrough');
    expect(registry.switches).toEqual([]);
  });
});
