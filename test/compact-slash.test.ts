// ── Wave 3 · /compact slash ──

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCompactSlashCommand,
  runCompactSlash,
} from '../src/compact';
import type { LLMMessage } from '../src/llm';

function archDir(): string {
  return mkdtempSync(join(tmpdir(), 'compact-slash-'));
}

describe('Wave 3 · /compact slash', () => {
  test('descriptor — name + aliases', () => {
    const cmd = buildCompactSlashCommand();
    expect(cmd.name).toBe('compact');
    expect(cmd.aliases).toContain('compress');
    expect(cmd.description).toContain('LLM');
  });

  test('runs Layer 1 + Layer 2 and returns before/after token deltas', async () => {
    const huge = 'X'.repeat(80_000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'a', content: huge }],
      },
      { role: 'user', content: 'pad-1' },
      { role: 'assistant', content: 'pad-2' },
      { role: 'user', content: 'pad-3' },
      { role: 'assistant', content: 'pad-4' },
      { role: 'user', content: 'pad-5' },
      { role: 'assistant', content: 'pad-6' },
    ];
    const r = await runCompactSlash({
      messages,
      policy: {
        toolOutputCharBudget: 200,
        toolOutputTailLines: 5,
        archiveDir: archDir(),
        preserveLastN: 3,
      },
    });
    expect(r.beforeTokens).toBeGreaterThan(r.afterTokens);
    expect(r.savedTokens).toBeGreaterThan(0);
    expect(r.pipeline.diagnostics.layer1ResponsesTrimmed).toBe(1);
  });

  test('status lines include before/after token counts', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const r2 = await runCompactSlash({
      messages,
      policy: { archiveDir: archDir() },
    });
    const text = r2.statusLines.join('\n');
    expect(text).toContain('/compact');
    expect(text).toContain('Layer 1');
    expect(text).toContain('Layer 2');
    expect(text).toContain('Tokens:');
  });

  test('zero-reduction case suggests Wave 4 escalation', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const r = await runCompactSlash({
      messages,
      policy: { archiveDir: archDir() },
    });
    expect(r.savedTokens).toBe(0);
    expect(r.statusLines.join('\n')).toContain('Wave 4');
  });

  test('returns new array — does not mutate input', async () => {
    const huge = 'Y'.repeat(60_000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'pad' },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'b', content: huge }],
      },
      { role: 'user', content: 'tail' },
      { role: 'assistant', content: 'tail' },
      { role: 'user', content: 'tail' },
      { role: 'assistant', content: 'tail' },
      { role: 'user', content: 'tail' },
      { role: 'assistant', content: 'tail' },
    ];
    const before = JSON.stringify(messages);
    const r = await runCompactSlash({
      messages,
      policy: { toolOutputCharBudget: 100, archiveDir: archDir(), preserveLastN: 3 },
    });
    expect(JSON.stringify(messages)).toBe(before);
    expect(r.messages).not.toBe(messages);
  });
});
