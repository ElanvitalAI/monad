// ── PFC-S1 P5: slim inherited-context + worktree cwd wiring ──
//
// Covers:
//   • omitInheritedContext=true replaces systemPromptPrefix with a compact
//     <system-reminder> notice
//   • omitInheritedContext=false/undefined passes prefix through unchanged
//   • Notice includes agent name + cwd when set
//   • composeSystemPrompt({omitMemoryPrompt}) drops memoryPrompt
//   • buildAgentMessages always preserves def.systemPrompt (we're
//     only stripping inherited context, never the agent's own)
//   • 5 PFC builtin agents — omitInheritedContext value respected
//   • isolation='worktree' spawn carries cwd onto task

import { describe, test, expect, beforeEach } from 'bun:test';
import { buildAgentMessages } from '../src/agent/runner';
import { composeSystemPrompt } from '../src/agent/loader';
import { loadAgentsLayered, invalidateLayeredCache } from '../src/agent/definition-registry';
import type { AgentDefinition } from '../src/agent/types';

function def(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'explore',
    systemPrompt: 'You are the Explore subagent.',
    ...over,
  };
}

describe('buildAgentMessages — omitInheritedContext', () => {
  test('omitInheritedContext=true replaces long prefix with compact notice', () => {
    const prefix = 'CLAUDE.md content\nDashboard state\n...\n(long)';
    const msgs = buildAgentMessages(
      def({ omitInheritedContext: true }),
      'do work',
      prefix,
    );
    const sys = msgs[0]!.content as string;
    expect(sys).toContain('<system-reminder>');
    expect(sys).toContain('sub-agent (explore)');
    expect(sys).toContain('Parent-provided context and the project preamble are omitted');
    expect(sys).toContain("your own instructions remain available");
    expect(sys).not.toContain('CLAUDE.md');
    expect(sys).not.toContain('CLAUDE.md content');
    expect(sys).not.toContain('Dashboard state');
    // def.systemPrompt is STILL present — only the prefix is stripped.
    expect(sys).toContain('You are the Explore subagent.');
  });

  test('omitInheritedContext=false passes prefix through', () => {
    const prefix = 'PARENT-CONTEXT';
    const msgs = buildAgentMessages(
      def({ omitInheritedContext: false }),
      'do work',
      prefix,
    );
    const sys = msgs[0]!.content as string;
    expect(sys).toContain('PARENT-CONTEXT');
    expect(sys).toContain('You are the Explore subagent.');
    expect(sys).not.toContain('<system-reminder>');
  });

  test('new key wins over legacy key when both are supplied', () => {
    const definition = {
      ...def({ omitInheritedContext: false }),
      omitClaudeMd: true,
    } as AgentDefinition & { omitClaudeMd: boolean };
    const sys = buildAgentMessages(definition, 'do work', 'PARENT-CONTEXT')[0]!.content as string;
    expect(sys).toContain('PARENT-CONTEXT');
    expect(sys).not.toContain('<system-reminder>');
  });

  test('omitInheritedContext undefined treated as false (default)', () => {
    const prefix = 'PARENT-CONTEXT';
    const msgs = buildAgentMessages(def(), 'x', prefix);
    const sys = msgs[0]!.content as string;
    expect(sys).toContain('PARENT-CONTEXT');
    expect(sys).not.toContain('<system-reminder>');
  });

  test('omitInheritedContext=true + no prefix → notice still rendered', () => {
    const msgs = buildAgentMessages(
      def({ omitInheritedContext: true }),
      'x',
      undefined,
    );
    const sys = msgs[0]!.content as string;
    expect(sys).toContain('sub-agent (explore)');
  });

  test('notice includes cwd when ctx.cwd provided', () => {
    const msgs = buildAgentMessages(
      def({ omitInheritedContext: true }),
      'x',
      'parent-prefix',
      { cwd: '/tmp/worktree-1' },
    );
    const sys = msgs[0]!.content as string;
    expect(sys).toContain('Your working directory is /tmp/worktree-1');
  });

  test('notice omits cwd line when ctx.cwd absent', () => {
    const msgs = buildAgentMessages(
      def({ omitInheritedContext: true }),
      'x',
      'parent',
    );
    const sys = msgs[0]!.content as string;
    expect(sys).not.toContain('Your working directory');
  });
});

describe('composeSystemPrompt — omitMemoryPrompt', () => {
  test('omitMemoryPrompt=true drops memoryPrompt', () => {
    const d = def({ role: 'scout' });
    const out = composeSystemPrompt(d, {
      memoryPrompt: 'MEMORY CONTENT',
      omitMemoryPrompt: true,
    });
    expect(out).not.toContain('MEMORY CONTENT');
    expect(out).toContain('[ROLE] scout');
    expect(out).toContain('You are the Explore subagent.');
  });

  test('omitMemoryPrompt=false preserves memoryPrompt (default)', () => {
    const out = composeSystemPrompt(def(), { memoryPrompt: 'MEMORY CONTENT' });
    expect(out).toContain('MEMORY CONTENT');
  });
});

describe('PFC builtin agents — omitInheritedContext flags', () => {
  beforeEach(() => { invalidateLayeredCache(); });

  test('explore defines omitInheritedContext=true (read-only scout)', () => {
    const { agents } = loadAgentsLayered({});
    const explore = agents.get('explore');
    // plan.ts for agent-team plugin seeds these defs — actual flag
    // depends on the shipped md. We assert presence + value, not
    // semantic expectations beyond DD-PFC1-5.
    expect(explore).toBeDefined();
    // explore is the read-only scout — should prefer slim context.
    expect(explore?.omitInheritedContext).toBe(true);
  });

  test('executor does NOT omit (it needs full parent context)', () => {
    const { agents } = loadAgentsLayered({});
    const executor = agents.get('executor');
    expect(executor).toBeDefined();
    // executor writes code — needs parent CLAUDE.md
    expect(executor?.omitInheritedContext === true).toBe(false);
  });

  test('all 5 PFC builtin agents load via layered resolver', () => {
    const { agents } = loadAgentsLayered({});
    for (const name of ['explore', 'plan', 'research', 'critic', 'executor']) {
      expect(agents.has(name)).toBe(true);
    }
  });
});

describe('runner honors task.cwd in slim notice', () => {
  test('buildAgentMessages receives cwd through runAgent task threading', async () => {
    // This test validates the runner's plumbing via the registry.spawn
    // path used by skill-tool-agent: cwd on task → passed to
    // buildAgentMessages → appears in notice for omitInheritedContext agents.
    const { AgentRegistry } = await import('../src/agent/registry');
    const reg = new AgentRegistry();
    const definition = def({ omitInheritedContext: true });
    const handle = reg.spawn({
      definition,
      prompt: 'hello',
      cwd: '/tmp/isolated-wt',
      systemPromptPrefix: 'SHOULD-BE-STRIPPED',
      provider: {
        name: 'stub',
        defaultModel: 'x',
        available: () => true,
        async *streamChat() { yield { type: 'text', delta: 'ok' }; },
        async *chat() { yield 'ok'; },
      },
    });
    // Drain one event to let the runner populate task.messages.
    for await (const ev of handle.events) {
      if (ev.type === 'text' || ev.type === 'done') break;
    }
    const sys = handle.task.messages[0]!.content as string;
    expect(sys).toContain('/tmp/isolated-wt');
    expect(sys).toContain('sub-agent (explore)');
    expect(sys).not.toContain('SHOULD-BE-STRIPPED');
  });
});
