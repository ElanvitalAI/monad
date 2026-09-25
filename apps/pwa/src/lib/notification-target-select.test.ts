// PR #1730 / BACKLOG #17 — contract test for the SW notificationclick
// client selection logic. The corresponding inline implementation in
// `apps/pwa/public/sw.js` mirrors this helper byte-for-byte; when this
// test changes, audit sw.js notificationclick handler + bump.

import { describe, expect, test } from 'bun:test';
import {
  selectNotificationTargetClient,
  shouldNavigateAfterFocus,
} from './notification-target-select';

const c = (url: string) => ({ url });

describe('selectNotificationTargetClient', () => {
  test('empty client list returns null', () => {
    expect(selectNotificationTargetClient([], { sessionId: 'abc' })).toBeNull();
  });

  test('prefers client whose URL contains matching session query', () => {
    const want = c('https://host/app/?session=abc');
    const result = selectNotificationTargetClient(
      [c('https://host/app/term'), want, c('https://host/app/chat')],
      { sessionId: 'abc' },
    );
    expect(result).toBe(want);
  });

  test('encodes special chars in session id when matching', () => {
    const want = c('https://host/app/?session=sess%2Fwith%20space');
    const result = selectNotificationTargetClient(
      [c('https://other/'), want],
      { sessionId: 'sess/with space' },
    );
    expect(result).toBe(want);
  });

  test('falls back to /app/ scope when no session match', () => {
    const wantScope = c('https://host/app/term');
    const result = selectNotificationTargetClient(
      [c('https://other/site'), wantScope, c('https://chat.openai.com/')],
      { sessionId: 'no-such-session' },
    );
    expect(result).toBe(wantScope);
  });

  test('falls back to /app/ scope when sessionId not provided', () => {
    const wantScope = c('https://host/app/');
    const result = selectNotificationTargetClient(
      [c('https://other/'), wantScope],
      {},
    );
    expect(result).toBe(wantScope);
  });

  test('falls back to first client when no scope match exists', () => {
    const wantFirst = c('https://other/page');
    const result = selectNotificationTargetClient(
      [wantFirst, c('https://still-other/')],
      { sessionId: 'abc' },
    );
    expect(result).toBe(wantFirst);
  });

  test('first session match wins over later /app/ scope match', () => {
    // session match must short-circuit even when an /app/ scope
    // client appears earlier in iteration order.
    const sessMatch = c('https://host/app/term?session=abc&q=2');
    const result = selectNotificationTargetClient(
      [c('https://host/app/chat'), sessMatch],
      { sessionId: 'abc' },
    );
    expect(result).toBe(sessMatch);
  });

  test('handles client with empty url string gracefully', () => {
    const wantScope = c('https://host/app/term');
    const result = selectNotificationTargetClient(
      [{ url: '' } as { url: string }, wantScope],
      { sessionId: 'abc' },
    );
    expect(result).toBe(wantScope);
  });

  test('ignores empty-string sessionId (treats as null)', () => {
    // Empty sessionId never matches `session=...` because the helper
    // short-circuits on `length > 0`. Both clients are /app/ scope —
    // first iteration wins.
    const first = c('https://host/app/?session=');
    const second = c('https://host/app/');
    const result = selectNotificationTargetClient([first, second], { sessionId: '' });
    expect(result).toBe(first);
  });
});

describe('shouldNavigateAfterFocus', () => {
  test('returns true when client url is undefined', () => {
    expect(shouldNavigateAfterFocus(undefined, '/app/', null)).toBe(true);
  });

  test('returns true when client url is empty', () => {
    expect(shouldNavigateAfterFocus('', '/app/', null)).toBe(true);
  });

  test('with sessionId: false when client url already contains matching session', () => {
    expect(
      shouldNavigateAfterFocus('https://host/app/?session=abc', '/app/?session=abc', 'abc'),
    ).toBe(false);
  });

  test('with sessionId: true when client url has different session', () => {
    expect(
      shouldNavigateAfterFocus('https://host/app/?session=xyz', '/app/?session=abc', 'abc'),
    ).toBe(true);
  });

  test('without sessionId: false when client url ends with target', () => {
    expect(shouldNavigateAfterFocus('https://host/app/', '/app/', null)).toBe(false);
  });

  test('without sessionId: true when client url has different path', () => {
    expect(shouldNavigateAfterFocus('https://host/app/term', '/app/', null)).toBe(true);
  });

  test('encodes special chars when comparing session match', () => {
    expect(
      shouldNavigateAfterFocus(
        'https://host/app/?session=sess%2Fwith%20space',
        '/app/?session=sess%2Fwith%20space',
        'sess/with space',
      ),
    ).toBe(false);
  });
});
