// Unit tests for ACP subagent meta helpers — H3 #7.
//
// Pure data-shape + round-trip tests. No subprocess / no side effects.

import { describe, expect, test } from 'bun:test';
import {
  readSubagentMeta,
  writeSubagentMeta,
  SUBAGENT_SESSION_INFO_META_KEY,
} from '../src/acp/subagent-meta.js';

describe('subagent meta · round-trip', () => {
  test('writeSubagentMeta produces the canonical Zed key', () => {
    const meta = writeSubagentMeta({ parentSessionId: 'p', sessionId: 'c' });
    expect(Object.keys(meta)).toContain(SUBAGENT_SESSION_INFO_META_KEY);
  });

  test('round-trip preserves parent + session', () => {
    const info = { parentSessionId: 'acp-cli:claude:root', sessionId: 'acp-cli:claude:child' };
    const meta = writeSubagentMeta(info);
    const parsed = readSubagentMeta(meta);
    expect(parsed).toEqual(info);
  });

  test('round-trip preserves optional outputIndex', () => {
    const info = { parentSessionId: 'p', sessionId: 'c', outputIndex: 3 };
    const parsed = readSubagentMeta(writeSubagentMeta(info));
    expect(parsed).toEqual(info);
  });

  test('round-trip without outputIndex omits the field on parse', () => {
    const info = { parentSessionId: 'p', sessionId: 'c' };
    const parsed = readSubagentMeta(writeSubagentMeta(info));
    expect(parsed?.outputIndex).toBeUndefined();
  });
});

describe('subagent meta · tolerant reader', () => {
  test('readSubagentMeta(undefined) → null', () => {
    expect(readSubagentMeta(undefined)).toBeNull();
  });

  test('readSubagentMeta(null) → null', () => {
    expect(readSubagentMeta(null)).toBeNull();
  });

  test('readSubagentMeta({}) → null (no key)', () => {
    expect(readSubagentMeta({})).toBeNull();
  });

  test('readSubagentMeta with malformed key payload → null', () => {
    expect(readSubagentMeta({ [SUBAGENT_SESSION_INFO_META_KEY]: 'not-an-object' })).toBeNull();
  });

  test('readSubagentMeta missing parentSessionId → null', () => {
    const meta = { [SUBAGENT_SESSION_INFO_META_KEY]: { sessionId: 'c' } };
    expect(readSubagentMeta(meta)).toBeNull();
  });

  test('readSubagentMeta missing sessionId → null', () => {
    const meta = { [SUBAGENT_SESSION_INFO_META_KEY]: { parentSessionId: 'p' } };
    expect(readSubagentMeta(meta)).toBeNull();
  });

  test('readSubagentMeta empty-string ids → null', () => {
    const meta = { [SUBAGENT_SESSION_INFO_META_KEY]: { parentSessionId: '', sessionId: '' } };
    expect(readSubagentMeta(meta)).toBeNull();
  });

  test('readSubagentMeta ignores extra/unknown fields', () => {
    const meta = {
      [SUBAGENT_SESSION_INFO_META_KEY]: {
        parentSessionId: 'p',
        sessionId: 'c',
        unknownField: 'should-be-ignored',
      },
    };
    const parsed = readSubagentMeta(meta);
    expect(parsed).toEqual({ parentSessionId: 'p', sessionId: 'c' });
  });
});
