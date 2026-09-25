// ── AgentRegistry × MSS M1.2 narrow tests ──
//
// Verifies that the M1.2 additive narrow on `AgentTask.agentUri` is wired
// into both spawn paths (`spawn()` + `register()`) and that callers can
// pre-mint a URI to thread it through cross-task tracing.

import { describe, expect, test } from 'bun:test';

import { AgentRegistry } from '../src/agent/registry.ts';
import { mintAgentUri, asAgentUri } from '../src/mss/uri/builder.ts';
import type { AgentDefinition } from '../src/agent/types.ts';
import type { LLMProvider } from '../src/llm.ts';

function noopDef(): AgentDefinition {
  return { name: 'mss-m1_2-test', systemPrompt: '' };
}

function silentProvider(): LLMProvider {
  const p: LLMProvider = {
    name: 'mss-m1_2-stub',
    defaultModel: 'stub-model',
    available: () => true,
    async *streamChat() { /* yield nothing — runner sees an empty stream */ },
    async *chat() { /* same */ },
  };
  return p;
}

describe('AgentRegistry × MSS M1.2 narrow', () => {
  test('register() mints an AgentUri alongside the legacy UUID id', () => {
    const reg = new AgentRegistry();
    const task = reg.register(noopDef(), 'noop');
    expect(task.id).toMatch(/^[0-9a-f]{8}-/);
    expect(task.agentUri).toBeDefined();
    expect(() => asAgentUri(task.agentUri!)).not.toThrow();
  });

  test('spawn() honours a caller-supplied agentUri (cross-task tracing)', async () => {
    const reg = new AgentRegistry();
    const preMinted = mintAgentUri();
    // Use a stub provider so the spawn does not actually reach an LLM —
    // the goal is to inspect the task record, not run the agent.
    const handle = reg.spawn({
      definition: noopDef(),
      prompt: 'x',
      agentUri: preMinted,
      provider: silentProvider(),
    });
    expect(handle.task.agentUri).toBe(preMinted);
    // Drain so we don't leave the async generator pending. We don't assert
    // on contents; the type narrow is what we care about here.
    for await (const _ev of handle.events) { /* drain */ }
  });

  test('successive spawn() calls produce distinct agentUris when caller omits one', async () => {
    const reg = new AgentRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const h = reg.spawn({
        definition: noopDef(),
        prompt: `x${i}`,
        provider: silentProvider(),
      });
      expect(h.task.agentUri).toBeDefined();
      seen.add(h.task.agentUri! as string);
      for await (const _ev of h.events) { /* drain */ }
    }
    expect(seen.size).toBe(8);
  });
});
