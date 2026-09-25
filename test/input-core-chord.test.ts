import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  armChordLeader,
  consumeChordContinuation,
  isInputCoreChordArmed,
  disarmChordLeader,
  addDefaultBinding,
  registerAction,
  resolveInputEvent,
  keyEvent,
  __resetChordStateForTests,
  __resetBindingsForTests,
  __resetActionRegistryForTests,
  __resetContextForTests,
} from '../src/input-core/index.js';
import type { Key } from '../src/tui.js';

function k(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

beforeEach(() => {
  __resetChordStateForTests();
  __resetBindingsForTests();
  __resetActionRegistryForTests();
  __resetContextForTests();
});

afterEach(() => {
  __resetChordStateForTests();
  __resetBindingsForTests();
  __resetActionRegistryForTests();
  __resetContextForTests();
});

describe('chord-state — arm / consume / disarm', () => {
  test('armed ↔ isChordArmed reflects state', () => {
    expect(isInputCoreChordArmed()).toBe(false);
    armChordLeader('ctrl+b');
    expect(isInputCoreChordArmed()).toBe(true);
  });

  test('consumeChordContinuation returns combined matcher and disarms', () => {
    armChordLeader('ctrl+b');
    expect(consumeChordContinuation('s')).toBe('ctrl+b s');
    expect(isInputCoreChordArmed()).toBe(false);
  });

  test('consumeChordContinuation returns null when not armed', () => {
    expect(consumeChordContinuation('s')).toBeNull();
  });

  test('disarmChordLeader clears armed state without firing onTimeout', () => {
    let fired = 0;
    armChordLeader('ctrl+b', () => { fired++; });
    disarmChordLeader();
    expect(isInputCoreChordArmed()).toBe(false);
    expect(fired).toBe(0);
  });

  test('re-arming replaces the prior leader and clears the old timer', () => {
    let firstTimeout = 0;
    armChordLeader('ctrl+b', () => { firstTimeout++; });
    armChordLeader('ctrl+x');
    // First timer's onTimeout must not fire because we replaced it.
    expect(consumeChordContinuation('y')).toBe('ctrl+x y');
    expect(firstTimeout).toBe(0);
  });

  test('matcher is canonicalized to lowercase', () => {
    armChordLeader('Ctrl+B');
    expect(consumeChordContinuation('S')).toBe('ctrl+b s');
  });
});

describe('chord-state — resolver integration', () => {
  test('resolveInputEvent finds ctrl+b s binding when chord is armed', () => {
    registerAction({ id: 'mode.enter.sync', handler: () => {} });
    addDefaultBinding({ matcher: 'ctrl+b s', actionId: 'mode.enter.sync' });
    armChordLeader('ctrl+b');
    const r = resolveInputEvent(keyEvent(k('s')));
    expect(r?.actionId).toBe('mode.enter.sync');
    expect(r?.matcher).toBe('ctrl+b s');
    // Chord consumed, no longer armed.
    expect(isInputCoreChordArmed()).toBe(false);
  });

  test('chord-armed letter without binding falls through to plain matcher', () => {
    registerAction({ id: 'plain.s', handler: () => {} });
    addDefaultBinding({ matcher: 's', actionId: 'plain.s' });
    armChordLeader('ctrl+b');
    // `ctrl+b s` not bound; fallback tries plain `s`, which IS bound.
    const r = resolveInputEvent(keyEvent(k('s')));
    expect(r?.actionId).toBe('plain.s');
    expect(r?.matcher).toBe('s');
    expect(isInputCoreChordArmed()).toBe(false);  // chord still disarmed
  });

  test('chord-armed letter without any binding returns null and disarms', () => {
    armChordLeader('ctrl+b');
    const r = resolveInputEvent(keyEvent(k('s')));
    expect(r).toBeNull();
    expect(isInputCoreChordArmed()).toBe(false);
  });

  test('multiple chords do not leak state between tests (sanity)', () => {
    registerAction({ id: 'a', handler: () => {} });
    registerAction({ id: 'b', handler: () => {} });
    addDefaultBinding({ matcher: 'ctrl+b s', actionId: 'a' });
    addDefaultBinding({ matcher: 'ctrl+b c', actionId: 'b' });
    armChordLeader('ctrl+b');
    expect(resolveInputEvent(keyEvent(k('s')))?.actionId).toBe('a');
    // Second time requires re-arming.
    expect(resolveInputEvent(keyEvent(k('c')))).toBeNull();
    armChordLeader('ctrl+b');
    expect(resolveInputEvent(keyEvent(k('c')))?.actionId).toBe('b');
  });

  test('mouse events do NOT consume chord state', () => {
    armChordLeader('ctrl+b');
    const r = resolveInputEvent({
      kind: 'mouse', type: 'click', row: 5, col: 5,
      target: { kind: 'unknown' },
    });
    expect(r).toBeNull();
    // Chord still armed — mouse is never a chord continuation.
    expect(isInputCoreChordArmed()).toBe(true);
  });
});
