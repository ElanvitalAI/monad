import { describe, expect, it } from 'bun:test';
import { createIntakeStore } from '../src/intake-plane/store.js';
import {
  detectAmbientIntakeCandidate,
  maybeHandleAmbientTextIntake,
} from '../src/intake-plane/ambient.js';

describe('detectAmbientIntakeCandidate', () => {
  it('ignores ordinary short chat', () => {
    expect(detectAmbientIntakeCandidate('hello there').matched).toBe(false);
  });

  it('matches multiline bullet/link notes', () => {
    const detection = detectAmbientIntakeCandidate([
      '- compare two repos',
      '- investigate image preview bug',
      'https://github.com/example/a',
      'https://github.com/example/b',
    ].join('\n'));
    expect(detection.matched).toBe(true);
    expect(detection.reason).toContain('multiple bullet items');
  });
});

describe('maybeHandleAmbientTextIntake', () => {
  const memo = [
    '- compare two repos',
    '- investigate image preview bug',
    'https://github.com/example/a',
    'https://github.com/example/b',
  ].join('\n');

  it('suggest mode returns a channel-flavored hint', async () => {
    const reply = await maybeHandleAmbientTextIntake({
      surface: 'telegram',
      source: 'telegram',
      text: memo,
      mode: 'suggest',
    });
    expect(reply).toContain('This looks like a scratch note');
    expect(reply).toContain('capture: /intake');
    expect(reply).toContain('fast paths: /intake now <text...>');
  });

  it('capture mode creates a review intake session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const reply = await maybeHandleAmbientTextIntake({
      surface: 'discord',
      source: 'discord',
      text: memo,
      mode: 'capture',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-ambient-1',
    });
    expect(reply).toContain('Ambient intake: intake-ambient-1 [review-ready]');
    expect(reply).toContain('next:');
    expect(reply).toContain('!intake decide apply-now intake-ambient-1');
    expect(store.getSession('intake-ambient-1')?.raw.source).toBe('discord');
  });
});
