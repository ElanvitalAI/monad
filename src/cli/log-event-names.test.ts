import { expect, test } from 'bun:test';
import { KNOWN_LOG_EVENT_NAMES } from './log-event-names.js';

test('hold settlement and owner-child-watch observations are allowlisted', () => {
  expect(KNOWN_LOG_EVENT_NAMES).toEqual(expect.objectContaining(new Set([
    'hold-wait-settlement-failed',
    'hold-owner-child-died',
    'hold-owner-watch-timeout',
  ])));
});
