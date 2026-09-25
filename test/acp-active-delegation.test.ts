// P1 — active ACP delegation store: NL follow-ups continue the bound ACP
// session until an explicit exit or TTL. Pure/in-memory.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  setActiveDelegation, getActiveDelegation, touchActiveDelegation,
  clearActiveDelegation, delegationChatKey, DELEGATION_TTL_MS,
  _resetActiveDelegationForTests,
} from '../src/acp/active-delegation';

afterEach(() => _resetActiveDelegationForTests());

describe('active delegation store', () => {
  const k = delegationChatKey('BOT', 42, undefined);

  test('set → get returns the backend key', () => {
    setActiveDelegation(k, 'codex', 1000);
    expect(getActiveDelegation(k, 1000)).toBe('codex');
  });

  test('null when never set', () => {
    expect(getActiveDelegation(delegationChatKey('BOT', 99))).toBeNull();
  });

  test('expires after the TTL (and is pruned on read)', () => {
    setActiveDelegation(k, 'claude', 1000);
    expect(getActiveDelegation(k, 1000 + DELEGATION_TTL_MS - 1)).toBe('claude');
    expect(getActiveDelegation(k, 1000 + DELEGATION_TTL_MS + 1)).toBeNull();
    // pruned → still null even if we query at the original time
    expect(getActiveDelegation(k, 1000)).toBeNull();
  });

  test('touch refreshes the idle timer', () => {
    setActiveDelegation(k, 'gemini', 1000);
    touchActiveDelegation(k, 1000 + DELEGATION_TTL_MS - 1); // refresh near expiry
    // now valid for another full TTL from the touch time
    expect(getActiveDelegation(k, 1000 + DELEGATION_TTL_MS + 100)).toBe('gemini');
  });

  test('clear exits the mode', () => {
    setActiveDelegation(k, 'codex', 1000);
    clearActiveDelegation(k);
    expect(getActiveDelegation(k, 1000)).toBeNull();
  });

  test('chat key is bot- and thread-scoped', () => {
    expect(delegationChatKey('A', 1, 2)).toBe('A:1:2');
    expect(delegationChatKey('A', 1)).toBe('A:1:0');
    expect(delegationChatKey('A', 1)).not.toBe(delegationChatKey('B', 1));
  });
});
