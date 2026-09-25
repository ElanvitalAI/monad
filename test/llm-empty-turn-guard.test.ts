// ── Empty-turn guard test ──
//
// Smaller models (gpt-5.4-mini, haiku) sometimes stall mid-task by
// returning an assistant turn with NO text AND NO tool calls —
// effectively giving up silently. streamLLMWithTools now detects
// that and injects a synthetic user reminder before retrying, up to
// MAX_EMPTY_RETRIES (2) times. This test locks the behaviour: the
// loop must not accept an empty turn as completion when it could
// still be re-prompted.

import { describe, test, expect } from 'bun:test';
import { streamLLMWithTools } from '../src/llm';
import type { LLMProvider, LLMStreamEvent } from '../src/llm';

function scriptedProvider(turns: LLMStreamEvent[][]): { provider: LLMProvider; callsSeen: () => number } {
  let call = 0;
  const p: LLMProvider = {
    name: 'scripted',
    defaultModel: 'd',
    available: () => true,
    async *streamChat() {
      const events = turns[call++] ?? [];
      for (const ev of events) yield ev;
    },
    async *chat() {},
  };
  return { provider: p, callsSeen: () => call };
}

describe('streamLLMWithTools — empty-turn guard', () => {
  test('empty turn triggers re-prompt instead of returning immediately', async () => {
    // Turn 0: empty (no text, no tool_call) — should trigger reminder + retry
    // Turn 1: text 'done' — normal completion
    const { provider, callsSeen } = scriptedProvider([
      [],
      [{ type: 'text', delta: 'done' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => ({}) },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    expect(result).toBe('done');
    expect(callsSeen()).toBe(2); // reminder caused second call
  });

  test('bounded — 3 consecutive empty turns returns explicit no-synthesis notice', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [], [], [], [], [], // all empty, should stop after 2 retries (3 calls total)
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => ({}) },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );
    expect(result).toContain('[NO FINAL SYNTHESIS]');
    expect(result).toContain('repeated empty turns');
    // 3 streamChat calls: turn 0 (empty) → retry → turn 1 (empty) → retry → turn 2 (empty) → give up
    expect(callsSeen()).toBe(3);
  });

  test('text-only turn returns immediately without triggering guard', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [{ type: 'text', delta: 'final answer' }],
      [{ type: 'text', delta: 'should never run' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => ({}) },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    expect(result).toBe('final answer');
    expect(callsSeen()).toBe(1);
  });

  test('empty turn followed by tool_call resumes normal loop', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [],
      [{ type: 'tool_call', id: '1', name: 'X', args: {} }],
      [{ type: 'text', delta: 'after tool' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => 'tool-out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    expect(result).toBe('after tool');
    expect(callsSeen()).toBe(3);
  });

  test('tool-only loop exhaustion returns explicit no-synthesis notice', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [{ type: 'tool_call', id: '1', name: 'X', args: {} }],
      [{ type: 'tool_call', id: '2', name: 'X', args: {} }],
      [{ type: 'tool_call', id: '3', name: 'X', args: {} }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => 'tool-out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 3 },
    );
    expect(result).toContain('[NO FINAL SYNTHESIS]');
    expect(result).toContain('available tool-loop turns');
    expect(callsSeen()).toBe(3);
  });

  test('planning text followed by tool-only exhaustion still appends no-synthesis notice', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [
        { type: 'text', delta: '프로젝트 구조를 파악하겠습니다.' },
        { type: 'tool_call', id: '1', name: 'X', args: {} },
      ],
      [{ type: 'tool_call', id: '2', name: 'X', args: {} }],
      [{ type: 'tool_call', id: '3', name: 'X', args: {} }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => 'tool-out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 3 },
    );
    expect(result).toContain('[NO FINAL SYNTHESIS]');
    expect(result).not.toContain('프로젝트 구조를 파악하겠습니다.');
    expect(callsSeen()).toBe(3);
  });

  test('planning text before tool round is dropped from final synthesized answer', async () => {
    const { provider, callsSeen } = scriptedProvider([
      [
        { type: 'text', delta: '프로젝트 구조를 빠르게 파악하겠습니다.' },
        { type: 'tool_call', id: '1', name: 'X', args: {} },
      ],
      [{ type: 'text', delta: '최종 분석 결과입니다.' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => 'tool-out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 4 },
    );
    expect(result).toBe('최종 분석 결과입니다.');
    expect(result).not.toContain('파악하겠습니다');
    expect(callsSeen()).toBe(2);
  });

  test('streaming callback clears planning text when the turn continues with tool calls', async () => {
    const seen: string[] = [];
    const { provider } = scriptedProvider([
      [
        { type: 'text', delta: '프로젝트 구조를 파악하겠습니다.' },
        { type: 'tool_call', id: '1', name: 'X', args: {} },
      ],
      [{ type: 'text', delta: '최종 답변입니다.' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      {
        onText: (_delta, full) => { seen.push(full); },
        dispatchTool: async () => 'tool-out',
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 4 },
    );
    expect(result).toBe('최종 답변입니다.');
    expect(seen).toContain('프로젝트 구조를 파악하겠습니다.');
    expect(seen).toContain('');
    expect(seen.at(-1)).toBe('최종 답변입니다.');
  });
});
