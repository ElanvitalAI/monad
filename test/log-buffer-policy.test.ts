import { describe, expect, test } from 'bun:test';
import {
  CHAT_LOG_BUFFER_SOFT_LIMIT,
  DEBUG_LOG_BUFFER_SOFT_LIMIT,
  trimLogBuffer,
} from '../src/log-pane/buffer-policy.js';

describe('log buffer policy', () => {
  test('exports explicit soft limits for chat and debug surfaces', () => {
    expect(CHAT_LOG_BUFFER_SOFT_LIMIT).toBe(20_000);
    expect(DEBUG_LOG_BUFFER_SOFT_LIMIT).toBe(20_000);
  });

  test('keeps lines untouched when already under the limit', () => {
    const lines = ['a', 'b', 'c'];
    const dropped = trimLogBuffer(lines, 5);
    expect(dropped).toBe(0);
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  test('trims oldest lines first when the buffer exceeds the limit', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const dropped = trimLogBuffer(lines, 3);
    expect(dropped).toBe(2);
    expect(lines).toEqual(['c', 'd', 'e']);
  });
});
