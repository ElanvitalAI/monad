import { describe, expect, test } from 'bun:test';

import {
  createChatModeState,
  enterControlMode,
  exitControlMode,
  isControlMode,
  modeElapsedLabel,
  parseControlSlash,
  armQuickControlOnce,
  consumeQuickControlOnce,
  toggleControlMode,
} from '../src/session-runtime/posture.js';

describe('chat-mode state', () => {
  test('default mode at construction', () => {
    const s = createChatModeState();
    expect(s.posture).toBe('general');
    expect(s.mode).toBe('default');
    expect(isControlMode(s)).toBe(false);
    expect(s.intent).toBeNull();
  });

  test('enterControlMode flips flag + timestamps + intent', () => {
    const s = createChatModeState();
    enterControlMode(s, { intent: 'split panes', now: () => 12345 });
    expect(s.posture).toBe('control');
    expect(s.mode).toBe('dashboard-control');
    expect(isControlMode(s)).toBe(true);
    expect(s.enteredAt).toBe(12345);
    expect(s.intent).toBe('split panes');
  });

  test('enterControlMode without intent leaves it null', () => {
    const s = createChatModeState();
    enterControlMode(s);
    expect(s.intent).toBeNull();
  });

  test('exitControlMode reverts to default + clears intent', () => {
    const s = createChatModeState();
    enterControlMode(s, { intent: 'work' });
    exitControlMode(s);
    expect(s.posture).toBe('general');
    expect(s.mode).toBe('default');
    expect(s.intent).toBeNull();
  });

  test('modeElapsedLabel renders seconds/minutes/hours', () => {
    const s = createChatModeState();
    enterControlMode(s, { now: () => 0 });
    expect(modeElapsedLabel(s, 5_000)).toBe('5s');
    expect(modeElapsedLabel(s, 90_000)).toBe('1m');
    expect(modeElapsedLabel(s, 7_200_000)).toBe('2h');
  });

  test('intent strings are trimmed', () => {
    const s = createChatModeState();
    enterControlMode(s, { intent: '   fix build   ' });
    expect(s.intent).toBe('fix build');
  });

  test('parseControlSlash enters with joined intent', () => {
    expect(parseControlSlash('control', ['fix', 'layout'], false)).toEqual({
      kind: 'enter',
      intent: 'fix layout',
    });
    expect(parseControlSlash('dm', ['ship'], true)).toEqual({
      kind: 'enter',
      intent: 'ship',
    });
  });

  test('parseControlSlash exits via control off/exit or default', () => {
    expect(parseControlSlash('control', ['off'], true)).toEqual({
      kind: 'exit',
      source: 'control',
      alreadyDefault: false,
    });
    expect(parseControlSlash('control', ['exit'], false)).toEqual({
      kind: 'exit',
      source: 'control',
      alreadyDefault: true,
    });
    expect(parseControlSlash('default', [], true)).toEqual({
      kind: 'exit',
      source: 'default',
      alreadyDefault: false,
    });
  });
});

describe('chat-mode quick-control (Phase α1)', () => {
  test('new state has quickControlOnce=false', () => {
    const s = createChatModeState();
    expect(s.quickControlOnce).toBe(false);
    expect(isControlMode(s)).toBe(false);
  });

  test('armQuickControlOnce flips isControlMode without touching persistent mode', () => {
    const s = createChatModeState();
    armQuickControlOnce(s, 'resize pane');
    expect(s.posture).toBe('general');
    expect(s.mode).toBe('default');
    expect(s.quickControlOnce).toBe(true);
    expect(isControlMode(s)).toBe(true);
    expect(s.intent).toBe('resize pane');
  });

  test('consumeQuickControlOnce returns true + clears flag once', () => {
    const s = createChatModeState();
    armQuickControlOnce(s);
    expect(consumeQuickControlOnce(s)).toBe(true);
    expect(s.quickControlOnce).toBe(false);
    expect(isControlMode(s)).toBe(false);
    // Second call no-op.
    expect(consumeQuickControlOnce(s)).toBe(false);
  });

  test('consumeQuickControlOnce preserves intent when persistent control is active', () => {
    const s = createChatModeState();
    enterControlMode(s, { intent: 'persistent goal' });
    armQuickControlOnce(s, 'one-shot intent');
    // Persistent intent should win on drain.
    consumeQuickControlOnce(s);
    expect(s.posture).toBe('control');
    expect(s.mode).toBe('dashboard-control');
    expect(s.intent).toBe('one-shot intent'); // arm overwrote — consume leaves it.
  });

  test('consumeQuickControlOnce clears intent when mode is default', () => {
    const s = createChatModeState();
    armQuickControlOnce(s, 'one-shot intent');
    consumeQuickControlOnce(s);
    expect(s.intent).toBeNull();
  });

  test('toggleControlMode flips persistent mode', () => {
    const s = createChatModeState();
    toggleControlMode(s);
    expect(s.posture).toBe('control');
    expect(s.mode).toBe('dashboard-control');
    toggleControlMode(s);
    expect(s.posture).toBe('general');
    expect(s.mode).toBe('default');
  });
});
