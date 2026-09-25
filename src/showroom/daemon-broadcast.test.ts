// PLAN-codex-app-server-hermes-parity §5 Phase H1·6a test —
// broadcastToBackends with a stubbed AcpAgentManager so tests don't
// spawn real codex / claude / gemini / grok agents. Each fake agent
// emits a single agent_message_chunk + resolves with stopReason.

import { describe, test, expect } from 'bun:test';
import { broadcastToBackends } from './daemon-broadcast.js';
import type { AcpAgentManager } from '../acp/agent-manager.js';
import type { AcpAgent } from '../acp/client.js';

function fakeAgent(opts: {
  reply?: string;
  throwOnPrompt?: Error;
  delayMs?: number;
  /** When true, never resolves so the timeout path is exercised. */
  hang?: boolean;
}): AcpAgent {
  return {
    newSession: async () => 'session-1',
    prompt: async (
      _sid: unknown,
      _blocks: unknown,
      onUpdate: (u: unknown) => void,
    ) => {
      if (opts.throwOnPrompt) throw opts.throwOnPrompt;
      if (opts.hang) {
        return new Promise(() => {
          /* never */
        }) as unknown as { stopReason: string };
      }
      if (opts.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      onUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: opts.reply ?? 'ok' },
      });
      return { stopReason: 'end_turn' };
    },
    cancel: async () => {},
  } as unknown as AcpAgent;
}

function fakeManager(
  agents: Record<string, AcpAgent | Error>,
): AcpAgentManager {
  return {
    getAgent: async (backend: string) => {
      const a = agents[backend];
      if (!a) throw new Error(`unknown backend "${backend}"`);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as AcpAgentManager;
}

describe('broadcastToBackends · success', () => {
  test('returns per-backend results in input order', async () => {
    const mgr = fakeManager({
      claude: fakeAgent({ reply: 'A' }),
      gemini: fakeAgent({ reply: 'B' }),
      grok: fakeAgent({ reply: 'C' }),
    });
    const r = await broadcastToBackends({
      prompt: 'hi',
      backends: ['claude', 'gemini', 'grok'],
      agentManager: mgr,
    });
    expect(r.okCount).toBe(3);
    expect(r.failCount).toBe(0);
    expect(r.targets.map((t) => t.backend)).toEqual(['claude', 'gemini', 'grok']);
    expect(r.targets.map((t) => t.response)).toEqual(['A', 'B', 'C']);
    expect(r.targets.every((t) => t.stopReason === 'end_turn')).toBe(true);
  });

  test('parallel — slowest backend dictates wall clock', async () => {
    const mgr = fakeManager({
      fast: fakeAgent({ reply: 'fast', delayMs: 10 }),
      slow: fakeAgent({ reply: 'slow', delayMs: 100 }),
    });
    const t0 = Date.now();
    const r = await broadcastToBackends({
      prompt: 'go',
      backends: ['fast', 'slow'],
      agentManager: mgr,
    });
    const elapsed = Date.now() - t0;
    // serial would be ≥110ms; parallel should be ~100ms. Allow slack.
    expect(elapsed).toBeLessThan(200);
    expect(r.okCount).toBe(2);
  });
});

describe('broadcastToBackends · partial failure', () => {
  test('one backend errors → others still report', async () => {
    const mgr = fakeManager({
      good: fakeAgent({ reply: 'ok' }),
      bad: fakeAgent({ throwOnPrompt: new Error('agent died') }),
    });
    const r = await broadcastToBackends({
      prompt: 'go',
      backends: ['good', 'bad'],
      agentManager: mgr,
    });
    expect(r.okCount).toBe(1);
    expect(r.failCount).toBe(1);
    expect(r.targets[0]).toMatchObject({ backend: 'good', ok: true, response: 'ok' });
    expect(r.targets[1]).toMatchObject({ backend: 'bad', ok: false });
    expect(r.targets[1]!.error).toContain('agent died');
  });

  test('getAgent throw surfaces as backend error', async () => {
    const mgr = fakeManager({
      good: fakeAgent({ reply: 'hi' }),
      unknown: new Error('unknown backend'),
    });
    const r = await broadcastToBackends({
      prompt: 'go',
      backends: ['good', 'unknown'],
      agentManager: mgr,
    });
    expect(r.targets[1]!.error).toContain('unknown backend');
  });
});

describe('broadcastToBackends · timeout', () => {
  test('hanging backend trips per-backend timeout', async () => {
    const mgr = fakeManager({
      hang: fakeAgent({ hang: true }),
      fast: fakeAgent({ reply: 'fast' }),
    });
    const r = await broadcastToBackends({
      prompt: 'go',
      backends: ['hang', 'fast'],
      agentManager: mgr,
      timeoutMs: 50,
    });
    expect(r.targets[0]!.error).toContain('timeout');
    expect(r.targets[1]!.ok).toBe(true);
  });
});

describe('broadcastToBackends · duration tracking', () => {
  test('reports per-backend durationMs', async () => {
    const mgr = fakeManager({
      a: fakeAgent({ reply: 'x', delayMs: 30 }),
    });
    const r = await broadcastToBackends({
      prompt: 'go',
      backends: ['a'],
      agentManager: mgr,
    });
    expect(r.targets[0]!.durationMs).toBeGreaterThanOrEqual(20);
  });
});
