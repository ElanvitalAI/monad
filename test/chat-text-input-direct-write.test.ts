import { describe, expect, test } from 'bun:test';

import { resolveTextInputDirectWriteStrategy } from '../src/chat/index.js';

describe('resolveTextInputDirectWriteStrategy', () => {
  test('uses scoped invalidation when prompt row is known', () => {
    expect(resolveTextInputDirectWriteStrategy(12)).toEqual({
      kind: 'scoped-invalidate',
      fromRow: 12,
    });
  });

  test('falls back to full reset when prompt row is unknown', () => {
    expect(resolveTextInputDirectWriteStrategy(-1)).toEqual({
      kind: 'full-reset',
    });
  });
});
