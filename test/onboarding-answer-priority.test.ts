// BACKLOG #7 — Setup wizard answerPriority sub-step. Covers the picker
// helper extracted from askLLM so the policy is unit-testable without
// driving the full LLM step.

import { describe, expect, test } from 'bun:test';
import {
  scriptedIO,
  askAnswerPriority,
  ANSWER_PRIORITY_CHOICES,
  type AnswerPriority,
} from '../src/onboarding';

describe('ANSWER_PRIORITY_CHOICES catalog', () => {
  test('has all 4 enum values from LLMConfig.answerPriority', () => {
    const values = ANSWER_PRIORITY_CHOICES.map(c => c.value);
    expect(values).toEqual(['cost', 'balanced', 'quality', 'exhaustive']);
  });

  test('every entry has key + label + description', () => {
    for (const c of ANSWER_PRIORITY_CHOICES) {
      expect(c.key).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
    }
  });

  test('keys are distinct numeric labels 1-4', () => {
    const keys = ANSWER_PRIORITY_CHOICES.map(c => c.key);
    expect(keys).toEqual(['1', '2', '3', '4']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('askAnswerPriority', () => {
  test('user picks "1" → cost', async () => {
    const io = scriptedIO(['1']);
    const v = await askAnswerPriority(io, undefined);
    expect(v).toBe<AnswerPriority>('cost');
  });

  test('user picks "3" → quality', async () => {
    const io = scriptedIO(['3']);
    const v = await askAnswerPriority(io, undefined);
    expect(v).toBe<AnswerPriority>('quality');
  });

  test('blank input + no current → balanced (default tier)', async () => {
    const io = scriptedIO(['']);
    const v = await askAnswerPriority(io, undefined);
    expect(v).toBe<AnswerPriority>('balanced');
  });

  test('blank input picks current value when set', async () => {
    const io = scriptedIO(['']);
    const v = await askAnswerPriority(io, 'quality');
    expect(v).toBe<AnswerPriority>('quality');
  });

  test('blank input with `cost` current → cost (re-running wizard is no-op)', async () => {
    const io = scriptedIO(['']);
    const v = await askAnswerPriority(io, 'cost');
    expect(v).toBe<AnswerPriority>('cost');
  });

  test('exhaustive selectable as "4"', async () => {
    const io = scriptedIO(['4']);
    const v = await askAnswerPriority(io, undefined);
    expect(v).toBe<AnswerPriority>('exhaustive');
  });

  test('renders descriptive labels in the prompt', async () => {
    const io = scriptedIO(['2']);
    await askAnswerPriority(io, undefined);
    const log = io.outputs.join('\n');
    expect(log).toContain('Answer depth');
    expect(log).toContain('cost');
    expect(log).toContain('balanced');
    expect(log).toContain('quality');
    expect(log).toContain('exhaustive');
    // Tradeoff hints visible to the user
    expect(log).toContain('default');
    expect(log).toContain('분석/디버깅');
  });
});
