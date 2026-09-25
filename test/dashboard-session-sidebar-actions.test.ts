import { describe, expect, test } from 'bun:test';

import {
  cycleSessionSidebarCursor,
  focusSessionSidebarCursor,
  revealSessionInSidebar,
} from '../src/dashboard/input/session-sidebar-actions.js';

describe('dashboard session sidebar actions', () => {
  test('focus helper returns the currently selected session id', () => {
    const state = {
      cards: [{ id: 'a' }, { id: 'b' }],
      cursor: 1,
      offset: 0,
    } as any;
    expect(focusSessionSidebarCursor(state)).toEqual({ sessionId: 'b' });
  });

  test('cycle helper moves the cursor and returns the landed session id', () => {
    const state = {
      cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      cursor: 1,
      offset: 0,
    } as any;
    expect(cycleSessionSidebarCursor(state, 1)).toEqual({ sessionId: 'c' });
    expect(state.cursor).toBe(2);
  });

  test('reveal helper moves cursor to a matching session when present', () => {
    const state = {
      cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      cursor: 0,
      offset: 0,
    } as any;
    expect(revealSessionInSidebar(state, 'c')).toBe(true);
    expect(state.cursor).toBe(2);
    expect(revealSessionInSidebar(state, 'missing')).toBe(false);
  });
});
