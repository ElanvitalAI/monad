// src/autopilot/terminal-forwarder.test.ts
//
// Bun test scaffold for the daemon-internal forwarder. Integration with
// a real PreviewTerminal is deferred — these cases cover the early
// validation paths (missing ids / wrong types / unknown terminal lookup)
// which exercise the public contract without needing a live PTY.

import { describe, test, expect } from 'bun:test';
import {
  forwardToUserTerminal,
  forwardSequence,
  type ForwardInput,
} from './terminal-forwarder.js';

const base: ForwardInput = {
  sessionId: '',
  terminalId: '',
  data: '',
  source: 'autopilot',
};

describe('forwardToUserTerminal — early validation', () => {
  test('missing sessionId → missing-ids', () => {
    const r = forwardToUserTerminal({ ...base, sessionId: '', terminalId: 't1', data: 'x' });
    expect(r).toEqual({ delivered: false, bytes: 0, reason: 'missing-ids' });
  });

  test('missing terminalId → missing-ids', () => {
    const r = forwardToUserTerminal({ ...base, sessionId: 's1', terminalId: '', data: 'x' });
    expect(r).toEqual({ delivered: false, bytes: 0, reason: 'missing-ids' });
  });

  test('non-string data → data-not-string', () => {
    const r = forwardToUserTerminal({
      ...base,
      sessionId: 's1',
      terminalId: 't1',
      // intentional bad shape
      data: 123 as unknown as string,
    });
    expect(r).toEqual({ delivered: false, bytes: 0, reason: 'data-not-string' });
  });
});

describe('forwardToUserTerminal — unknown terminal', () => {
  test('valid ids but no registered terminal → unknown_terminal', () => {
    const r = forwardToUserTerminal({
      sessionId: 's-nope',
      terminalId: 't-nope',
      data: 'ls\n',
      source: 'autopilot',
      origin: 'test',
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('unknown_terminal');
  });
});

describe('forwardSequence', () => {
  test('aborts on first non-delivered chunk', () => {
    const r = forwardSequence(
      { sessionId: 's1', terminalId: 't1', source: 'autopilot' },
      ['ls', '\n', ':q'],
    );
    // first chunk fails → cumulative bytes 0
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('unknown_terminal');
  });

  test('empty chunks → trivially delivered', () => {
    const r = forwardSequence({ sessionId: 's1', terminalId: 't1', source: 'autopilot' }, []);
    expect(r).toEqual({ delivered: true, bytes: 0 });
  });
});
