import { describe, expect, it } from 'bun:test';

import { parseTurnBusyBanner, reduceTurnBusyBanner, type TurnBusyBanner } from './turn-busy';

describe('parseTurnBusyBanner', () => {
  it('preserves the daemon holder for a turn_busy rejection', () => {
    expect(parseTurnBusyBanner({
      error: 'turn_busy',
      message: 'This session is currently receiving input from PWA tab.',
      holder: 'PWA tab',
    })).toEqual({
      message: 'This session is currently receiving input from PWA tab.',
      holder: 'PWA tab',
    });
  });

  it('makes an absent or blank holder explicit without inventing a name', () => {
    expect(parseTurnBusyBanner({ error: 'turn_busy', message: 'Try again later.' })).toEqual({
      message: 'Try again later.',
      holder: null,
    });
    expect(parseTurnBusyBanner({ error: 'turn_busy', holder: '  ' })).toEqual({
      message: 'This session is currently receiving input. Please try again when that turn finishes.',
      holder: null,
    });
  });

  it('does not make a banner for another daemon error', () => {
    expect(parseTurnBusyBanner({ error: 'turn_failed', message: 'boom', holder: 'PWA tab' })).toBeNull();
  });

  it('rejects missing or malformed payloads', () => {
    expect(parseTurnBusyBanner(null)).toBeNull();
    expect(parseTurnBusyBanner('turn_busy')).toBeNull();
    expect(parseTurnBusyBanner({ message: 'missing error' })).toBeNull();
  });

  it('clears a prior banner for a session change, new turn, or completed turn', () => {
    const active: TurnBusyBanner = { message: 'Try again later.', holder: 'PWA tab' };
    expect(reduceTurnBusyBanner(active, { kind: 'session-change' })).toBeNull();
    expect(reduceTurnBusyBanner(active, { kind: 'turn-begin' })).toBeNull();
    expect(reduceTurnBusyBanner(active, { kind: 'turn-end' })).toBeNull();
  });

  it('clears a holder banner when a foreign observer starts a new turn', () => {
    const busyFromAnotherTab: TurnBusyBanner = {
      message: 'This session is currently receiving input from CLI.',
      holder: 'CLI',
    };
    expect(reduceTurnBusyBanner(busyFromAnotherTab, { kind: 'turn-begin' })).toBeNull();
  });

  it('only replaces a prior banner when a subsequent error is turn_busy', () => {
    const active: TurnBusyBanner = { message: 'Try again later.', holder: 'PWA tab' };
    expect(reduceTurnBusyBanner(active, {
      kind: 'error',
      payload: { error: 'turn_failed', message: 'boom' },
    })).toEqual(active);
    expect(reduceTurnBusyBanner(active, {
      kind: 'error',
      payload: { error: 'turn_busy', message: 'Busy from CLI.', holder: 'CLI' },
    })).toEqual({ message: 'Busy from CLI.', holder: 'CLI' });
  });
});
