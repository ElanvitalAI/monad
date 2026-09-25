import { describe, expect, test } from 'bun:test';

import { FoldStack } from '../src/fold-stack.js';
import {
  buildDashboardSkillPriorConversation,
  runDashboardSkillByName,
} from '../src/dashboard/skill-runtime.js';

describe('buildDashboardSkillPriorConversation', () => {
  test('keeps only user and assistant text in chronological order', () => {
    const out = buildDashboardSkillPriorConversation([
      { role: 'system', content: 'ignore' },
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'line a' },
          { type: 'image', text: 'skip' },
          { type: 'text', text: 'line b' },
        ],
      },
      { role: 'tool', content: 'ignore too' },
      { role: 'user', content: 'last' },
    ], 3);

    expect(out).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'line a\nline b' },
      { role: 'user', text: 'last' },
    ]);
  });
});

describe('runDashboardSkillByName', () => {
  test('surfaces unknown skills without running the runtime', async () => {
    const lines: string[] = [];
    const chatLines: string[] = [];

    const ran = await runDashboardSkillByName('missing-skill', '', {
      chatHistory: [],
      chatLines,
      contextRegistry: {} as never,
      foldStack: new FoldStack({ chatLines }),
      draw: () => {},
      pinChatTail: () => {},
      pushDebugBlank: () => { lines.push('blank'); },
      pushDebugLine: (line) => { lines.push(line); },
      attachStreamingKeys: () => () => {},
      formatSkillResponse: (text) => [text],
      skillContextLabel: 'ctx',
      allowAgentsScratch: false,
      showAgentsScratch: () => {},
      publishAgentBatchScratch: () => {},
      parseSkill: () => null,
    });

    expect(ran).toBe(false);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Skill not found: missing-skill');
    expect(lines[1]).toContain('Run /run-skill with no args');
  });

  test('executes a skill with prior conversation and runtime callbacks', async () => {
    const events: string[] = [];
    const chatLines: string[] = [];
    const foldStack = new FoldStack({ chatLines });
    let capturedPriorConversation: Array<{ role: 'user' | 'assistant'; text: string }> | undefined;

    const ran = await runDashboardSkillByName('demo-skill', 'hello world', {
      chatHistory: [
        { role: 'user', content: 'earlier user' },
        { role: 'assistant', content: 'earlier assistant' },
        { role: 'tool', content: 'ignore' },
      ],
      chatLines,
      contextRegistry: {} as never,
      foldStack,
      draw: () => { events.push('draw'); },
      pinChatTail: () => { events.push('pin'); },
      pushDebugBlank: () => { events.push('blank'); },
      pushDebugLine: (line) => { events.push(`line:${line}`); },
      attachStreamingKeys: () => {
        events.push('attach-keys');
        return () => { events.push('cleanup-keys'); };
      },
      formatSkillResponse: (text) => [`fmt:${text}`],
      skillContextLabel: 'Dashboard context: mode=browse',
      allowAgentsScratch: true,
      showAgentsScratch: () => { events.push('show-agents'); },
      publishAgentBatchScratch: (skillName, info, expanded) => {
        events.push(`scratch:${skillName}:${info.phase}:${expanded}`);
      },
      parseSkill: (name) => ({
        name,
        description: 'demo description',
        content: '# demo',
        skillDir: '/tmp/demo-skill',
      }),
      loadAttachments: async () => { events.push('load-attachments'); },
      executeSkill: async (_manifest, _args, onDelta, opts) => {
        capturedPriorConversation = opts.priorConversation;
        opts.onTurn?.({
          turn: 0,
          durationMs: 10,
          textChars: 5,
          pendingCalls: ['Browser'],
        });
        opts.onAgentBatchStatus?.({
          phase: 'tick',
          batchElapsedMs: 20,
          total: 2,
          done: 1,
          remaining: 1,
          runningDescriptions: ['child-a'],
        });
        onDelta('', 'assistant reply');
        return {
          provider: 'demo-provider',
          model: 'demo-model',
          fullResponse: 'assistant reply',
        };
      },
    });

    expect(ran).toBe(true);
    expect(capturedPriorConversation).toEqual([
      { role: 'user', text: 'earlier user' },
      { role: 'assistant', text: 'earlier assistant' },
    ]);
    expect(chatLines.some(line => line.includes('fmt:assistant reply'))).toBe(true);
    expect(foldStack.size()).toBe(0);
    expect(events).toContain('attach-keys');
    expect(events).toContain('cleanup-keys');
    expect(events).toContain('load-attachments');
    expect(events).toContain('show-agents');
    expect(events).toContain('scratch:demo-skill:tick:false');
    expect(events.some(event => event.includes('demo-provider'))).toBe(true);
  });
});
