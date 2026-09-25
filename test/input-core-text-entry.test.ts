import { describe, expect, test } from 'bun:test';

import { keyEventToTextInsertion } from '../src/input-core/text-entry.js';

describe('keyEventToTextInsertion', () => {
  test('maps named space to a literal space', () => {
    expect(keyEventToTextInsertion({ name: 'space' })).toBe(' ');
  });

  test('accepts multi-byte text input', () => {
    expect(keyEventToTextInsertion({ name: '가' })).toBe('가');
    expect(keyEventToTextInsertion({ name: '🙂' })).toBe('🙂');
  });

  test('preserves uppercase sequence when terminals do not set shift', () => {
    expect(keyEventToTextInsertion({ name: 'a', sequence: 'A' })).toBe('A');
  });

  test('rejects control and navigation keys', () => {
    expect(keyEventToTextInsertion({ name: 'k', ctrl: true })).toBeNull();
    expect(keyEventToTextInsertion({ name: 'left' })).toBeNull();
    expect(keyEventToTextInsertion({ name: 'escape' })).toBeNull();
  });
});
