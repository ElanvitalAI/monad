// src/autopilot/runner.test.ts
//
// ROADMAP-monad-builtin-autopilot-cascade §MB-1 — AcpTurnRunner adapter
// unit tests. Verifies the wrapper forwards prompt / cancel to the
// underlying AcpAgent with the correct sessionId binding.

import { describe, test, expect } from 'bun:test';
import { AcpTurnRunner } from './runner.js';
import type { AcpAgent } from '../acp/client.js';
import type {
  ContentBlock,
  SessionId,
  SessionUpdate,
} from '@agentclientprotocol/sdk';

interface AgentCall {
  method: 'prompt' | 'cancel';
  sessionId: SessionId;
  blocks?: ContentBlock[];
}

function makeRecordingAgent(opts: {
  stopReason?: 'end_turn' | 'cancelled' | 'max_tokens';
  updates?: SessionUpdate[];
}): { agent: AcpAgent; calls: AgentCall[] } {
  const calls: AgentCall[] = [];
  const agent = {
    async prompt(
      sessionId: SessionId,
      blocks: ContentBlock[],
      onUpdate: (u: SessionUpdate) => void,
    ): Promise<{ stopReason: 'end_turn' | 'cancelled' | 'max_tokens' }> {
      calls.push({ method: 'prompt', sessionId, blocks });
      for (const u of opts.updates ?? []) onUpdate(u);
      return { stopReason: opts.stopReason ?? 'end_turn' };
    },
    async cancel(sessionId: SessionId): Promise<void> {
      calls.push({ method: 'cancel', sessionId });
    },
  } as unknown as AcpAgent;
  return { agent, calls };
}

describe('AcpTurnRunner', () => {
  test('prompt() forwards sessionId + blocks + onUpdate to the agent', async () => {
    const { agent, calls } = makeRecordingAgent({
      updates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        } as unknown as SessionUpdate,
      ],
    });
    const runner = new AcpTurnRunner(agent, 'sid-runner-1' as SessionId);
    const seen: SessionUpdate[] = [];
    const blocks: ContentBlock[] = [{ type: 'text', text: 'mission' }];

    const result = await runner.prompt(blocks, (u) => seen.push(u));

    expect(result.stopReason).toBe('end_turn');
    expect(seen).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('prompt');
    expect(calls[0].sessionId).toBe('sid-runner-1');
    expect(calls[0].blocks).toBe(blocks);
  });

  test('cancel() forwards sessionId to the agent', async () => {
    const { agent, calls } = makeRecordingAgent({});
    const runner = new AcpTurnRunner(agent, 'sid-runner-2' as SessionId);

    await runner.cancel();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('cancel');
    expect(calls[0].sessionId).toBe('sid-runner-2');
  });

  test('stopReason=cancelled propagates from agent', async () => {
    const { agent } = makeRecordingAgent({ stopReason: 'cancelled' });
    const runner = new AcpTurnRunner(agent, 'sid-runner-3' as SessionId);

    const result = await runner.prompt([], () => {});

    expect(result.stopReason).toBe('cancelled');
  });

  test('each runner instance binds its own sessionId', async () => {
    const { agent, calls } = makeRecordingAgent({});
    const a = new AcpTurnRunner(agent, 'sid-A' as SessionId);
    const b = new AcpTurnRunner(agent, 'sid-B' as SessionId);

    await a.cancel();
    await b.cancel();
    await a.prompt([], () => {});

    expect(calls.map((c) => `${c.method}:${c.sessionId}`)).toEqual([
      'cancel:sid-A',
      'cancel:sid-B',
      'prompt:sid-A',
    ]);
  });
});
