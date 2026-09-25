import { describe, expect, test } from 'bun:test';

import { createDashboardInputPrefixState } from '../src/dashboard/input/input-prefix-state.js';

describe('dashboard input prefix state', () => {
  test('appendInline joins tokens with spaces and consume clears the buffer', () => {
    const state = createDashboardInputPrefixState();
    state.appendInline('/foo ');
    state.appendInline('bar ');
    expect(state.get()).toBe('/foo  bar ');
    expect(state.consumeInitialText('plain')).toBe('/foo  bar ');
    expect(state.get()).toBe('');
  });

  test('appendBlock joins entries with newlines', () => {
    const state = createDashboardInputPrefixState();
    state.appendBlock('alpha');
    state.appendBlock('beta');
    expect(state.get()).toBe('alpha\nbeta');
  });

  test('slash mode prefixes a slash during consume', () => {
    const state = createDashboardInputPrefixState();
    state.set('research topic');
    expect(state.consumeInitialText('slash')).toBe('/research topic');
    expect(state.get()).toBe('');
  });
});
