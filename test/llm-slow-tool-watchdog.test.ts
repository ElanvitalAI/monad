// Slow-tool watchdog — a long-running tool must emit an observable heartbeat
// so a between-turn wait (e.g. a drive that ran the full test suite in bg) is
// distinguishable from a true freeze in logs.db
// (RESEARCH-autonomous-runaway-discipline §4c residual).

import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { streamLLMWithTools } from '../src/llm';
import type { LLMProvider, LLMStreamEvent } from '../src/llm';
import { debug } from '../src/debug/log.js';
import { __resetSnapshotStore, __resetTurnState } from '../src/undo-turn/index.js';
import { resetPlanModeState } from '../src/plan-mode/index.js';

afterEach(() => {
  __resetSnapshotStore();
  __resetTurnState();
  resetPlanModeState();
});

function scriptedProvider(turns: LLMStreamEvent[][]): LLMProvider {
  let call = 0;
  return {
    name: 'scripted', defaultModel: 'd', available: () => true,
    async *streamChat() { for (const ev of turns[call++] ?? []) yield ev; },
    async *chat() {},
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('streamLLMWithTools — slow-tool watchdog', () => {
  test('a long tool call emits llm.tool-loop.slow-tool heartbeats', async () => {
    const spy = spyOn(debug, 'log');
    try {
      const provider = scriptedProvider([
        [{ type: 'tool_call', id: 'a', name: 'Bash', args: { command: 'sleep' } }],
        [{ type: 'text', delta: 'done' }],
      ]);
      await streamLLMWithTools(
        [{ role: 'user', content: 'q' }],
        { onText: () => {}, onToolResult: () => {}, dispatchTool: async () => { await sleep(70); return 'ok'; } },
        { provider, model: 'gpt-5.4', tools: [{ name: 'Bash', description: 'd', parameters: { type: 'object' } }], maxTurns: 4, slowToolTickMs: 15 },
      );
      const ticks = spy.mock.calls.filter((c) => c[0] === 'llm.tool-loop.slow-tool' && c[1] === 'awaiting');
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      expect((ticks[0]![2] as any).tool).toBe('Bash');
      expect((ticks[0]![2] as any).elapsedMs).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
  });

  test('a fast tool call emits no slow-tool heartbeat', async () => {
    const spy = spyOn(debug, 'log');
    try {
      const provider = scriptedProvider([
        [{ type: 'tool_call', id: 'a', name: 'Bash', args: { command: 'echo' } }],
        [{ type: 'text', delta: 'done' }],
      ]);
      await streamLLMWithTools(
        [{ role: 'user', content: 'q' }],
        { onText: () => {}, onToolResult: () => {}, dispatchTool: async () => 'ok' },
        { provider, model: 'gpt-5.4', tools: [{ name: 'Bash', description: 'd', parameters: { type: 'object' } }], maxTurns: 4, slowToolTickMs: 50 },
      );
      const ticks = spy.mock.calls.filter((c) => c[0] === 'llm.tool-loop.slow-tool');
      expect(ticks.length).toBe(0);
    } finally { spy.mockRestore(); }
  });
});
