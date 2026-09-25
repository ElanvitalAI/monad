import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainEntryPrelude } from '../src/dashboard/input/chat-main-entry-prelude.js';
import { createDashboardFocusTransitionState } from '../src/dashboard/input/focus-transition-state.js';
import { createDashboardInputPrefixState } from '../src/dashboard/input/input-prefix-state.js';

describe('dashboard chat main entry prelude', () => {
  test('slash key consumes pending prefix as quick slash input', () => {
    const focusTransitionState = createDashboardFocusTransitionState();
    const inputPrefixState = createDashboardInputPrefixState();
    inputPrefixState.set('ctx drop 3');

    expect(resolveDashboardChatMainEntryPrelude(
      { name: '/', ctrl: false, shift: false } as never,
      { focusTransitionState, inputPrefixState },
    )).toEqual({
      mode: 'slash',
      slashQuickMode: true,
      initialText: '/ctx drop 3',
    });
    expect(inputPrefixState.get()).toBe('');
    expect(focusTransitionState.getPendingInputEntryMode()).toBeNull();
  });

  test('pending input mode takes precedence over the triggering key and is consumed', () => {
    const focusTransitionState = createDashboardFocusTransitionState();
    const inputPrefixState = createDashboardInputPrefixState();
    focusTransitionState.setPendingInputEntryMode('plain');
    inputPrefixState.appendBlock('queued attachment block');

    expect(resolveDashboardChatMainEntryPrelude(
      { name: 'x', ctrl: false, shift: false } as never,
      { focusTransitionState, inputPrefixState },
    )).toEqual({
      mode: 'plain',
      slashQuickMode: false,
      initialText: 'queued attachment block',
    });
    expect(focusTransitionState.getPendingInputEntryMode()).toBeNull();
    expect(inputPrefixState.get()).toBe('');
  });

  test('returns null when no input entry is requested', () => {
    const focusTransitionState = createDashboardFocusTransitionState();
    const inputPrefixState = createDashboardInputPrefixState();

    expect(resolveDashboardChatMainEntryPrelude(
      { name: 'x', ctrl: false, shift: false } as never,
      { focusTransitionState, inputPrefixState },
    )).toBeNull();
  });
});
