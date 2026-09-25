// ── Agent HOP_CAP · unit tests ──
//
// ROADMAP-agent-surface-deferred-tools-2026-05-13 Wave 5 E3.
// Verifies depth derivation + spawn rejection when the cap is
// exceeded.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  AgentHopCapExceededError,
  AgentRegistry,
  DEFAULT_AGENT_HOP_CAP,
  getAgentHopCap,
  setAgentHopCap,
} from '../src/agent/registry.ts';
import type { AgentDefinition } from '../src/agent/types.ts';
import type { LLMProvider } from '../src/llm.ts';

function def(name = 'hop-test'): AgentDefinition {
  return { name, systemPrompt: '' };
}

function silentProvider(): LLMProvider {
  return {
    name: 'silent',
    defaultModel: 'stub',
    available: () => true,
    async *streamChat() { /* empty */ },
    async *chat() { /* empty */ },
  };
}

afterEach(() => { setAgentHopCap(DEFAULT_AGENT_HOP_CAP); });

describe('AgentRegistry HOP_CAP', () => {
  test('default cap is 5', () => {
    expect(DEFAULT_AGENT_HOP_CAP).toBe(5);
    expect(getAgentHopCap()).toBe(5);
  });

  test('top-level spawn has depth 0', async () => {
    const reg = new AgentRegistry();
    const h = reg.spawn({
      definition: def(),
      prompt: 'p',
      provider: silentProvider(),
    });
    expect(h.task.depth).toBe(0);
    for await (const _ev of h.events) { /* drain */ }
  });

  test('register() always returns depth 0', () => {
    const reg = new AgentRegistry();
    const t = reg.register(def(), 'p');
    expect(t.depth).toBe(0);
  });

  test('nested spawn increments depth from parent', async () => {
    const reg = new AgentRegistry();
    const parent = reg.spawn({
      definition: def(),
      prompt: 'p',
      provider: silentProvider(),
    });
    const child = reg.spawn({
      definition: def(),
      prompt: 'c',
      parentTaskId: parent.task.id,
      provider: silentProvider(),
    });
    expect(child.task.depth).toBe(1);
    expect(child.task.parentTaskId).toBe(parent.task.id);

    // Grandchild
    const grandchild = reg.spawn({
      definition: def(),
      prompt: 'gc',
      parentTaskId: child.task.id,
      provider: silentProvider(),
    });
    expect(grandchild.task.depth).toBe(2);

    for await (const _ev of parent.events) { /* drain */ }
    for await (const _ev of child.events) { /* drain */ }
    for await (const _ev of grandchild.events) { /* drain */ }
  });

  test('missing-parent fallback to depth 1', async () => {
    const reg = new AgentRegistry();
    const h = reg.spawn({
      definition: def(),
      prompt: 'p',
      parentTaskId: 'no-such-id',
      provider: silentProvider(),
    });
    expect(h.task.depth).toBe(1);
    for await (const _ev of h.events) { /* drain */ }
  });

  test('exceeding cap throws AgentHopCapExceededError', async () => {
    const reg = new AgentRegistry();
    setAgentHopCap(2);

    const root = reg.spawn({ definition: def(), prompt: 'r', provider: silentProvider() });
    const d1 = reg.spawn({ definition: def(), prompt: '1', parentTaskId: root.task.id, provider: silentProvider() });
    const d2 = reg.spawn({ definition: def(), prompt: '2', parentTaskId: d1.task.id, provider: silentProvider() });
    expect(d2.task.depth).toBe(2); // at the cap is fine

    // depth 3 would exceed cap=2 → reject
    expect(() => {
      reg.spawn({
        definition: def(),
        prompt: '3',
        parentTaskId: d2.task.id,
        provider: silentProvider(),
      });
    }).toThrow(AgentHopCapExceededError);

    // Detail check on the error payload
    try {
      reg.spawn({
        definition: def(),
        prompt: '3b',
        parentTaskId: d2.task.id,
        provider: silentProvider(),
      });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentHopCapExceededError);
      const e = err as AgentHopCapExceededError;
      expect(e.depth).toBe(3);
      expect(e.cap).toBe(2);
      expect(e.parentTaskId).toBe(d2.task.id);
    }

    for await (const _ev of root.events) { /* drain */ }
    for await (const _ev of d1.events) { /* drain */ }
    for await (const _ev of d2.events) { /* drain */ }
  });

  test('cap=0 forbids any nested spawn', async () => {
    const reg = new AgentRegistry();
    setAgentHopCap(0);
    const root = reg.spawn({ definition: def(), prompt: 'r', provider: silentProvider() });
    expect(root.task.depth).toBe(0); // depth-0 still allowed

    expect(() => {
      reg.spawn({
        definition: def(),
        prompt: 'child',
        parentTaskId: root.task.id,
        provider: silentProvider(),
      });
    }).toThrow(AgentHopCapExceededError);

    for await (const _ev of root.events) { /* drain */ }
  });

  test('setAgentHopCap rejects negative + non-integer', () => {
    setAgentHopCap(-1);
    expect(getAgentHopCap()).toBe(0);
    setAgentHopCap(3.7);
    expect(getAgentHopCap()).toBe(3);
  });

  test('failed spawn (cap exceeded) does NOT add a task to the registry', () => {
    const reg = new AgentRegistry();
    setAgentHopCap(0);
    const root = reg.spawn({ definition: def(), prompt: 'r', provider: silentProvider() });
    const sizeBefore = reg.size;
    expect(() => {
      reg.spawn({
        definition: def(),
        prompt: 'c',
        parentTaskId: root.task.id,
        provider: silentProvider(),
      });
    }).toThrow();
    expect(reg.size).toBe(sizeBefore);
  });
});
