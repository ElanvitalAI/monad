import { describe, expect, test } from 'bun:test';

import {
  resolveBellSubmitAction,
  runBellSubmitAction,
} from '../src/dashboard/input/bell-actions.js';

describe('dashboard bell actions', () => {
  test('resolves bell submit text into semantic actions', () => {
    expect(resolveBellSubmitAction('bell:close')).toEqual({ kind: 'close' });
    expect(resolveBellSubmitAction('bell:filter:u')).toEqual({ kind: 'filter', filter: 'u' });
    expect(resolveBellSubmitAction('bell:focus:session-1')).toEqual({
      kind: 'focus-session',
      sessionId: 'session-1',
    });
    expect(resolveBellSubmitAction('not-bell')).toBeNull();
  });

  test('runner dispatches to the matching bell effect', () => {
    const seen: string[] = [];
    runBellSubmitAction(
      { kind: 'focus-session', sessionId: 'session-1' },
      {
        closeBell: () => seen.push('close'),
        setFilter: (filter) => seen.push(`filter:${filter}`),
        focusSession: (sessionId) => seen.push(`focus:${sessionId}`),
      },
    );
    expect(seen).toEqual(['focus:session-1']);
  });
});
