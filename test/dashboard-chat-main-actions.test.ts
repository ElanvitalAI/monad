import { describe, expect, test } from 'bun:test';

import {
  resolveChatMainInputPointerAction,
  resolveChatMainInputPreKeyAction,
  runChatMainInputPointerAction,
  runChatMainInputPreKeyAction,
} from '../src/dashboard/input/chat-main-actions.js';

describe('chat-main input actions', () => {
  test('pre-key action prefers an active status popup over other foreground UI', () => {
    const action = resolveChatMainInputPreKeyAction(
      { name: 'escape', raw: '\u001b' },
      {
        hasActiveStatusPopup: true,
        hasTerminalModal: true,
        toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      },
    );
    expect(action.kind).toBe('interact-status-popup');
  });

  test('pre-key action falls back to terminal modal before coordinator modal', () => {
    const action = resolveChatMainInputPreKeyAction(
      { name: 'enter', raw: '\r' },
      {
        hasActiveStatusPopup: false,
        hasTerminalModal: true,
        toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      },
    );
    expect(action).toEqual({
      kind: 'interact-terminal-modal',
      keyEvent: { name: 'enter', sequence: '\r' },
    });
  });

  test('pre-key action defaults to the foreground modal route', () => {
    const action = resolveChatMainInputPreKeyAction(
      { name: 'j', raw: 'j' },
      {
        hasActiveStatusPopup: false,
        hasTerminalModal: false,
        toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      },
    );
    expect(action).toEqual({
      kind: 'interact-foreground-modal',
      keyEvent: { name: 'j', sequence: 'j' },
    });
  });

  test('pre-key mouse action bypasses foreground modal key routing', () => {
    const action = resolveChatMainInputPreKeyAction(
      {
        name: 'mouse',
        raw: '',
        mouse: { row: 5, col: 8, type: 'click' },
      } as any,
      {
        hasActiveStatusPopup: true,
        hasTerminalModal: true,
        toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      },
    );
    expect(action).toEqual({
      kind: 'interact-input-surface',
      mouse: { row: 5, col: 8, type: 'click' },
    });
  });

  test('terminal close redraws and resolves to consumed', async () => {
    let redraws = 0;
    const result = await runChatMainInputPreKeyAction(
      { kind: 'interact-terminal-modal', keyEvent: { name: 'escape' } },
      {
        routeStatusPopupKey: () => 'passthrough',
        handleTerminalModalKey: () => 'closed',
        tryRouteForegroundModalKey: async () => 'passthrough',
        redraw: () => { redraws++; },
      },
    );
    expect(result).toBe('consumed');
    expect(redraws).toBe(1);
  });

  test('pointer action delegates to the injected mouse dispatcher', () => {
    const seen: string[] = [];
    runChatMainInputPointerAction(
      resolveChatMainInputPointerAction({ row: 5, col: 8, type: 'click' }),
      {
        dispatchMouse: (mouse) => {
          seen.push(`${mouse.type}:${mouse.row}:${mouse.col}`);
        },
      },
    );
    expect(seen).toEqual(['click:5:8']);
  });
});
