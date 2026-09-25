// ── Synthesis-phase (final-turn tool-call rejection) guard test ──
//
// The budget-warning guard (llm-budget-warning.test.ts) injects a
// SOFT notice into tool_result content at 70% of maxTurns. Observed
// behavior: gpt-5.4 ignores the soft warning and keeps calling tools
// until the hard limit hits — final output = 0 chars. The synthesis-
// phase guard adds teeth: in the FINAL_SYNTHESIS_TURNS of the budget
// we refuse to dispatch tool calls at all, returning a synthetic
// "TOOL CALL REJECTED" tool_result. Forces the model's hand.

import { describe, test, expect } from 'bun:test';
import { streamLLMWithTools } from '../src/llm';
import type { LLMMessage, LLMProvider, LLMStreamEvent, ContentBlock } from '../src/llm';

function scriptedProvider(turns: LLMStreamEvent[][]): {
  provider: LLMProvider;
  callsSeen: () => number;
  capturedMessagesAt: (idx: number) => LLMMessage[] | undefined;
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
  return { provider: p, callsSeen: () => call, capturedMessagesAt: (i) => captured[i] };
}

function lastToolResult(messages: LLMMessage[] | undefined): Extract<ContentBlock, { type: 'tool_result' }> | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    const blocks = m.content as ContentBlock[];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]!;
      if (b.type === 'tool_result') return b;
    }
  }
  return null;
}

describe('streamLLMWithTools — synthesis-phase (final-turn tool rejection)', () => {
  test('rejects tool calls in the last FINAL_SYNTHESIS_TURNS turns (maxTurns=10 → turns 8,9)', async () => {
    // 8 turns of tool_call → should be dispatched normally
    // Turn 8: rejection → model should see "TOOL CALL REJECTED"
    // Turn 9 text: normal completion (model yielded to synthesis pressure)
    let dispatchedCount = 0;
    const toolTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider, capturedMessagesAt } = scriptedProvider([
      toolTurn('t0'), toolTurn('t1'), toolTurn('t2'), toolTurn('t3'),
      toolTurn('t4'), toolTurn('t5'), toolTurn('t6'), toolTurn('t7'),
      toolTurn('t8'),                // turn 8 — REJECTED (synthesis phase begins)
      [{ type: 'text', delta: 'final-answer' }], // turn 9 — model synthesises
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => { dispatchedCount++; return 'tool-out'; },
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );

    expect(result).toBe('final-answer');
    // Turns 0-7 (8 turns) dispatched normally. Turn 8 rejected.
    expect(dispatchedCount).toBe(8);
    // The tool_result visible to the model on call idx=9 must contain rejection.
    const last = lastToolResult(capturedMessagesAt(9));
    expect(last).not.toBeNull();
    expect(last!.content).toContain('TOOL CALL REJECTED');
    expect(last!.content).toContain('9/10');
    expect(last!.content).toContain('plain text');
  });

  test('dispatch counts survive when synthesis phase never triggers (short run)', async () => {
    // Model finishes in turn 2 — far from maxTurns. No rejection.
    let dispatchedCount = 0;
    const { provider } = scriptedProvider([
      [{ type: 'tool_call', id: 'a', name: 'X', args: {} }],
      [{ type: 'text', delta: 'done' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'quick' }],
      {
        onText: () => {},
        dispatchTool: async () => { dispatchedCount++; return 'ok'; },
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 20 },
    );
    expect(result).toBe('done');
    expect(dispatchedCount).toBe(1);  // only the real tool call
  });

  test('chat-size loop (maxTurns=6) is exempt — tool calls always dispatched', async () => {
    // maxTurns=6 < BUDGET_WARNING_MIN_TURNS=10 → no synthesis phase.
    // Even tool_call on the LAST turn (turn 5) is dispatched normally.
    let dispatchedCount = 0;
    const toolTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider } = scriptedProvider([
      toolTurn('a'), toolTurn('b'), toolTurn('c'),
      toolTurn('d'), toolTurn('e'), toolTurn('f'),
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'chat' }],
      {
        onText: () => {},
        dispatchTool: async () => { dispatchedCount++; return 'ok'; },
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 6 },
    );
    expect(dispatchedCount).toBe(6);  // ALL dispatched, no rejections
  });

  test('parallel tool calls on last turn — ALL rejected with same stub', async () => {
    // Model fires 3 parallel tools on the final turn. Every tool_result
    // block should carry the rejection stub.
    let dispatchedCount = 0;
    const parallelTurn: LLMStreamEvent[] = [
      { type: 'tool_call', id: 'p1', name: 'X', args: {} },
      { type: 'tool_call', id: 'p2', name: 'X', args: {} },
      { type: 'tool_call', id: 'p3', name: 'X', args: {} },
    ];
    const toolTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider, capturedMessagesAt } = scriptedProvider([
      toolTurn('a'), toolTurn('b'), toolTurn('c'), toolTurn('d'),
      toolTurn('e'), toolTurn('f'), toolTurn('g'), toolTurn('h'),
      parallelTurn,                   // turn 8 — 3 parallel rejected
      [{ type: 'text', delta: 'ok' }],
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => { dispatchedCount++; return 'ok'; },
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );
    // Turns 0-7 dispatched. Turn 8 (3 parallel) ALL rejected.
    expect(dispatchedCount).toBe(8);
    // The call 9 history should have a user turn with 3 tool_results, all rejected.
    const last = capturedMessagesAt(9);
    expect(last).not.toBeUndefined();
    let parallelUserTurn: ContentBlock[] | null = null;
    for (const m of last!) {
      if (m.role !== 'user' || typeof m.content === 'string') continue;
      const blocks = m.content as ContentBlock[];
      const trs = blocks.filter(b => b.type === 'tool_result');
      if (trs.length === 3) { parallelUserTurn = blocks; break; }
    }
    expect(parallelUserTurn).not.toBeNull();
    for (const b of parallelUserTurn!) {
      if (b.type === 'tool_result') {
        expect(b.content).toContain('TOOL CALL REJECTED');
      }
    }
  });

  test('rejection happens even on the ABSOLUTE last turn (turn maxTurns-1)', async () => {
    // Rejects tool calls on turn maxTurns-1 as well. Loop exits right after
    // — no synthesis happens, but dispatch was still refused (so the model
    // never got a "real" tool result to chase on).
    let dispatchedCount = 0;
    const toolTurn = (id: string): LLMStreamEvent[] => [
      { type: 'tool_call', id, name: 'X', args: {} },
    ];
    const { provider } = scriptedProvider([
      toolTurn('a'), toolTurn('b'), toolTurn('c'),
      toolTurn('d'), toolTurn('e'), toolTurn('f'),
      toolTurn('g'), toolTurn('h'),
      toolTurn('i'), toolTurn('j'),   // turns 8 and 9 — BOTH rejected
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'stubborn' }],
      {
        onText: () => {},
        dispatchTool: async () => { dispatchedCount++; return 'ok'; },
      },
      { provider, tools: [{ name: 'X', description: 'd', parameters: { type: 'object' } }], maxTurns: 10 },
    );
    // Turns 0-7 dispatched (8 calls). Turns 8, 9 rejected.
    expect(dispatchedCount).toBe(8);
  });
});
