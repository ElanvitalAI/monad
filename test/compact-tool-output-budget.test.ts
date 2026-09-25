// ── Wave 2 · Layer 1 · tool-output budget ──

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyToolOutputBudget } from '../src/compact/tool-output-budget';
import type { LLMMessage } from '../src/llm';

function archDir(): string {
  return mkdtempSync(join(tmpdir(), 'compact-tob-'));
}

describe('Wave 2 · Layer 1 · tool-output budget', () => {
  test('small tool result passes through untouched', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'short' }],
      },
    ];
    const r = applyToolOutputBudget(messages, {
      policy: { archiveDir: archDir() },
    });
    expect(r.responsesTrimmed).toBe(0);
    expect(r.savedChars).toBe(0);
    expect(r.messages).toEqual(messages);
  });

  test('huge tool result trimmed to last N lines + file pointer', () => {
    const huge = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    // Pad messages so the eligible message falls outside preserveLastN.
    const messages: LLMMessage[] = [
      { role: 'user', content: 'pad-1' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 't42', content: huge }],
      },
      { role: 'user', content: 'pad-2' },
      { role: 'assistant', content: 'pad-3' },
      { role: 'user', content: 'pad-4' },
      { role: 'assistant', content: 'pad-5' },
      { role: 'user', content: 'pad-6' },
      { role: 'assistant', content: 'pad-7' },
    ];
    const r = applyToolOutputBudget(messages, {
      policy: { toolOutputCharBudget: 100, toolOutputTailLines: 30, archiveDir: archDir(), preserveLastN: 3 },
    });
    expect(r.responsesTrimmed).toBe(1);
    expect(r.savedChars).toBeGreaterThan(0);

    const firstAssistant = r.messages[1];
    expect(firstAssistant?.role).toBe('assistant');
    const block = (firstAssistant?.content as any)[0];
    expect(block.type).toBe('tool_result');
    expect(block.content).toContain('Full output');
    expect(block.content).toContain('saved to:');
    // Tail preserved — last 30 lines should be present
    expect(block.content).toContain('line 999');
    expect(block.content).toContain('line 970');
    // Head should NOT be present (line 0..969 dropped)
    expect(block.content.includes('\nline 0\n')).toBe(false);
  });

  test('preserveLastN window exempts recent tool results', () => {
    const huge = 'x'.repeat(200_000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'a', content: huge }],
      },
    ];
    // preserveLastN=10 covers everything → nothing trimmed
    const r = applyToolOutputBudget(messages, {
      policy: { toolOutputCharBudget: 100, archiveDir: archDir(), preserveLastN: 10 },
    });
    expect(r.responsesTrimmed).toBe(0);
  });

  test('non-tool-result blocks pass through', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'large text would be ignored ' + 'x'.repeat(200_000) },
          { type: 'tool_use', id: 'u', name: 'tool', input: {} },
        ],
      },
    ];
    const r = applyToolOutputBudget(messages, {
      policy: { toolOutputCharBudget: 100, archiveDir: archDir(), preserveLastN: 0 },
    });
    expect(r.responsesTrimmed).toBe(0);
  });

  test('archive disabled = no file pointer hint references archive path', () => {
    const huge = 'y'.repeat(80_000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'pad' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'b', content: huge }],
      },
      { role: 'user', content: 'tail-1' },
      { role: 'assistant', content: 'tail-2' },
      { role: 'user', content: 'tail-3' },
      { role: 'assistant', content: 'tail-4' },
      { role: 'user', content: 'tail-5' },
      { role: 'assistant', content: 'tail-6' },
    ];
    const r = applyToolOutputBudget(messages, {
      policy: { toolOutputCharBudget: 100, archiveDir: archDir(), archiveEnabled: false, preserveLastN: 3 },
    });
    expect(r.responsesTrimmed).toBe(1);
    const block = (r.messages[1]?.content as any)[0];
    expect(block.content).toContain('<archive disabled>');
  });
});
