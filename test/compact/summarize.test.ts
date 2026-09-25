import { describe, expect, test } from 'bun:test';
import {
  compactConversation,
  compactConversationPartial,
  getCompactSystemPrompt,
  buildCompactTranscript,
  stripCompactScratchpad,
} from '../../src/compact/index.js';
import type { LLMMessage } from '../../src/llm.js';

// These tests cover the shape & guard clauses; an end-to-end
// summarise requires a live LLM which we mock at a lower layer.

describe('compactConversation — shape', () => {
  test('empty history returns 0 sourceTurns + empty summary without calling LLM', async () => {
    const r = await compactConversation([] as LLMMessage[]);
    expect(r.sourceTurns).toBe(0);
    expect(r.summary).toBe('');
  });

  test('history with only system messages is treated as empty', async () => {
    const r = await compactConversation([
      { role: 'system', content: 'you are helpful' },
    ] as LLMMessage[]);
    expect(r.sourceTurns).toBe(0);
    expect(r.summary).toBe('');
  });

  test('compact system prompt uses the 5-section template', () => {
    const prompt = getCompactSystemPrompt();
    expect(prompt).toContain('## Goal');
    expect(prompt).toContain('## Instructions');
    expect(prompt).toContain('## Discoveries');
    expect(prompt).toContain('## Accomplished');
    expect(prompt).toContain('## Relevant files / directories');
    expect(prompt).toContain('<analysis>');
  });

  test('buildCompactTranscript serializes non-system turns only', () => {
    const transcript = buildCompactTranscript([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'Need a compact summary' },
      { role: 'assistant', content: 'Working on it' },
    ] as LLMMessage[]);
    expect(transcript).toContain('USER: Need a compact summary');
    expect(transcript).toContain('ASSISTANT: Working on it');
    expect(transcript).not.toContain('SYSTEM:');
  });

  test('stripCompactScratchpad removes private analysis blocks', () => {
    const cleaned = stripCompactScratchpad(
      '<analysis>private notes</analysis>\n## Goal\n- keep this\n',
    );
    expect(cleaned).toBe('## Goal\n- keep this');
  });

  test('partial compact slices history through upToIndex', async () => {
    const r = await compactConversationPartial([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'latest' },
    ] as LLMMessage[], { upToIndex: 0 });
    expect(r.sourceTurns).toBe(0);
    expect(r.summary).toBe('');
  });
});
