import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainPostTurn } from '../src/dashboard/input/chat-main-post-turn.js';

describe('dashboard chat main post turn', () => {
  test('requests input-line reset and history persistence for a new submit', () => {
    expect(resolveDashboardChatMainPostTurn(
      { text: 'hello', submitted: true },
      {
        inputLines: 3,
        isChatOnlyMode: false,
        hasActiveSessionControl: false,
        lastHistoryEntry: 'older',
        cwd: '/repo',
        activeViewId: 'main',
        focusedPane: 'log',
        provider: 'openai',
      },
    )).toEqual({
      shouldResetInputLines: true,
      nextInitialText: undefined,
      loopControl: { kind: 'submit' },
      historyRecord: {
        text: 'hello',
        cwd: '/repo',
        activeView: 'main',
        focusedPane: 'log',
        metadata: {
          chatOnlyMode: false,
          provider: 'openai',
        },
      },
    });
  });

  test('does not record duplicate history or reset lines when already single-line', () => {
    expect(resolveDashboardChatMainPostTurn(
      { text: 'hello', submitted: true },
      {
        inputLines: 1,
        isChatOnlyMode: false,
        hasActiveSessionControl: false,
        lastHistoryEntry: 'hello',
        cwd: '/repo',
        activeViewId: 'main',
        focusedPane: 'log',
        provider: null,
      },
    )).toEqual({
      shouldResetInputLines: false,
      nextInitialText: undefined,
      loopControl: { kind: 'submit' },
      historyRecord: null,
    });
  });

  test('propagates non-submit loop control without forcing history persistence', () => {
    expect(resolveDashboardChatMainPostTurn(
      { text: '', submitted: false, viewSwitch: '4' },
      {
        inputLines: 2,
        isChatOnlyMode: false,
        hasActiveSessionControl: false,
        cwd: '/repo',
        activeViewId: 'main',
        focusedPane: 'log',
        provider: null,
      },
    )).toEqual({
      shouldResetInputLines: true,
      nextInitialText: undefined,
      loopControl: { kind: 'view-switch', viewSwitch: '4' },
      historyRecord: null,
    });
  });
});
