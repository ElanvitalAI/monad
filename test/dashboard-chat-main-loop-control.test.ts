import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainLoopControl } from '../src/dashboard/input/chat-main-loop-control.js';

describe('dashboard chat main loop control', () => {
  test('re-enters input when a view switch chord is returned', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: '', submitted: false, viewSwitch: '4' },
      { isChatOnlyMode: false, hasActiveSessionControl: false },
    )).toEqual({ kind: 'view-switch', viewSwitch: '4' });
  });

  test('exits input when gotoPane is requested', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: '', submitted: false, gotoPane: true },
      { isChatOnlyMode: true, hasActiveSessionControl: true },
    )).toEqual({ kind: 'goto-pane' });
  });

  test('escape in session control mode resolves to control cancellation', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: '', submitted: false, cancelledBy: 'escape' },
      { isChatOnlyMode: false, hasActiveSessionControl: true },
    )).toEqual({ kind: 'cancel-session-control' });
  });

  test('chat-only mode keeps the input loop alive on empty cancel', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: '', submitted: false },
      { isChatOnlyMode: true, hasActiveSessionControl: false },
    )).toEqual({ kind: 'continue-chat-only' });
  });

  test('dashboard mode exits input on empty cancel', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: '', submitted: false },
      { isChatOnlyMode: false, hasActiveSessionControl: false },
    )).toEqual({ kind: 'exit-input' });
  });

  test('non-empty submit continues into submit handling', () => {
    expect(resolveDashboardChatMainLoopControl(
      { text: 'hello', submitted: true },
      { isChatOnlyMode: false, hasActiveSessionControl: false },
    )).toEqual({ kind: 'submit' });
  });
});
