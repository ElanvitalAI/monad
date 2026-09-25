// Test: src/discord/poll-builder.ts

import { describe, expect, test } from 'bun:test';
import {
  buildPoll, parseAnswersString, POLL_DURATION_DEFAULT_HOURS,
  POLL_DURATION_MAX_HOURS, POLL_LAYOUT_DEFAULT,
} from '../../src/discord/poll-builder.js';

describe('buildPoll', () => {
  test('minimum spec — defaults', () => {
    const b = buildPoll({
      question: '진행?', answers: [{ text: 'yes' }, { text: 'no' }],
    });
    expect((b['question'] as any).text).toBe('진행?');
    expect((b['answers'] as any[]).length).toBe(2);
    expect((b['answers'] as any[])[0].answer_id).toBe(1);
    expect((b['answers'] as any[])[0].poll_media.text).toBe('yes');
    expect(b['duration']).toBe(POLL_DURATION_DEFAULT_HOURS);
    expect(b['allow_multiselect']).toBe(false);
    expect(b['layout_type']).toBe(POLL_LAYOUT_DEFAULT);
  });

  test('answer with emoji', () => {
    const b = buildPoll({
      question: 'q',
      answers: [
        { text: 'A', emoji: { name: '👍' } },
        { text: 'B', emoji: { name: 'custom', id: '12345' } },
      ],
    });
    expect((b['answers'] as any[])[0].poll_media.emoji).toEqual({ name: '👍' });
    expect((b['answers'] as any[])[1].poll_media.emoji).toEqual({ name: 'custom', id: '12345' });
  });

  test('duration clamped to allowed range', () => {
    const tooHigh = buildPoll({
      question: 'q', answers: [{ text: 'a' }, { text: 'b' }],
      durationHours: 9999,
    });
    expect(tooHigh['duration']).toBe(POLL_DURATION_MAX_HOURS);
    const tooLow = buildPoll({
      question: 'q', answers: [{ text: 'a' }, { text: 'b' }],
      durationHours: 0,
    });
    expect(tooLow['duration']).toBe(1);
  });

  test('rejects empty question', () => {
    expect(() => buildPoll({ question: '', answers: [{ text: 'a' }] })).toThrow(/question required/);
    expect(() => buildPoll({ question: '   ', answers: [{ text: 'a' }] })).toThrow(/question required/);
  });

  test('rejects 0 / >10 answers', () => {
    expect(() => buildPoll({ question: 'q', answers: [] })).toThrow(/at least 1/);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ text: `a${i}` }));
    expect(() => buildPoll({ question: 'q', answers: eleven })).toThrow(/at most 10/);
  });

  test('multiselect propagates', () => {
    const b = buildPoll({
      question: 'q', answers: [{ text: 'a' }, { text: 'b' }],
      allowMultiselect: true,
    });
    expect(b['allow_multiselect']).toBe(true);
  });
});

describe('parseAnswersString', () => {
  test('| separator (preferred)', () => {
    expect(parseAnswersString('A | B | C')).toEqual([
      { text: 'A' }, { text: 'B' }, { text: 'C' },
    ]);
  });
  test(', separator (fallback when no |)', () => {
    expect(parseAnswersString('a, b, c')).toEqual([
      { text: 'a' }, { text: 'b' }, { text: 'c' },
    ]);
  });
  test('drops empties + trims', () => {
    expect(parseAnswersString('  | A |   | B |')).toEqual([
      { text: 'A' }, { text: 'B' },
    ]);
  });
  test('empty input → []', () => {
    expect(parseAnswersString('')).toEqual([]);
  });
});
