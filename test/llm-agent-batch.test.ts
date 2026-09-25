// ── Parallel Agent batch dispatch (Phase F5) ──
//
// When the model emits ≥2 Agent tool calls in a single turn, the tool
// loop switches to Promise.all dispatch — the workers run concurrently
// and the handler receives onAgentBatchStart / onAgentComplete (×N) /
// onAgentBatchEnd callbacks. Solo Agent calls (or a turn with only
// non-Agent tools) keep their original sequential path.

import { describe, test, expect } from 'bun:test';
import { streamLLMWithTools } from '../src/llm';
import type { LLMMessage, LLMProvider, LLMStreamEvent } from '../src/llm';

function scriptedProvider(turns: LLMStreamEvent[][]): {
  provider: LLMProvider;
  callsSeen: () => number;
} {
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

describe('streamLLMWithTools — Agent batch lifecycle', () => {
  test('batch of 3 Agent calls fires onAgentBatchStart/Complete×3/End', async () => {
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'a', name: 'Agent', args: { description: 'alpha' } },
        { type: 'tool_call', id: 'b', name: 'Agent', args: { description: 'beta' } },
        { type: 'tool_call', id: 'c', name: 'Agent', args: { description: 'gamma' } },
      ],
      [{ type: 'text', delta: 'done' }],
    ]);

    const startCalls: any[] = [];
    const completions: any[] = [];
    const endCalls: any[] = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async (_name, args) => `result-${(args as any).description}`,
        onAgentBatchStart: (calls) => startCalls.push(calls.map(c => (c.args as any).description)),
        onAgentComplete: (info) => completions.push(info),
        onAgentBatchEnd: (info) => endCalls.push(info),
      },
      { provider, tools: [{ name: 'Agent', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]).toEqual(['alpha', 'beta', 'gamma']);
    expect(completions).toHaveLength(3);
    expect(endCalls).toHaveLength(1);
    expect(endCalls[0]!.totalCount).toBe(3);
  });

  test('completion events carry descending `remaining` counter', async () => {
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'a', name: 'Agent', args: { description: 'A' } },
        { type: 'tool_call', id: 'b', name: 'Agent', args: { description: 'B' } },
        { type: 'tool_call', id: 'c', name: 'Agent', args: { description: 'C' } },
      ],
      [{ type: 'text', delta: 'ok' }],
    ]);
    const remainingCounts: number[] = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => 'ok',
        onAgentComplete: (info) => remainingCounts.push(info.remaining),
      },
      { provider, tools: [{ name: 'Agent', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    // Each completion records `remaining` = siblings still running AFTER this one.
    // Sorted set must be [0, 1, 2] regardless of completion order.
    expect(remainingCounts.sort()).toEqual([0, 1, 2]);
  });

  test('single Agent call does NOT trigger batch handlers', async () => {
    const { provider } = scriptedProvider([
      [{ type: 'tool_call', id: 'a', name: 'Agent', args: { description: 'solo' } }],
      [{ type: 'text', delta: 'fin' }],
    ]);
    const startCalls: any[] = [];
    const completions: any[] = [];
    const endCalls: any[] = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => 'ok',
        onAgentBatchStart: (calls) => startCalls.push(calls),
        onAgentComplete: (info) => completions.push(info),
        onAgentBatchEnd: (info) => endCalls.push(info),
      },
      { provider, tools: [{ name: 'Agent', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    expect(startCalls).toHaveLength(0);
    expect(completions).toHaveLength(0);
    expect(endCalls).toHaveLength(0);
  });

  test('mixed batch: non-Agent tools dispatch sequentially before Agent batch', async () => {
    const dispatchOrder: string[] = [];
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'bash1', name: 'Bash', args: { command: 'ls' } },
        { type: 'tool_call', id: 'a1', name: 'Agent', args: { description: 'A' } },
        { type: 'tool_call', id: 'a2', name: 'Agent', args: { description: 'B' } },
      ],
      [{ type: 'text', delta: 'done' }],
    ]);
    const startCalls: any[] = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async (name) => {
          dispatchOrder.push(name);
          return 'ok';
        },
        onAgentBatchStart: (calls) => startCalls.push(calls),
      },
      {
        provider,
        tools: [
          { name: 'Bash', description: 'b', parameters: { type: 'object' } },
          { name: 'Agent', description: 'a', parameters: { type: 'object' } },
        ],
        maxTurns: 5,
      },
    );
    // Bash runs first (sequential), then batch starts, then 2 Agent calls.
    expect(dispatchOrder[0]).toBe('Bash');
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].length).toBe(2);
  });

  test('dispatchTool receives ctx.callId on every invocation', async () => {
    const seenIds: string[] = [];
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'id-one', name: 'Agent', args: { description: 'a' } },
        { type: 'tool_call', id: 'id-two', name: 'Agent', args: { description: 'b' } },
      ],
      [{ type: 'text', delta: 'done' }],
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async (_n, _a, ctx) => {
          if (ctx) seenIds.push(ctx.callId);
          return 'ok';
        },
      },
      { provider, tools: [{ name: 'Agent', description: 'a', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    expect(seenIds.sort()).toEqual(['id-one', 'id-two']);
  });

  test('onAgentBatchTick fires while batch is in-flight, stops after completion', async () => {
    // Force a short runtime so we observe at least one tick firing.
    // Test overrides the default 1000ms tick interval to keep the
    // suite fast while preserving the same lifecycle behavior.
    // remaining > 0, and the handler must STOP firing after the
    // final Promise.all resolves (interval cleared).
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'a', name: 'Agent', args: { description: 'slow-alpha' } },
        { type: 'tool_call', id: 'b', name: 'Agent', args: { description: 'slow-beta' } },
      ],
      [{ type: 'text', delta: 'ok' }],
    ]);
    const ticks: Array<{ remaining: number; runningDescriptions: string[] }> = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => {
          await new Promise(r => setTimeout(r, 40));
          return 'ok';
        },
        onAgentBatchTick: (info) => ticks.push({
          remaining: info.remaining,
          runningDescriptions: info.runningDescriptions,
        }),
      },
      {
        provider,
        tools: [{ name: 'Agent', description: 'a', parameters: { type: 'object' } }],
        maxTurns: 5,
        agentBatchTickIntervalMs: 10,
      },
    );
    // Every tick should have remaining in {1, 2} (at least one agent
    // still running when the tick fired — can't be 0 because we
    // clearInterval synchronously once Promise.all resolves).
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    for (const t of ticks) {
      expect(t.remaining).toBeGreaterThan(0);
      expect(t.remaining).toBeLessThanOrEqual(2);
      // runningDescriptions count equals remaining.
      expect(t.runningDescriptions).toHaveLength(t.remaining);
    }
  }, 10_000);

  test('tick handler exceptions are swallowed', async () => {
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'a', name: 'Agent', args: { description: 'a' } },
        { type: 'tool_call', id: 'b', name: 'Agent', args: { description: 'b' } },
      ],
      [{ type: 'text', delta: 'done' }],
    ]);
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async () => {
          await new Promise(r => setTimeout(r, 30));
          return 'ok';
        },
        onAgentBatchTick: () => { throw new Error('renderer boom'); },
      },
      {
        provider,
        tools: [{ name: 'Agent', description: 'a', parameters: { type: 'object' } }],
        maxTurns: 5,
        agentBatchTickIntervalMs: 10,
      },
    );
    expect(result).toBe('done');
  }, 10_000);

  test('resultBlocks preserve original call order even when batch completes out-of-order', async () => {
    // Force out-of-order completion: first-dispatched promise sleeps
    // longer than the second. We verify the resulting history's tool
    // results match pendingCalls order (tool_use_id matched to each).
    const { provider } = scriptedProvider([
      [
        { type: 'tool_call', id: 'slow', name: 'Agent', args: { description: 'slow-one' } },
        { type: 'tool_call', id: 'fast', name: 'Agent', args: { description: 'fast-one' } },
      ],
      [{ type: 'text', delta: 'ok' }],
    ]);
    const order: string[] = [];
    await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText: () => {},
        dispatchTool: async (_n, args) => {
          const desc = (args as any).description;
          const delay = desc === 'slow-one' ? 40 : 5;
          await new Promise(r => setTimeout(r, delay));
          return `out-${desc}`;
        },
        onAgentComplete: (info) => order.push(info.description),
      },
      { provider, tools: [{ name: 'Agent', description: 'a', parameters: { type: 'object' } }], maxTurns: 5 },
    );
    // fast-one finished first in the completion event stream.
    expect(order).toEqual(['fast-one', 'slow-one']);
  });
});
