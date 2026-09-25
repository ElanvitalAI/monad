import { describe, expect, it } from 'bun:test';
import { INPUT_SOURCE_KINDS, isInputSourceKind } from './input-source-kind.js';

describe('input source kind — harness is not a new sourceKind', () => {
  it('does not add harness to the closed sourceKind vocabulary', () => {
    expect(isInputSourceKind('harness')).toBe(false);
    expect(INPUT_SOURCE_KINDS.includes('harness' as typeof INPUT_SOURCE_KINDS[number])).toBe(false);
  });
});
