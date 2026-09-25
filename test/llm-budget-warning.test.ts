// ── Budget warning guard test ──
//
// Sub-agents often burn their full turn budget on Bash/Read/Grep research
// and hit maxTurns with tool_calls still pending — i.e. they never write a
// final answer. The budget-warning guard injects a one-shot synthesis
// reminder into the last tool_result's content once turn+1 crosses
// BUDGET_WARNING_RATIO * maxTurns, so the model still has a few turns
// to compose plain text.
//
// These tests lock the behaviour: warning lands exactly once at threshold,
// stays out of short chat loops (below BUDGET_WARNING_MIN_TURNS), and is
// embedded in the tool_result content (not pushed as a separate user
// message — which would break OpenAI/Anthropic wire-sequence rules).

import { describe, test, expect } from 'bun:test';
import { streamLLMWithTools } from '../src/llm';
import type { LLMMessage, LLMProvider, LLMStreamEvent, ContentBlock } from '../src/llm';

/** Scripted provider that records the `messages` list each streamChat
 *  call received. Test asserts on the recorded history to verify the
 *  warning actually reached the wire layer. */
function scriptedProvider(turns: LLMStreamEvent[][]): {
  provider: LLMProvider;
  callsSeen: () => number;
  capturedMessagesAt: (callIdx: number) => LLMMessage[] | undefined;
} {
  let call = 0;
  const captured: LLMMessage[][] = [];
  const p: LLMProvider = {
    name: 'scripted',
    defaultModel: 'd',
    available: () => true,
    async *streamChat(messages) {
      captured.push(messages.map(m => ({ ...m })));
      const events = turns[call++] ?? [];
      for (const ev of events) yield ev;
    },
    async *chat() {},
  };
  return {
    provider: p,
    callsSeen: () => call,
    capturedMessagesAt: (idx) => captured[idx],
  };
}

/** Find the tool_result block content string in a history frame, if any.
 *  Warning injection lands on the LAST tool_result of the LAST user turn. */
function lastToolResultContent(messages: LLMMessage[] | undefined): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    const blocks = m.content as ContentBlock[];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]!;
      if (b.type === 'tool_result') return b.content;
    }
  }
  return null;
}

describe('streamLLMWithTools — budget warning guard', () => {
  test('injects synthesis reminder once turn threshold crosses 70% of maxTurns', async () => {
    // maxTurns=10 → threshold = floor(10 * 0.7) = 7. Warning fires when
    // turn+1 >= 7, i.e. the 7th turn completed. After 6 turns of tool
    // calls, the 7th also runs a tool call → warning injected into that
    // tool_result → final turn returns text.
    const toolCallTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider, callsSeen, capturedMessagesAt } = scriptedProvider([
      toolCallTurn('a'),   // turn 0 — no warning yet (1/10)
      toolCallTurn('b'),   // turn 1 — no warning (2/10)
      toolCallTurn('c'),   // turn 2 — no warning (3/10)
      toolCallTurn('d'),   // turn 3 — no warning (4/10)
      toolCallTurn('e'),   // turn 4 — no warning (5/10)
      toolCallTurn('f'),   // turn 5 — no warning (6/10)
      toolCallTurn('g'),   // turn 6 — 7/10 → WARNING injected after this turn
      [{ type: 'text', delta: 'synthesis done' }], // turn 7 — model sees warning, writes text
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'do research' }],
      { onText: () => {}, dispatchTool: async () => 'tool-out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );

    expect(result).toBe('synthesis done');

    // Before the warning threshold: tool_result content should be clean.
    // Turn 0 completed → history passed to streamChat call idx=1 has the
    // tool_result for call 'a'. No warning yet.
    const beforeWarning = lastToolResultContent(capturedMessagesAt(1));
    expect(beforeWarning).not.toBeNull();
    expect(beforeWarning).not.toContain('SYSTEM BUDGET NOTICE');

    // After turn 6 (threshold reached): history passed to streamChat
    // call idx=7 must include the warning in the last tool_result.
    const afterWarning = lastToolResultContent(capturedMessagesAt(7));
    expect(afterWarning).not.toBeNull();
    expect(afterWarning).toContain('SYSTEM BUDGET NOTICE');
    expect(afterWarning).toContain('7/10');   // turn count in warning
    expect(afterWarning).toContain('FINAL ANSWER');

    expect(callsSeen()).toBe(8);
  });

  test('warning is injected at most once even if loop continues with more tool calls', async () => {
    const toolCallTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    // 10 consecutive tool-call turns — warning should land exactly once
    // (at turn 6, the 7th completed turn), not at every subsequent turn.
    const { provider, capturedMessagesAt } = scriptedProvider([
      toolCallTurn('a'), toolCallTurn('b'), toolCallTurn('c'),
      toolCallTurn('d'), toolCallTurn('e'), toolCallTurn('f'),
      toolCallTurn('g'),  // turn 6 → warning
      toolCallTurn('h'),  // turn 7 — SHOULD NOT re-inject
      toolCallTurn('i'),  // turn 8 — SHOULD NOT re-inject
      toolCallTurn('j'),  // turn 9 — SHOULD NOT re-inject
    ]);

    await streamLLMWithTools(
      [{ role: 'user', content: 'burn budget' }],
      { onText: () => {}, dispatchTool: async () => 'out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );

    // After turn 7's tool_result is built (seen by call idx=8), the warning
    // should appear in a PRIOR tool_result but NOT in this new one.
    const turn7Result = lastToolResultContent(capturedMessagesAt(8));
    expect(turn7Result).not.toContain('SYSTEM BUDGET NOTICE');

    // Count total occurrences across the final captured history.
    // The loop ran to completion; inspect the captured messages on any
    // later call and count warning occurrences across all tool_results.
    const last = capturedMessagesAt(9);
    expect(last).not.toBeUndefined();
    let warningCount = 0;
    for (const m of last!) {
      if (typeof m.content === 'string') continue;
      for (const b of m.content as ContentBlock[]) {
        if (b.type === 'tool_result' && b.content.includes('SYSTEM BUDGET NOTICE')) {
          warningCount++;
        }
      }
    }
    expect(warningCount).toBe(1);
  });

  test('below BUDGET_WARNING_MIN_TURNS (chat default 6) — no warning', async () => {
    // maxTurns=6: floor(6*0.7)=4. Threshold would be turn 3, but guard
    // requires maxTurns >= BUDGET_WARNING_MIN_TURNS (10). So no warning
    // should ever fire for chat-sized loops.
    const toolCallTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider, capturedMessagesAt } = scriptedProvider([
      toolCallTurn('a'), toolCallTurn('b'), toolCallTurn('c'),
      toolCallTurn('d'), toolCallTurn('e'),
      [{ type: 'text', delta: 'finished early' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'hi' }],
      { onText: () => {}, dispatchTool: async () => 'out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 6 },
    );

    expect(result).toBe('finished early');
    // Final history passed to last call must have NO warning anywhere.
    const last = capturedMessagesAt(5);
    expect(last).not.toBeUndefined();
    for (const m of last!) {
      if (typeof m.content === 'string') continue;
      for (const b of m.content as ContentBlock[]) {
        if (b.type === 'tool_result') {
          expect(b.content).not.toContain('SYSTEM BUDGET NOTICE');
        }
      }
    }
  });

  test('text-only turn before threshold — no warning, normal completion', async () => {
    // Model synthesizes well before the budget runs out. Guard must
    // not interfere with healthy runs.
    const { provider, callsSeen, capturedMessagesAt } = scriptedProvider([
      [{ type: 'tool_call', id: 'a', name: 'X', args: {} }],
      [{ type: 'text', delta: 'early finish' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'quick task' }],
      { onText: () => {}, dispatchTool: async () => 'out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 20 },
    );

    expect(result).toBe('early finish');
    expect(callsSeen()).toBe(2);
    const final = capturedMessagesAt(1);
    expect(lastToolResultContent(final)).not.toContain('SYSTEM BUDGET NOTICE');
  });

  test('warning includes remaining turn count and stays on the last tool_result', async () => {
    // Verify the warning string format — it should tell the model how
    // many turns remain. For maxTurns=20, threshold=14; warning fires
    // after turn 13 (14th completed). Remaining = 20 - 14 = 6.
    const toolCallTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const scripted = Array.from({ length: 14 }, (_, i) => toolCallTurn(`id${i}`));
    scripted.push([{ type: 'text', delta: 'done' }]);
    const { provider, capturedMessagesAt } = scriptedProvider(scripted);

    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText: () => {}, dispatchTool: async () => 'out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 20 },
    );

    // Call idx=14 is the one AFTER turn 13's warning got injected.
    const afterWarning = lastToolResultContent(capturedMessagesAt(14));
    expect(afterWarning).toContain('SYSTEM BUDGET NOTICE');
    expect(afterWarning).toContain('14/20');
    expect(afterWarning).toContain('6 turns'); // remaining
    expect(afterWarning).toContain('FINAL ANSWER');
  });

  test('parallel tool calls — warning lands on the LAST tool_result block', async () => {
    // When a turn fires multiple parallel tool_calls, the warning must
    // attach to the LAST result so it can't be missed under truncation.
    const parallelTurn: LLMStreamEvent[] = [
      { type: 'tool_call', id: 'p1', name: 'X', args: { k: 1 } },
      { type: 'tool_call', id: 'p2', name: 'X', args: { k: 2 } },
      { type: 'tool_call', id: 'p3', name: 'X', args: { k: 3 } },
    ];
    const toolCallTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider, capturedMessagesAt } = scriptedProvider([
      toolCallTurn('a'), toolCallTurn('b'), toolCallTurn('c'),
      toolCallTurn('d'), toolCallTurn('e'), toolCallTurn('f'),
      parallelTurn,  // turn 6 — 3 parallel tool_results; warning → LAST
      [{ type: 'text', delta: 'ok' }],
    ]);

    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText: () => {}, dispatchTool: async () => 'out' },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );

    const final = capturedMessagesAt(7);
    expect(final).not.toBeUndefined();
    // Find the user turn that contains the 3 parallel tool_results and
    // assert that only the LAST block carries the warning.
    let inspected = false;
    for (const m of final!) {
      if (typeof m.content === 'string') continue;
      const blocks = m.content as ContentBlock[];
      const toolResults = blocks.filter(b => b.type === 'tool_result') as Extract<ContentBlock, { type: 'tool_result' }>[];
      if (toolResults.length === 3) {
        inspected = true;
        expect(toolResults[0]!.content).not.toContain('SYSTEM BUDGET NOTICE');
        expect(toolResults[1]!.content).not.toContain('SYSTEM BUDGET NOTICE');
        expect(toolResults[2]!.content).toContain('SYSTEM BUDGET NOTICE');
      }
    }
    expect(inspected).toBe(true);
  });
});
