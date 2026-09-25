import { describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { judgeWithAcp } from '../src/agent-mission/acp-judge.js';
import { makeAcpReviewLLM } from '../src/agent-substrate/acp-reviewer.js';
import { spawnMonadAutopilotAgent } from '../src/tool-runtime/monad-autopilot-launch-runtime.js';
import type { AcpAgentOpts } from '../src/acp/client.js';

type DebugEvent = { category: string; event: string; data?: Record<string, unknown> };

function recordDebugEvents(): { events: DebugEvent[]; restore: () => void } {
  const events: DebugEvent[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, data });
  }) as never);
  return { events, restore: () => spy.mockRestore() };
}

function agentThatLogs(message: string, opts: AcpAgentOpts): any {
  return {
    start: async () => { opts.log?.(message); },
    newSession: async () => 'session-1',
    selectSessionModel: async () => null,
    prompt: async () => ({ stopReason: 'end_turn' }),
    stop: async () => {},
    cancel: async () => {},
  };
}

function expectAgentLog(events: DebugEvent[], category: string, backend: string, message: string): void {
  expect(events).toContainEqual({
    category,
    event: 'agent-log',
    data: { backend, message },
  });
}

describe('ACP agent log wiring', () => {
  test('judge persists an ACP agent lifecycle message with its queryable category and payload', async () => {
    const { events, restore } = recordDebugEvents();
    try {
      await judgeWithAcp({
        diff: '',
        context: 'test',
        gatePassed: true,
        cwd: process.cwd(),
        backend: 'claude',
        agentManager: {
          getAgent: async (_backend, opts) => {
            const agent = agentThatLogs('judge-agent-message', opts);
            await agent.start();
            return agent;
          },
        },
      });
    } finally {
      restore();
    }
    expectAgentLog(events, 'acp-judge', 'claude', 'judge-agent-message');
  });

  test('reviewer persists an ACP agent lifecycle message with its queryable category and payload', async () => {
    const { events, restore } = recordDebugEvents();
    try {
      await makeAcpReviewLLM({
        cwd: process.cwd(),
        backend: 'review-backend',
        createAgent: (opts) => agentThatLogs('review-agent-message', opts),
      })('review prompt');
    } finally {
      restore();
    }
    expectAgentLog(events, 'acp-review', 'review-backend', 'review-agent-message');
  });

  test('autopilot launcher persists an ACP agent lifecycle message with its queryable category and payload', async () => {
    const { events, restore } = recordDebugEvents();
    try {
      await spawnMonadAutopilotAgent(
        'launch-backend',
        process.cwd(),
        (opts) => agentThatLogs('launch-agent-message', opts),
      );
    } finally {
      restore();
    }
    expectAgentLog(events, 'monad-autopilot-launch', 'launch-backend', 'launch-agent-message');
  });
});
