import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  registerMode,
  setMode,
  activeMode,
  getMode,
  listModes,
  registerBuiltInModes,
  resolveInputEvent,
  addDefaultBinding,
  registerAction,
  keyEvent,
  __resetModeManagerForTests,
  __resetActionRegistryForTests,
  __resetBindingsForTests,
  __resetContextForTests,
} from '../src/input-core/index.js';
import type { Key } from '../src/tui.js';

function k(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

beforeEach(() => {
  __resetModeManagerForTests();
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
});

afterEach(() => {
  __resetModeManagerForTests();
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
});

describe('mode — registration + lookup', () => {
  test('registerBuiltInModes seeds general / control', () => {
    registerBuiltInModes();
    expect(getMode('general')?.title).toBe('General');
    expect(getMode('control')?.title).toBe('Control');
    expect(listModes()).toHaveLength(2);
  });

  test('sync ModeId was retired (Arc A) — getMode("sync") returns null', () => {
    registerBuiltInModes();
    // ModeId no longer includes 'sync'; the cast is a deliberate
    // regression guard for callers passing legacy strings.
    expect(getMode('sync' as never)).toBeNull();
  });

  test('default active mode is general (even before registration)', () => {
    expect(activeMode()).toBe('general');
  });

  test('setMode is a no-op when mode is already active', async () => {
    registerBuiltInModes();
    let enterCount = 0;
    registerMode({
      id: 'general', title: 'General',
      onEnter: () => { enterCount++; },
      onExit: () => {},
    });
    expect(activeMode()).toBe('general');
    await setMode('general');
    expect(enterCount).toBe(0);  // no re-enter
  });
});

describe('mode — transition semantics', () => {
  test('switching mode fires onExit(prev) then onEnter(next)', async () => {
    const trace: string[] = [];
    registerMode({
      id: 'general', title: 'General',
      onEnter: () => { trace.push('general:enter'); },
      onExit: () => { trace.push('general:exit'); },
    });
    registerMode({
      id: 'control', title: 'Control', contextTag: 'control-mode',
      onEnter: () => { trace.push('control:enter'); },
      onExit: () => { trace.push('control:exit'); },
    });
    await setMode('control');
    expect(trace).toEqual(['general:exit', 'control:enter']);
    expect(activeMode()).toBe('control');
    await setMode('general');
    expect(trace).toEqual(['general:exit', 'control:enter', 'control:exit', 'general:enter']);
    expect(activeMode()).toBe('general');
  });

  test('unknown mode id is a no-op — stays in prior mode', async () => {
    registerBuiltInModes();
    // 'bogus' not a registered id → setMode returns the prior mode.
    const after = await setMode('bogus' as never);
    expect(after).toBe('general');
    expect(activeMode()).toBe('general');
  });

  test('onEnter throwing keeps the prior mode active', async () => {
    registerMode({
      id: 'general', title: 'General',
      onEnter: () => {}, onExit: () => {},
    });
    registerMode({
      id: 'control', title: 'Control', contextTag: 'control-mode',
      onEnter: () => { throw new Error('control init blew up'); },
      onExit: () => {},
    });
    await setMode('control');
    expect(activeMode()).toBe('general');
  });

  test('onExit throwing does NOT block the transition', async () => {
    registerMode({
      id: 'general', title: 'General',
      onEnter: () => {}, onExit: () => { throw new Error('cleanup failed'); },
    });
    registerMode({
      id: 'control', title: 'Control', contextTag: 'control-mode',
      onEnter: () => {}, onExit: () => {},
    });
    await setMode('control');
    expect(activeMode()).toBe('control');
  });
});

describe('mode — context integration with resolver', () => {
  test('control-mode tag pushes when control mode enters', async () => {
    registerBuiltInModes();
    registerAction({ id: 'control.only', handler: () => {} });
    addDefaultBinding({
      matcher: 'ctrl+q',
      actionId: 'control.only',
      context: 'control-mode',
    });
    // Reserved key — but validateRebind only applies to setRuntimeBinding,
    // not addDefaultBinding. Defaults for reserved keys are a normal
    // thing (Ctrl+C default IS app.interrupt). Here we just want to
    // verify context gating works across mode switches.
    await setMode('control');
    expect(resolveInputEvent(keyEvent(k('q', { ctrl: true })))?.actionId)
      .toBe('control.only');
    await setMode('general');
    expect(resolveInputEvent(keyEvent(k('q', { ctrl: true })))).toBeNull();
  });
});
